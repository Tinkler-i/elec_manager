#!/usr/bin/env node
/**
 * E2E 跑者：一条命令跑完 `scripts/e2e/*.mjs`，给一份 pass/fail 清单。
 *
 *   npm run test:e2e                 跑全部用例
 *   npm run test:e2e -- --probe-failure   自检：故意插一条失败用例，确认跑者真的会红
 *
 * 每个用例文件导出 `cases = [{ name, needsBrowser?, fn(ctx) }]`。
 * `ctx = { fixture, browser, page, assert }`。
 *
 * 两条生命周期规则：
 *   · **服务只起一次**，整个 run 复用 —— 起一次 standalone 是秒级成本，别每个用例付一遍。
 *   · **没有任何用例需要浏览器时就不开浏览器**。「该不该开浏览器」是设计问题，
 *     不是习惯问题：认证 / 状态码 / 响应头 / 迁移全在 HTTP 层。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { launch } from '../lib/cdp.mjs';
import { start } from '../lib/fixture.mjs';
import { sweepStaleTempDirs } from '../lib/postbuild-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASE_TIMEOUT_MS = Number(process.env.E2E_CASE_TIMEOUT_MS ?? 60000);

async function loadCases() {
  const files = fs
    .readdirSync(HERE)
    .filter((f) => f.endsWith('.mjs') && f !== 'run.mjs' && !f.startsWith('_'))
    .sort();

  const cases = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(HERE, file)).href);
    const list = mod.cases ?? mod.default ?? [];
    if (!Array.isArray(list)) throw new Error(`${file} 没导出 cases 数组`);
    for (const item of list) cases.push({ ...item, file });
  }
  return cases;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`用例超时（${ms}ms）：${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function indent(text) {
  return String(text)
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
}

const cases = await loadCases();

// 自检用：验证「失败会红」这件事本身还成立
if (process.argv.includes('--probe-failure')) {
  cases.push({
    file: '(自检)',
    name: '[自检] 故意写错的断言 —— 用来确认跑者会给非零退出码',
    needsBrowser: false,
    fn: async ({ fixture }) => {
      // 注意：别拿「未登录 → 401」当失败用例。所有用例共用一个 fixture，
      // cookie jar 是累积的：前面有人登录过，这里就变成 200 了，断言反而成立。
      // 用一个必然不成立的事实，才对「跑者会不会红」有证明力。
      const res = await fixture.http.get('/api/__这条路由不存在__');
      assert.equal(
        res.status,
        200,
        `这条断言是故意写错的（这个路由不存在，实际 status=${res.status}）。` +
          `它红 = 断言失败会正确地反映到退出码上。`,
      );
    },
  });
}

if (cases.length === 0) {
  console.error('scripts/e2e/ 下没有用例。');
  process.exit(2);
}

const needsBrowser = cases.some((c) => c.needsBrowser);
const results = [];
let fixture = null;
let browser = null;

/** 收现场。正常跑完和收到信号都走这里，保证只有一套收尾逻辑。 */
async function teardown() {
  const notes = [];
  if (browser) {
    try {
      await browser.close();
      notes.push('浏览器已关（进程树已杀，临时 profile 已删）');
    } catch (error) {
      notes.push(`关浏览器出错：${error.message}`);
    }
    browser = null;
  }
  if (fixture) {
    const report = await fixture.stop();
    notes.push(
      `fixture 已停：进程退出=${report.exited} 端口释放=${report.portFreed} 临时目录删除=${report.dataRemoved}`,
    );
    fixture = null;
  }
  return notes;
}

// Ctrl+C / 被 kill 时也要收干净 —— 否则会在机器上留下 headless 进程和临时目录。
// （被硬杀、没机会跑信号处理的情况，由 start()/launch() 里的陈旧目录清扫兜底。）
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n收到 ${signal}，先收拾现场再退出。`);
    for (const line of await teardown()) console.log(`· ${line}`);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

try {
  // 上一次被硬杀（掐管道 / taskkill /F）时下面的 finally 跑不到，先把那些垃圾收了。
  // 正常收尾的情况下这里是空操作；报出来是为了让「兜底真的在兜」这件事可见。
  const swept = sweepStaleTempDirs(['elec-cdp-', 'elec-e2e-']);
  if (swept.length > 0) {
    console.log(`· 清掉上次异常终止留下的临时目录 ${swept.length} 个：${swept.join(', ')}`);
  }

  console.log(`· 起 fixture（standalone + 临时库，端口固定便于复用 cookie）`);
  fixture = await start({ quiet: true });
  console.log(`  就绪 ${fixture.url}  数据目录 ${fixture.dataDir}`);

  if (needsBrowser) {
    console.log('· 起 headless 浏览器');
    browser = await launch();
    console.log(`  ${browser.executablePath}（DevTools 端口 ${browser.port}）`);
  } else {
    console.log('· 本次用例都只需要 HTTP 层，不开浏览器');
  }
  console.log('');

  for (const item of cases) {
    const startedAt = Date.now();
    let page = null;
    try {
      if (item.needsBrowser) page = await browser.newPage();
      const value = await withTimeout(
        item.fn({ fixture, browser, page, newPage: () => browser.newPage(), assert }),
        item.timeoutMs ?? CASE_TIMEOUT_MS,
        item.name,
      );
      results.push({ item, ok: true, ms: Date.now() - startedAt });
      console.log(`  ✓ ${item.name}  (${Date.now() - startedAt}ms)`);
      // 用例返回什么就原样打出来 —— 验收要的证据在这里，不用再去翻别的输出
      if (value !== undefined) {
        console.log(indent(`返回：${JSON.stringify(value, null, 2)}`));
      }
    } catch (error) {
      results.push({ item, ok: false, ms: Date.now() - startedAt, error });
      console.log(`  ✗ ${item.name}  (${Date.now() - startedAt}ms)`);
      console.log(indent(error?.stack ?? String(error)));
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }
} catch (error) {
  console.error('\n跑者自身失败（fixture/浏览器没起来）：');
  console.error(indent(error?.stack ?? String(error)));
  if (fixture) console.error(indent(`服务输出：\n${fixture.logs().join('\n')}`));
  results.push({ item: { name: '(跑者自身)', file: '-' }, ok: false, ms: 0, error });
} finally {
  const notes = await teardown();
  if (notes.length) {
    console.log('');
    for (const line of notes) console.log(`· ${line}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`结果：${results.length - failed.length} 通过 / ${failed.length} 失败，共 ${results.length} 条`);
if (failed.length > 0) {
  console.log('失败清单：');
  for (const r of failed) console.log(`  · ${r.item.name}（${r.item.file}）`);
}
process.exit(failed.length > 0 ? 1 : 0);
