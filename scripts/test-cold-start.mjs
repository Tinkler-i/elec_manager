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
 *   4. 期望 200；instrumentation 没跑起来（proxy 拿不到 JWT 密钥）时这里是 **503**
 *      —— 见 src/proxy.ts 的 secretUnavailableResponse()。task-14 之后「密钥不可用」
 *      和「token 无效」是两回事：前者 503 且不动 cookie，后者才 307/401。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureStandalone,
  killTree,
  login,
  startServer,
  waitForPort,
  waitForPortFree,
} from './lib/postbuild-server.mjs';

const PORT_A = 16801;
const PORT_B = 16802;

ensureStandalone();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elec-coldstart-'));
const dataDir = path.join(tmp, 'data');
const backupDir = path.join(tmp, 'backups');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
const dbPath = path.join(dataDir, 'elec.db');

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
    a = startServer({ port: PORT_A, dbPath, backupDir });
    await waitForPort(PORT_A);

    const cookie = await login(`http://127.0.0.1:${PORT_A}`);
    check('步骤 1：进程 A 登录 200 并拿到 auth_token', cookie.startsWith('auth_token='), `len=${cookie.length}`);

    const onA = await fetch(`http://127.0.0.1:${PORT_A}/settings`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    check('步骤 2：A 上用同一 cookie 请求受保护页面 200', onA.status === 200, `status=${onA.status}`);

    // ── 进程 B：同一数据目录的全新进程 ──
    killTree(a);
    const freed = await waitForPortFree(PORT_A);
    check('A 已退出、端口释放', freed);

    b = startServer({ port: PORT_B, dbPath, backupDir });
    await waitForPort(PORT_B);

    // 步骤 3：B 上的第一个 HTTP 请求就是带有效 cookie 的受保护页面
    const onB = await fetch(`http://127.0.0.1:${PORT_B}/settings`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    check(
      '步骤 3：全新进程的第一个请求带有效 cookie → 200（密钥不可用时是 503）',
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
