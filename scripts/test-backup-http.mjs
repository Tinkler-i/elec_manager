#!/usr/bin/env node
/**
 * 备份往返回归（真实 HTTP）：`POST /api/backup` 返回时，备份文件必须已经完整。
 *
 * 为什么放在这里而不是 `npm test`：这条验的是**路由处理器自己**的行为 ——
 * route 里若写成 `backupDatabase(); return 成功`（route 忘了 await），数据层单测
 * （`scripts/test-calculations.ts` 的 TEST 16）不会红，只有真的打一次 HTTP 才发现。
 * 它依赖 `.next/standalone`，所以必须在 build 之后跑。
 *
 * 覆盖：
 *   1. POST → 200，且**返回瞬间**文件非 0 字节、没有 `-journal` 残留
 *   2. GET 列表能看到刚建的那个、size 一致；DELETE 之后列表回到原状
 *   3. 失败路径：备份目录指向一个普通文件 → 必须 500，不是假成功
 *
 * 用法：`node scripts/test-backup-http.mjs`
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureStandalone,
  killTreeAndWait,
  login,
  removeDirWithRetry,
  startServer,
  sweepStaleTempDirs,
  waitForPort,
  waitForPortFree,
} from './lib/postbuild-server.mjs';

const PORT_OK = 16811;
const PORT_BAD = 16812;

ensureStandalone();

// 先清旧账：以前那些异常终止（或被别的进程占着没删成）的运行留下的目录
const swept = sweepStaleTempDirs();
if (swept.length > 0) console.log(`清掉遗留的临时目录 ${swept.length} 个：${swept.join(', ')}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elec-backup-'));
const dataDir = path.join(tmp, 'data');
const backupDir = path.join(tmp, 'backups');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
const dbPath = path.join(dataDir, 'elec.db');

// 失败路径用：ELEC_BACKUP_DIR 指向一个普通文件，备份必然失败
const backupPathAsFile = path.join(tmp, 'backups-is-a-file');
fs.writeFileSync(backupPathAsFile, 'not a directory');

const results = [];
function check(label, ok, extra = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  | ' + extra : ''}`);
}

function listDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir);
}

async function main() {
  let okServer;
  let badServer;
  try {
    // ── 1. 正常往返 ──
    okServer = startServer({ port: PORT_OK, dbPath, backupDir });
    await waitForPort(PORT_OK);
    const cookie = await login(`http://127.0.0.1:${PORT_OK}`);

    const before = listDir(backupDir);

    const post = await fetch(`http://127.0.0.1:${PORT_OK}/api/backup`, {
      method: 'POST',
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    const postBody = await post.text();
    let fileName = '';
    try {
      const parsed = JSON.parse(postBody);
      if (typeof parsed.fileName === 'string') fileName = parsed.fileName;
    } catch { /* 非 JSON */ }
    check(
      'POST /api/backup → 200 且返回字符串文件名',
      post.status === 200 && fileName !== '',
      `status=${post.status} body=${postBody.slice(0, 140)}`,
    );

    if (fileName) {
      // 关键：HTTP 响应刚到手就读文件，不做任何等待
      const filePath = path.join(backupDir, fileName);
      const exists = fs.existsSync(filePath);
      const size = exists ? fs.statSync(filePath).size : 0;
      const journals = listDir(backupDir).filter((f) => f.includes('-journal'));

      check('返回瞬间备份文件已存在', exists, `file=${fileName}`);
      check('返回瞬间文件非 0 字节', size > 0, `size=${size}`);
      check('返回瞬间没有 -journal 残留', journals.length === 0, `journals=[${journals.join(', ')}]`);

      const list = await fetch(`http://127.0.0.1:${PORT_OK}/api/backup`, {
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
      const listed = await list.json().catch(() => null);
      const entry = Array.isArray(listed) ? listed.find((f) => f.name === fileName) : undefined;
      check(
        'GET 列表能看到刚建的那个且 size 一致',
        list.status === 200 && entry?.size === size,
        `entry=${JSON.stringify(entry)} size=${size}`,
      );

      const del = await fetch(`http://127.0.0.1:${PORT_OK}/api/backup?file=${encodeURIComponent(fileName)}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
      check('DELETE → 200', del.status === 200, `status=${del.status}`);

      const list2 = await fetch(`http://127.0.0.1:${PORT_OK}/api/backup`, {
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
      const listed2 = await list2.json().catch(() => null);
      const after = Array.isArray(listed2) ? listed2.map((f) => f.name) : null;
      check(
        '删除后列表回到原状',
        after !== null && JSON.stringify([...after].sort()) === JSON.stringify([...before].sort()),
        `before=[${before.join(', ')}] after=[${after?.join(', ') ?? 'null'}]`,
      );
    }

    await killTreeAndWait(okServer);
    await waitForPortFree(PORT_OK);

    // ── 2. 失败路径：备份目录不可用 → 500，不是假成功 ──
    badServer = startServer({ port: PORT_BAD, dbPath, backupDir: backupPathAsFile });
    await waitForPort(PORT_BAD);
    const cookie2 = await login(`http://127.0.0.1:${PORT_BAD}`);

    const badRes = await fetch(`http://127.0.0.1:${PORT_BAD}/api/backup`, {
      method: 'POST',
      headers: { Cookie: cookie2 },
      redirect: 'manual',
    });
    const badBody = await badRes.text();
    check(
      '备份目录不可用时 POST → 500（不是假成功）',
      badRes.status === 500,
      `status=${badRes.status} body=${badBody.slice(0, 140)}`,
    );
  } finally {
    // 顺序很重要：先等两个服务都真的退出，再删目录。
    // 旧版是「killTree 一发出就 rmSync」—— 进程还占着 db 文件，Windows 上必然 EPERM，
    // 然后那个空 catch 把它吞了，于是每跑一次就在系统临时目录留一份。
    await killTreeAndWait(okServer);
    await killTreeAndWait(badServer);

    if (!(await removeDirWithRetry(tmp))) {
      // 不静默：删不掉就得说，否则「收干净了」是个假象
      console.log(`WARN  临时目录没删掉（还被占用？）：${tmp}`);
    }
  }

  const failed = results.filter((r) => !r).length;
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('运行失败:', e);
  process.exit(2);
});
