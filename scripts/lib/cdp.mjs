/**
 * 零依赖的 CDP 浏览器驱动。
 *
 * **不引 playwright / puppeteer** —— 本机 Node（v24）自带全局 `WebSocket`，
 * 直接说 DevTools 协议就够了。这层存在的理由只有一个：**把「点一下 → 等模型 →
 * 再点一下」压成「一次 `evaluate` 往返跑完整条链路」**。
 *
 * 典型用法：
 *   const browser = await launch();
 *   const page = await browser.newPage();
 *   await page.goto(`${url}/login`);
 *   const out = await page.evaluate(async () => { ...多步流程... });   // 一次往返
 *   await browser.close();     // 真的杀掉子进程
 *
 * 关掉一定要走 `browser.close()`：它杀进程树并删临时 profile 目录。
 * 残留的 headless 进程是这套东西最容易留下的垃圾。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { killTreeAndWait, removeDirWithRetry, sweepStaleTempDirs } from './postbuild-server.mjs';

const DEFAULT_TIMEOUT = 30000;

/**
 * 候选浏览器路径。**抽成纯函数**（平台与 env 当参数传进来）是为了能在 Windows 上
 * 单独验 Linux 那一支 —— 开发机只有 Windows，但 CI 跑的是 ubuntu。
 */
