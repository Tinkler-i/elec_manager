/**
 * 构建后冒烟测试的公共设施：起一个真的 standalone 服务、探活、杀进程、登录。
 *
 * 抽出来是因为 `test-cold-start.mjs` 和 `test-backup-http.mjs` 都要这一套 ——
 * 复制两份迟早会分叉（这一轮修的几个缺陷，根因都是「同一个动作写了两遍」）。
 *
 * 前置：先跑 `npm run build`，需要 `.next/standalone/server.js`。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SERVER = path.join(ROOT, '.next', 'standalone', 'server.js');

/** 检查构建产物在不在，并把 static/public 补进 standalone（构建产物，不影响源码） */
export function ensureStandalone() {
  if (!fs.existsSync(SERVER)) {
    console.error(`找不到 ${SERVER}，先跑 npm run build`);
    process.exit(2);
  }
  for (const [src, dst] of [
    [path.join(ROOT, '.next', 'static'), path.join(ROOT, '.next', 'standalone', '.next', 'static')],
    [path.join(ROOT, 'public'), path.join(ROOT, '.next', 'standalone', 'public')],
  ]) {
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true });
  }
}

/** 起一个 standalone 服务进程 */
export function startServer({ port, dbPath, backupDir }) {
  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    ELEC_DB_PATH: dbPath,
    ELEC_BACKUP_DIR: backupDir,
  };
  // 设备上 cmd/main 不注入 JWT_SECRET，必须复现这个前提，否则冷启动那类缺陷测不出来
  delete env.JWT_SECRET;
  return spawn(process.execPath, [SERVER], { cwd: ROOT, env, stdio: 'ignore' });
}

/** 杀掉整个进程树（Windows 上 next 可能还有子进程） */
export function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
}

/**
 * 只探 TCP，不发 HTTP。
 *
 * 冷启动场景里这点很关键：任何打到 API 路由的请求都可能提前把 auth.ts 跑起来，
 * 把「密钥还没初始化」的缺陷掩盖掉。
 */
export function waitForPort(port, timeoutMs = 30000) {
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

export function waitForPortFree(port, timeoutMs = 15000) {
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

/**
 * 登录，返回可以直接塞进 `Cookie` 请求头的字符串。
 * 显式用请求头传 cookie，不用会话容器（容器会按端口隔离，跨进程复用会踩坑）。
 */
export async function login(baseUrl, password = 'admin') {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, remember: true }),
    redirect: 'manual',
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (res.status !== 200 || !cookie.startsWith('auth_token=')) {
    throw new Error(`登录失败：status=${res.status} cookie=${cookie}`);
  }
  return cookie;
}
