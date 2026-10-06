#!/usr/bin/env node
/**
 * A5 冷启动回归：应用重启后，带着有效 cookie 的**第一个**请求不能被踢回登录页。
 *
 * 为什么这里起真进程而不是放进 `npm test`：这个缺陷只在「全新进程 + auth.ts 还没跑过」
 * 时出现，单测覆盖不到 —— `src/instrumentation.ts` 里是 extensionless 的 `import('./lib/auth')`，
 * raw Node 的 ESM 解析器不认（`scripts/test-calculations.ts` 里有同样的说明）。
 *
 * 前置：先跑 `npm run build`（需要 .next/standalone/server.js）。
 * 用法：`node scripts/test-cold-start.mjs`
 *
 * 步骤对应 task-7 / task-12 的复现法：
 *   1. 进程 A 登录拿 cookie
 *   2. A 上用该 cookie 请求受保护页面 → 200
 *   3. 全新进程 B（同一数据目录）上，**第一个 HTTP 请求**就是带该 cookie 的受保护页面
 *   4. 期望 200；instrumentation 没跑起来时这里是 307 且 cookie 被清
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, '.next', 'standalone', 'server.js');
const PORT_A = 16801;
const PORT_B = 16802;

if (!fs.existsSync(SERVER)) {
  console.error(`找不到 ${SERVER}，先跑 npm run build`);
  process.exit(2);
}

// 新构建出来的 standalone 不带 static/public，补上，让页面能正常渲染（构建产物，不影响源码）
for (const [src, dst] of [
  [path.join(ROOT, '.next', 'static'), path.join(ROOT, '.next', 'standalone', '.next', 'static')],
  [path.join(ROOT, 'public'), path.join(ROOT, '.next', 'standalone', 'public')],
]) {
  if (fs.existsSync(src) && !fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elec-coldstart-'));
const dataDir = path.join(tmp, 'data');
const backupDir = path.join(tmp, 'backups');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
const dbPath = path.join(dataDir, 'elec.db');

function startServer(port) {
  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    ELEC_DB_PATH: dbPath,
    ELEC_BACKUP_DIR: backupDir,
  };
  // 设备上 cmd/main 不注入 JWT_SECRET，必须复现这个前提，否则测不出冷启动
  delete env.JWT_SECRET;
  return spawn(process.execPath, [SERVER], { cwd: ROOT, env, stdio: 'ignore' });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
}

/** 只探 TCP，不发 HTTP —— 任何打到 API 路由的请求都可能提前跑 auth.ts，把缺陷掩盖掉 */
function waitForPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect({ port, host: '127.0.0.1' });
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`等待端口 ${port} 超时`));
        else setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

function waitForPortFree(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const sock = net.connect({ port, host: '127.0.0.1' });
      sock.once('connect', () => {
        sock.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tryOnce, 150);
      });
      sock.once('error', () => {
        sock.destroy();
        resolve(true);
      });
    };
    tryOnce();
  });
}

const results = [];
function check(label, ok, extra = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  | ' + extra : ''}`);
}

async function main() {
  let a;
  let b;
  try {
    // ── 进程 A：登录，并在 A 上确认 cookie 有效 ──
    a = startServer(PORT_A);
    await waitForPort(PORT_A);

    const login = await fetch(`http://127.0.0.1:${PORT_A}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'admin', remember: true }),
      redirect: 'manual',
    });
    check('步骤 1：进程 A 登录 200', login.status === 200, `status=${login.status}`);

    // 显式把 cookie 塞进请求头，不用会话容器（PowerShell 的 WebSession 会按端口隔离）
    const cookie = (login.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');
    check('拿到 auth_token cookie', cookie.startsWith('auth_token='), `len=${cookie.length}`);

    const onA = await fetch(`http://127.0.0.1:${PORT_A}/settings`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    check('步骤 2：A 上用同一 cookie 请求受保护页面 200', onA.status === 200, `status=${onA.status}`);

    // ── 进程 B：同一数据目录的全新进程 ──
    killTree(a);
    const freed = await waitForPortFree(PORT_A);
    check('A 已退出、端口释放', freed);

    b = startServer(PORT_B);
    await waitForPort(PORT_B);

    // 步骤 3：B 上的第一个 HTTP 请求就是带有效 cookie 的受保护页面
    const onB = await fetch(`http://127.0.0.1:${PORT_B}/settings`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    check(
      '步骤 3：全新进程的第一个请求带有效 cookie → 200（不是 307）',
      onB.status === 200,
      `status=${onB.status} location=${onB.headers.get('location') ?? ''}`,
    );
  } finally {
    killTree(a);
    killTree(b);
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // 进程刚被杀，Windows 上文件可能还锁着；留在系统临时目录，不影响结论
    }
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('运行失败:', e);
  process.exit(2);
});
