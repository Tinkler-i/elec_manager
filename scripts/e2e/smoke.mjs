/**
 * E2E 冒烟：证明地基这两件事真的能用 ——
 *
 *   1. **HTTP 层能独立断言**（完全不开浏览器）。认证、状态码、响应头这些
 *      本来就是 HTTP 的事，为它们开一个浏览器是纯浪费。
 *   2. **一次 `evaluate` 往返能跑完整条页面链路**（等元素 → 填 → 点 → 等跳转 → 读 DOM）。
 *      这是这套东西存在的理由：把「点一下过一个模型」压成一次往返。
 *
 * 顺带覆盖截图、console 捕获，以及一条**负面控制**（页面里抛异常必须能被抓到 ——
 * 否则「evaluate 永远返回 undefined」也会被当成通过）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`等超时：${label}`);
    await sleep(50);
  }
}

export const cases = [
  {
    name: 'HTTP 层：未登录访问 /api/auth/check → 401（不开浏览器）',
    needsBrowser: false,
    fn: async ({ fixture, assert }) => {
      const res = await fixture.http.get('/api/auth/check');
      assert.equal(res.status, 401, `期望 401，实际 ${res.status}：${res.text.slice(0, 200)}`);
      return { status: res.status, setCookie: res.setCookie.length };
    },
  },
  {
    name: 'HTTP 层：登录拿 cookie → /api/settings → 200（不开浏览器）',
    needsBrowser: false,
    fn: async ({ fixture, assert }) => {
      const cookie = await fixture.http.login();
      assert.match(cookie, /^auth_token=/, `登录没拿到 auth_token cookie：${cookie}`);

      const res = await fixture.http.get('/api/settings');
      assert.equal(res.status, 200, `期望 200，实际 ${res.status}：${res.text.slice(0, 200)}`);

      const data = res.json();
      return {
        status: res.status,
        cookie: `${cookie.slice(0, 22)}…`,
        payloadType: Array.isArray(data) ? 'array' : typeof data,
        payloadKeys: Array.isArray(data) ? [] : Object.keys(data).slice(0, 8),
      };
    },
  },
  {
    name: 'CDP：一次 evaluate 往返跑完 登录→填→点→等跳转→读 DOM',
    needsBrowser: true,
    fn: async ({ fixture, page, assert }) => {
      await page.goto(`${fixture.url}/login`);

      // ↓↓↓ 整段多步流程在页面里跑完，只占**一次**往返 ↓↓↓
      const out = await page.evaluate(async () => {
        const steps = [];
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const waitFor = async (check, label, timeoutMs = 10000) => {
          const deadline = Date.now() + timeoutMs;
          for (;;) {
            const value = check();
            if (value) return value;
            if (Date.now() > deadline) throw new Error(`等超时：${label}`);
            await sleep(50);
          }
        };

        steps.push(`打开 ${location.pathname}`);

        const input = await waitFor(() => document.querySelector('input#password'), '#password 密码框');
        steps.push('拿到密码框');

        // 登录页读的是表单元素的 DOM value（为了兼容密码管理器自动填充），
        // 所以直接赋值就够，不需要 React 的 setter 技巧
        input.value = 'admin';
        steps.push('填入密码');

        const button = await waitFor(
          () => document.querySelector('button[type=submit]'),
          '提交按钮',
        );
        button.click();
        steps.push('点了登录');

        await waitFor(() => location.pathname !== '/login', '跳转离开 /login');
        steps.push(`跳到 ${location.pathname}`);

        const heading = await waitFor(
          () => document.body.innerText.trim().length > 0 && location.pathname,
          '目标页渲染',
        );

        return {
          steps,
          path: location.pathname,
          title: document.title,
          bodyLength: document.body.innerText.length,
          showsPasswordError: document.body.innerText.includes('密码错误'),
          hasHeading: !!document.querySelector('h1, h2, [data-slot=card-title]'),
          heading: heading ? (document.querySelector('h1, h2')?.textContent ?? '').trim() : '',
        };
      });
      // ↑↑↑ 到这一行，上面 6 步已经全部在浏览器里执行完了 ↑↑↑

      assert.equal(out.path, '/', `期望跳到 /，实际 ${out.path}；步骤：${out.steps.join(' → ')}`);
      assert.equal(out.showsPasswordError, false, `页面报了密码错误：${JSON.stringify(out)}`);
      assert.ok(out.bodyLength > 0, '目标页正文是空的');
      assert.ok(out.steps.length >= 5, `步骤太少：${out.steps.length}`);
      return out;
    },
  },
  {
    name: 'CDP：screenshot 能出图（PNG 字节数）',
    needsBrowser: true,
    fn: async ({ fixture, page, assert }) => {
      await page.goto(`${fixture.url}/login`);
      await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true');

      const file = path.join(os.tmpdir(), `elec-e2e-shot-${Date.now()}.png`);
      const bytes = await page.screenshot(file);
      const pngSignature = fs.readFileSync(file).subarray(0, 8).toString('hex');
      fs.rmSync(file, { force: true });

      assert.ok(bytes > 1000, `PNG 太小，可能是空白页：${bytes} 字节`);
      assert.equal(pngSignature, '89504e470d0a1a0a', '不是合法 PNG');
      return { bytes, pngSignature, deletedAfterMeasure: true };
    },
  },
  {
    name: 'CDP：页面里的 console.error 能被抓到',
    needsBrowser: true,
    fn: async ({ fixture, page, assert }) => {
      await page.goto(`${fixture.url}/login`);
      const marker = `E2E 故意打的告警 ${Date.now()}`;
      await page.evaluate(`console.error(${JSON.stringify(marker)})`);

      const hit = await waitFor(
        () => page.consoleMessages().find((m) => m.type === 'error' && m.text.includes(marker)),
        'console.error 被 Runtime.consoleAPICalled 捕获',
        3000,
      );
      assert.ok(hit, `没抓到告警。已收：${JSON.stringify(page.consoleMessages())}`);
      return { captured: hit, totalMessages: page.consoleMessages().length };
    },
  },
  {
    name: 'CDP：负面控制 —— 页面里抛异常时 evaluate 必须失败（不能静默返回 undefined）',
    needsBrowser: true,
    fn: async ({ fixture, page, assert }) => {
      await page.goto(`${fixture.url}/login`);

      await assert.rejects(
        () =>
          page.evaluate(async () => {
            throw new Error('页面里故意抛的异常');
          }),
        /页面里故意抛的异常/,
        'evaluate 没有把页面异常抛出来 —— 那样「页面挂了」会被当成通过',
      );

      // 反向对照：同一页面上正常求值仍然要能返回
      const ok = await page.evaluate('1 + 1');
      assert.equal(ok, 2);
      return { throwsOnPageException: true, normalEvaluateStillWorks: ok };
    },
  },
];
