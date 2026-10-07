/**
 * E2E 的服务 fixture：起一个**可测的** standalone 服务，用完干净收掉。
 *
 * 它替掉的是每次手工那套：改 `ELEC_DB_PATH` → 找个空端口 → 起 standalone →
 * 等它醒 → 测完杀干净。手工做不但慢，还容易忘掉最后一 步，在机器上留进程。
 *
 *   const fx = await start();          // 默认固定端口，方便复用 cookie 与调试
 *   const r = await fx.http.get('/api/auth/check');
 *   await fx.stop();
 *
 * `http` 是重点：**大多数验收根本不需要浏览器** —— 认证、API 契约、状态码、
 * 迁移、响应头全在 HTTP 层。开浏览器是最后手段，不是默认手段。
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  SERVER,
  ensureStandalone,
  killTreeAndWait,
  login as loginViaHttp,
  removeDirWithRetry,
  startServer,
  sweepStaleTempDirs,
  waitForPortFree,
} from './postbuild-server.mjs';

/** 固定端口：方便复用 cookie、方便人肉打开同一个地址看现场 */
export const DEFAULT_PORT = 16900;

const LOG_RING = 200;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** 端口被占时别只报 ECONNREFUSED，要说清是谁占的、怎么办 */
async function assertPortAvailable(port) {
  const inUse = !(await waitForPortFree(port, 700));
  if (inUse) {
    throw new Error(
      `端口 ${port} 已被占用 —— 多半是上一次测试没退干净的服务。\n` +
        `  · 换一个：start({ port: ${port + 1} })\n` +
        `  · 或者清掉占用者：netstat -ano | findstr :${port} 然后 taskkill /PID <pid> /T /F\n` +
        `  · 想每次随机：start({ port: 0 })（代价是地址每次都变，不方便复用 cookie）`,
    );
  }
}

function makeHttp(baseUrl) {
  let cookie = '';

  const request = async (pathname, { method = 'GET', body, cookie: override, headers = {} } = {}) => {
    const finalHeaders = { ...headers };
    const jar = override ?? cookie;
    if (jar) finalHeaders.Cookie = jar;
    if (body !== undefined && !('Content-Type' in finalHeaders)) {
      finalHeaders['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    });

    const setCookie = res.headers.getSetCookie?.() ?? [];
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      setCookie,
      text,
      json() {
        return JSON.parse(text);
      },
    };
  };

  return {
    baseUrl,
    get cookie() {
      return cookie;
    },
    /** 清掉登录态。cookie jar 在 fixture 级别共享，需要干净状态的用例自己调一下。 */
    clearCookie() {
      cookie = '';
    },
    request,
    get: (pathname, opts) => request(pathname, { ...opts, method: 'GET' }),
    post: (pathname, body, opts) => request(pathname, { ...opts, method: 'POST', body }),
    /** 登录并把 cookie 记住，后续请求自动带上 */
    async login(password = 'admin') {
      cookie = await loginViaHttp(baseUrl, password);
      return cookie;
    },
  };
}

/**
 * 起服务。**不会自己 build** —— 产物不在就明确让你先 `npm run build`，
 * 因为偷偷跑一次构建会让「测试慢」这件事更不可控。
 */
export async function start({
  port = DEFAULT_PORT,
  keepData = false,
  timeoutMs = 30000,
  quiet = false,
} = {}) {
  if (!fs.existsSync(SERVER)) {
    throw new Error(
      `找不到 ${SERVER}。先跑：\n  npm run build\n` +
        `（fixture 不会替你构建 —— 构建要几十秒，应该由你决定什么时候付这个成本）`,
    );
  }
  ensureStandalone();

  const actualPort = port === 0 ? await freePort() : port;
  await assertPortAvailable(actualPort);

  // 兜底：上一次被硬杀（掐管道、taskkill /F）时 finally 跑不到，临时目录会剩下来
  sweepStaleTempDirs({ log: quiet ? undefined : (msg) => console.log(`  ${msg}`) });

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elec-e2e-'));
  const backupDir = path.join(dataDir, 'backups');

  const logs = [];
  const push = (stream) => (chunk) => {
    logs.push(`[${stream}] ${chunk.toString().trimEnd()}`);
    if (logs.length > LOG_RING) logs.shift();
  };

  const child = startServer({
    port: actualPort,
    dbPath: path.join(dataDir, 'elec.db'),
    backupDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', push('out'));
  child.stderr?.on('data', push('err'));

  const baseUrl = `http://127.0.0.1:${actualPort}`;
  const http = makeHttp(baseUrl);

  let stopped = false;
  const stop = async () => {
    if (stopped) return { alreadyStopped: true };
    stopped = true;

    // 先等进程真的退出，再删目录 —— 不等就删会撞上还占着的文件句柄
    const exited = await killTreeAndWait(child);
    const portFreed = await waitForPortFree(actualPort, 8000);

    const dataRemoved = keepData ? false : await removeDirWithRetry(dataDir);

    return { exited, portFreed, dataRemoved, dataDir };
  };

  // 就绪判据用 HTTP 状态码，不用 TCP：端口通了不等于路由活了。
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '（一次都没连上）';
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/auth/check`, { redirect: 'manual' });
      lastStatus = res.status;
      if (res.status === 401) break;
    } catch (error) {
      lastStatus = `连接失败：${error.message}`;
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(
        `等服务就绪超时（${timeoutMs}ms）：${baseUrl}/api/auth/check 期望 401，最后一次是 ${lastStatus}\n` +
          `服务输出（最后 ${LOG_RING} 行）：\n${logs.join('\n')}`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!quiet) {
    console.log(`  fixture 就绪：${baseUrl}（端口 ${actualPort}，数据目录 ${dataDir}）`);
  }

  return {
    url: baseUrl,
    port: actualPort,
    dataDir,
    backupDir,
    child,
    http,
    logs: () => logs.slice(),
    stop,
  };
}