export function browserCandidates(platform, env) {
  const candidates = [];

  if (platform === 'win32') {
    candidates.push(
      env.ProgramFiles && path.join(env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
      env.ProgramFiles && path.join(env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
      env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
      env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    // Linux。GitHub 的 ubuntu runner 自带 Google Chrome，装在 `/usr/bin/google-chrome`
    //（指向 google-chrome-stable 的符号链接）；其余是各家发行版的常见位置。
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome-beta',
      '/opt/google/chrome/chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/lib/chromium/chromium',
    );
  }

  return candidates.filter(Boolean);
}

/** 找浏览器：显式传入 > E2E_BROWSER / CHROME_PATH / EDGE_PATH > 按平台探测 */
export function resolveBrowserPath(explicit) {
  const candidates = [
    explicit,
    process.env.E2E_BROWSER,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    ...browserCandidates(process.platform, process.env),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    '找不到浏览器，e2e 起不来。\n' +
      '  · 显式指定：E2E_BROWSER=/path/to/chrome npm run test:e2e\n' +
      '  · GitHub 的 ubuntu runner 自带 Chrome，在 /usr/bin/google-chrome\n' +
      '  · 本机装一个 Chrome / Edge / Chromium 即可\n' +
      `找过这些位置：\n  ${candidates.join('\n  ')}`,
  );
}

/**
 * 额外的浏览器启动参数，空格分隔，来自 `E2E_BROWSER_ARGS`。
 * 给 CI / 容器环境留的出口（例如某些容器需要 `--no-sandbox --disable-dev-shm-usage`）。
 * **默认不预设任何值** —— 需要什么就明确写什么，别把兼容性当默认。
 */
export function extraBrowserArgs() {
  return (process.env.E2E_BROWSER_ARGS ?? '').split(/\s+/).filter(Boolean);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 一条 CDP 连接：按 id 配对响应，按 method 分发事件 */
class Connection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}（CDP ${msg.error.code}）`));
        else resolve(msg.result ?? {});
        return;
      }
      if (msg.method) {
        for (const listener of this.listeners) listener(msg);
      }
    });
  }

  static connect(url, timeoutMs = DEFAULT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error(`连接 CDP 超时：${url}`)), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new Connection(ws));
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`连接 CDP 失败：${url}`));
      });
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* 已经关了 */
    }
  }
}

/** 把 RemoteObject 变成一个能读的字符串 */
function formatRemoteObject(obj) {
  if (!obj) return String(obj);
  if (obj.unserializableValue !== undefined) return String(obj.unserializableValue);
  if (obj.type === 'string') return obj.value;
  if (obj.type === 'undefined') return 'undefined';
  if ('value' in obj) return typeof obj.value === 'string' ? obj.value : JSON.stringify(obj.value);
  return obj.description ?? obj.type;
}

class Page {
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.console = [];
    this.closed = false;

    browser.conn.on((msg) => {
      if (msg.sessionId !== this.sessionId) return;
      if (msg.method === 'Runtime.consoleAPICalled') {
        this.console.push({
          source: 'console',
          type: msg.params.type,
          text: (msg.params.args ?? []).map(formatRemoteObject).join(' '),
        });
      } else if (msg.method === 'Log.entryAdded') {
        this.console.push({
          source: 'log',
          type: msg.params.entry.level,
          text: msg.params.entry.text,
        });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.console.push({
          source: 'exception',
          type: 'error',
          text: msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? '',
        });
      }
    });
  }

  send(method, params) {
    return this.browser.conn.send(method, params, this.sessionId);
  }

  /** 打开各个域。console 捕获和截图都依赖它。 */
  async enable() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    return this;
  }

  /** 导航并等到 readyState === complete（用轮询而不是 loadEventFired，避免事件订阅竞态） */
  async goto(url, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
    await this.send('Page.navigate', { url });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const state = await this.evaluate('document.readyState');
        if (state === 'complete') return this;
      } catch {
        /* 上下文还在切换，重试 */
      }
      if (Date.now() > deadline) throw new Error(`导航超时：${url}`);
      await delay(100);
    }
  }

  /**
   * 在页面里求值。**这是这套东西的核心**：传一个 async 函数，整段多步流程
   * （等元素 → 填 → 点 → 等跳转 → 读 DOM）在页面里一次跑完，只占一次往返。
   *
   *   const out = await page.evaluate(async () => { ...; return { ok: true } })
   *
   * 注意 `returnByValue: true` —— 返回值必须能 JSON 序列化。要拿 DOM 节点
   * 就自己在函数里读它的属性。
   */
  async evaluate(fnOrExpression, ...args) {
    const expression =
      typeof fnOrExpression === 'function'
        ? `(${fnOrExpression.toString()})(${args.map((a) => JSON.stringify(a) ?? 'undefined').join(',')})`
        : String(fnOrExpression);

    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });

    if (exceptionDetails) {
      const detail =
        exceptionDetails.exception?.description ?? exceptionDetails.text ?? '未知的页面异常';
      throw new Error(`页面里抛了异常：\n${detail}`);
    }
    return result?.value;
  }

  /** 截图写文件，返回字节数 */
  async screenshot(filePath, { fullPage = false } = {}) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: fullPage,
    });
    const buffer = Buffer.from(data, 'base64');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return buffer.length;
  }

  /** 窗口尺寸（顺便用于断言布局） */
  async setViewport(width, height, deviceScaleFactor = 1) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: false,
    });
  }

  consoleMessages() {
    return this.console;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.browser.conn.send('Target.closeTarget', { targetId: this.targetId });
    } catch {
      /* 浏览器可能已经在关了 */
    }
  }
}

class Browser {
  constructor({ child, conn, port, userDataDir, executablePath }) {
    this.child = child;
    this.conn = conn;
    this.port = port;
    this.userDataDir = userDataDir;
    this.executablePath = executablePath;
    this.pages = [];
    this.closed = false;
  }

  /** `/json/list` —— 调试时看目标列表用 */
  async targets() {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
    return res.json();
  }

  /** 无头下剪贴板这类权限必须显式给，否则调用直接被拒 */
  grantPermissions(permissions, origin) {
    return this.conn.send('Browser.grantPermissions', { permissions, origin });
  }

  async newPage({ url = 'about:blank' } = {}) {
    const { targetId } = await this.conn.send('Target.createTarget', { url });
    const { sessionId } = await this.conn.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId);
    await page.enable();
    this.pages.push(page);
    return page;
  }

  /**
   * 关掉并确认进程真的没了：杀进程树 → 等它退出 → 删临时 profile 目录。
   * 别省这一步 —— 残留的 headless 进程会在用户机器上堆着。
   */
  async close({ timeoutMs = 8000 } = {}) {
    if (this.closed) return;
    this.closed = true;

    for (const page of this.pages) {
      try {
        await page.close();
      } catch {
        /* 忽略 */
      }
    }
    this.conn.close();

    // 等进程真的退出再删 profile：不等就删会撞上 Chrome 还占着的句柄
    await killTreeAndWait(this.child, { timeoutMs });
    await removeDirWithRetry(this.userDataDir);
  }
}

/** 从 `DevTools listening on ws://…` 或 `<profile>/DevToolsActivePort` 拿端口 */
async function waitForDevToolsPort(child, userDataDir, timeoutMs) {
  const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  let stderrTail = '';

  const fromStderr = new Promise((resolve) => {
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(text);
      if (match) resolve(Number(match[1]));
    });
  });

  for (;;) {
    const port = await Promise.race([
      fromStderr,
      (async () => {
        if (fs.existsSync(activePortFile)) {
          const first = fs.readFileSync(activePortFile, 'utf8').split('\n')[0].trim();
          if (/^\d+$/.test(first)) return Number(first);
        }
        return 0;
      })(),
      delay(200).then(() => 0),
    ]);
    if (port) return port;

    if (child.exitCode !== null) {
      throw new Error(`浏览器启动即退出（exit=${child.exitCode}）。stderr 尾部：\n${stderrTail}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`等 DevTools 端口超时。stderr 尾部：\n${stderrTail}`);
    }
  }
}

/**
 * 起一个 headless 浏览器。
 * `--remote-debugging-port=0` 让系统随机分配端口，避免多份测试抢同一个口。
 */
export async function launch({
  browserPath,
  timeoutMs = DEFAULT_TIMEOUT,
  args = [],
  windowSize = '1280,800',
} = {}) {
  const executablePath = resolveBrowserPath(browserPath);
  // 兜底：上一次被硬杀时 close() 跑不到，profile 目录会剩下来
  sweepStaleTempDirs();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elec-cdp-'));

  const child = spawn(
    executablePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${windowSize}`,
      ...extraBrowserArgs(),
      ...args,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  try {
    const port = await waitForDevToolsPort(child, userDataDir, timeoutMs);
    // 浏览器级 WebSocket：能发 Browser.* 命令，也能通过 sessionId 驱动页面
    const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
    const version = await versionRes.json();
    const conn = await Connection.connect(version.webSocketDebuggerUrl, timeoutMs);
    return new Browser({ child, conn, port, userDataDir, executablePath });
  } catch (error) {
    await killTreeAndWait(child);
    await removeDirWithRetry(userDataDir);
    throw error;
  }
}
