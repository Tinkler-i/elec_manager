/**
 * MCP 密钥全流程 E2E —— 第一个真实用例。
 *
 * 分两层，按 `docs/e2e.md` 的第一原则：
 *
 *   · **HTTP 层**（不开浏览器）：契约字段、掩码、边界值、数量上限、密钥认证。
 *     这些本来就是 HTTP 的事，为它们开浏览器是纯浪费。
 *   · **UI 层**（一次 `evaluate`）：整条交互链路在页面里那个 async 函数里跑完 ——
 *     登录 → 建 3 把 → 改备注 → 清空 → 吊销中间那把 → 吊销全部 → 空态 →
 *     `😀`×64 提交 → 8267 字节被拦 → 弹窗里 reload 后明文消失。
 *     一次往返，不是「点一下过一个回合」。
 *
 * ── 两个绕不开的实现细节（都实测过）─────────────────────────────────────
 *
 * 1. **reload 只能放在弹窗里做。** 「明文只显示一次」要一次真实的整页 `location.reload()`，
 *    而 `location.reload()` 会销毁 `evaluate` 的上下文（CDP 直接报 Execution context destroyed）。
 *    同源 iframe 行不通：`/mcp` 带 `X-Frame-Options: DENY`（实测 200 + DENY，`contentDocument`
 *    为 null）。`window.open` 的弹窗不受 XFO 约束，且**父页面的 evaluate 在弹窗 reload 后依然存活** ——
 *    实测通过，所以用它。
 * 2. **「没发请求」必须自己数。** 「8267 字节被拦」的正命题是「按钮禁用 + 提示」，反命题是
 *    「真的一个请求都没出去」。后者靠给 `window.fetch` 打桩计数，不能靠「界面上看起来没反应」。
 *
 * 所有断言都逐条报 pass/fail 并带上实际值 —— 失败时要能直接看出错在哪，而不是只知道「失败了」。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 截图落在仓库外（team 目录），别把产物提交进去 */
const SHOT_DIR = 'D:\\Code\\AI\\Elec\\team\\reports\\task-58-e2e';

/** 与 src/lib/mcp-key-limits.ts 对齐的期望值。测试里写死是有意的：常量被改小/改大时这里要跟着红 */
const NOTE_MAX = 64;
const BODY_MAX_BYTES = 8192;
const KEY_MAX = 20;

/** 端点：列表 / 新建 / 撤回全部都是同一个路径，靠 method 区分 */
const KEY_PATH = '/api/mcp/key';

/** 建一把密钥，返回解析后的响应 */
async function createKey(fixture, note) {
  return fixture.http.post(KEY_PATH, { note });
}

/** 清空所有密钥，让用例之间不受顺序影响 */
async function revokeAll(fixture) {
  return fixture.http.request(KEY_PATH, { method: 'DELETE' });
}

/** `{"note":"…"}` 的 UTF-8 字节数。与页面里 `jsonBodyBytes` 算的是同一个形状 */
const noteBodyBytes = (note) => Buffer.byteLength(JSON.stringify({ note }), 'utf8');

const FIELDS = ['createdAt', 'id', 'lastUsedAt', 'note'];

export const cases = [
  /* ── HTTP 层 ──────────────────────────────────────────────────────────── */

  {
    name: 'API 契约：GET /api/mcp/key 字段恰好四个，且不含 hash / 明文',
    needsBrowser: false,
    fn: async ({ fixture, assert }) => {
      await fixture.http.login();
      try {
        await revokeAll(fixture);

        const created = await createKey(fixture, '契约用例');
        assert.equal(
          created.status,
          201,
          `新建期望 201，实际 ${created.status}：${created.text.slice(0, 200)}`,
        );
        const createdBody = created.json();
        assert.ok(
          typeof createdBody.key === 'string' && createdBody.key.startsWith('elecmcp_'),
          `POST 响应里应该带明文密钥（唯一一次），实际：${created.text.slice(0, 200)}`,
        );
        assert.deepEqual(
          Object.keys(createdBody.info ?? {}).sort(),
          FIELDS,
          `POST 的 info 字段应恰好是 ${FIELDS.join('/')}，实际 ${Object.keys(createdBody.info ?? {}).sort().join('/')}`,
        );

        const res = await fixture.http.get(KEY_PATH);
        assert.equal(res.status, 200, `列表期望 200，实际 ${res.status}`);
        const data = res.json();
        assert.ok(Array.isArray(data.keys), `keys 应是数组，实际 ${JSON.stringify(data).slice(0, 200)}`);
        assert.equal(data.keys.length, 1, `清空后新建 1 把，列表应有 1 行，实际 ${data.keys.length}`);

        const fields = Object.keys(data.keys[0]).sort();
        assert.deepEqual(
          fields,
          FIELDS,
          `列表字段应恰好是 ${FIELDS.join('/')}，实际 ${fields.join('/')}（多出来的很可能是 hash）`,
        );
        assert.ok(!/hash/i.test(res.text), `列表响应里出现了 hash：${res.text.slice(0, 300)}`);
        assert.ok(
          !res.text.includes('elecmcp_'),
          `列表响应里出现了明文密钥 —— 明文只能出现在 POST 那一次：${res.text.slice(0, 300)}`,
        );

        return {
          fields,
          plaintextOnlyInPost: createdBody.key.slice(0, 9) + '…',
          listNote: data.keys[0].note,
          listBytes: res.text.length,
        };
      } finally {
        fixture.http.clearCookie();
      }
    },
  },

  {
    name: 'API 边界：64 个 😀 → 201、65 → 400；8192 字节过体积门、8193 被判「请求体过大」',
    needsBrowser: false,
    fn: async ({ fixture, assert }) => {
      await fixture.http.login();
      try {
        await revokeAll(fixture);

        const okEmoji = await createKey(fixture, '😀'.repeat(NOTE_MAX));
        assert.equal(
          okEmoji.status,
          201,
          `64 个 😀（字素簇=${NOTE_MAX}）期望 201，实际 ${okEmoji.status}：${okEmoji.text.slice(0, 200)}`,
        );

        const tooEmoji = await createKey(fixture, '😀'.repeat(NOTE_MAX + 1));
        assert.equal(
          tooEmoji.status,
          400,
          `65 个 😀 期望 400，实际 ${tooEmoji.status}：${tooEmoji.text.slice(0, 200)}`,
        );

        // 字节边界：body = {"note":"…"}，纯 ASCII 时长度 = 11 + n
        const ascii = (n) => 'a'.repeat(n);
        assert.equal(noteBodyBytes(ascii(8181)), BODY_MAX_BYTES, '构造错误：8181 个 ASCII 应正好是 8192 字节');
        assert.equal(noteBodyBytes(ascii(8182)), BODY_MAX_BYTES + 1, '构造错误：8182 个 ASCII 应正好是 8193 字节');

        const atLimit = await createKey(fixture, ascii(8181));
        const overLimit = await createKey(fixture, ascii(8182));

        assert.equal(atLimit.status, 400, `8192 字节期望 400（会栽在字数上），实际 ${atLimit.status}`);
        assert.equal(overLimit.status, 400, `8193 字节期望 400（会栽在体积上），实际 ${overLimit.status}`);
        // 关键：两条都是 400，但理由必须不同 —— 否则「体积门」等于没测到
        assert.ok(
          !/请求体过大/.test(atLimit.text),
          `8192 字节不该被判「请求体过大」（体积门是 >8192）：${atLimit.text.slice(0, 200)}`,
        );
        assert.match(
          overLimit.text,
          /请求体过大/,
          `8193 字节应被判「请求体过大」，实际：${overLimit.text.slice(0, 200)}`,
        );
        assert.match(
          atLimit.json().error,
          /备注/,
          `8192 字节的拒绝理由应是字数超限，实际：${atLimit.text.slice(0, 200)}`,
        );

        await revokeAll(fixture);
        return {
          emoji64: okEmoji.status,
          emoji65: tooEmoji.status,
          bytes8192: `${atLimit.status} ${atLimit.json().error}`,
          bytes8193: `${overLimit.status} ${overLimit.json().error}`,
        };
      } finally {
        fixture.http.clearCookie();
      }
    },
  },

  {
    name: 'API 数量上限：第 20 把 201、第 21 把 400，且列表仍是 20 把',
    needsBrowser: false,
    fn: async ({ fixture, assert }) => {
      await fixture.http.login();
      try {
        await revokeAll(fixture);

        const statuses = [];
        for (let i = 1; i <= KEY_MAX; i++) {
          const res = await createKey(fixture, `批量 ${i}`);
          statuses.push(res.status);
        }
        assert.deepEqual(
          statuses,
          Array(KEY_MAX).fill(201),
          `前 ${KEY_MAX} 把应全部 201，实际：${statuses.join(',')}`,
        );

        const twentyFirst = await createKey(fixture, `第 ${KEY_MAX + 1} 把`);
        assert.equal(
          twentyFirst.status,
          400,
          `第 ${KEY_MAX + 1} 把期望 400，实际 ${twentyFirst.status}：${twentyFirst.text.slice(0, 200)}`,
        );

        const list = (await fixture.http.get(KEY_PATH)).json();
        assert.equal(
          list.keys.length,
          KEY_MAX,
          `超限请求被拒后列表应仍是 ${KEY_MAX} 把，实际 ${list.keys.length}`,
        );

        await revokeAll(fixture);
        return {
          created: statuses.length,
          twentyFirst: `${twentyFirst.status} ${twentyFirst.json().error}`,
          remaining: list.keys.length,
        };
      } finally {
        fixture.http.clearCookie();
      }
    },
  },

  {
    name: 'MCP 认证：新建的密钥能过 /api/mcp（200）、乱写的 401，会话 cookie 也能过',
    needsBrowser: false,
    fn: async ({ fixture, assert }) => {
      await fixture.http.login();
      try {
        await revokeAll(fixture);
        const created = (await createKey(fixture, '认证用例')).json();

        const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
        const accept = { Accept: 'application/json, text/event-stream' };

        // cookie: '' 是必需的：/api/mcp 同时接受会话 JWT，带着 cookie 会让「乱写密钥 401」假通过
        const withKey = (key) =>
          fixture.http.request('/api/mcp', {
            method: 'POST',
            body: rpc,
            cookie: '',
            headers: { ...accept, Authorization: `Bearer ${key}` },
          });

        const good = await withKey(created.key);
        assert.equal(good.status, 200, `真密钥期望 200，实际 ${good.status}：${good.text.slice(0, 200)}`);
        assert.match(good.text, /tools/, `响应里应该有 tools 列表：${good.text.slice(0, 200)}`);

        const bogus = await withKey('elecmcp_made-up-key');
        assert.equal(bogus.status, 401, `乱写的密钥期望 401，实际 ${bogus.status}：${bogus.text.slice(0, 200)}`);

        // 负向对照：这个端点只读 `Authorization` 头（route.ts 的 authorize 只看 header），
        // 不认会话 cookie。它同时保证了上面「乱写密钥 → 401」不是因为 cookie 兜底才失败。
        const viaCookieOnly = await fixture.http.request('/api/mcp', {
          method: 'POST',
          body: rpc,
          headers: accept,
        });
        assert.equal(
          viaCookieOnly.status,
          401,
          `只带会话 cookie 不该通过（/api/mcp 只读 Authorization），实际 ${viaCookieOnly.status}`,
        );

        // 但会话 JWT **当 Bearer 用**是接受的 —— 页面文案里「也接受登录会话的 JWT」说的是这个
        const sessionJwt = fixture.http.cookie.replace(/^auth_token=/, '');
        assert.ok(sessionJwt.length > 20, `没从 cookie 里取到 JWT：${fixture.http.cookie.slice(0, 40)}`);
        const viaSessionJwt = await fixture.http.request('/api/mcp', {
          method: 'POST',
          body: rpc,
          cookie: '',
          headers: { ...accept, Authorization: `Bearer ${sessionJwt}` },
        });
        assert.equal(
          viaSessionJwt.status,
          200,
          `会话 JWT 当 Bearer 用应该能过（后端有意允许浏览器调试），实际 ${viaSessionJwt.status}：${viaSessionJwt.text.slice(0, 200)}`,
        );

        await revokeAll(fixture);
        return {
          withKey: good.status,
          bogusKey: bogus.status,
          cookieOnly: viaCookieOnly.status,
          sessionJwtAsBearer: viaSessionJwt.status,
          keyPrefix: created.key.slice(0, 9) + '…',
        };
      } finally {
        fixture.http.clearCookie();
      }
    },
  },

  /* ── UI 层：整条链路一次 evaluate ─────────────────────────────────────── */

  {
    name: 'UI 全流程（一次 evaluate）：建3把 / 改备注 / 清空 / 吊销单把 / 吊销全部 / 😀×64→201 / 8267字节被拦 / reload 后明文消失',
    needsBrowser: true,
    fn: async ({ fixture, page, assert }) => {
      // 干净的起点：HTTP 层清场（这是准备，不是 UI 动作）
      await fixture.http.login();
      await revokeAll(fixture);
      fixture.http.clearCookie();

      await page.goto(`${fixture.url}/login`);

      // ↓↓↓↓ 整条交互链路只占这一次往返，中间的等待与判断全在页面里 ↓↓↓↓
      const out = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const waitFor = async (check, label, timeoutMs = 20000) => {
          const deadline = Date.now() + timeoutMs;
          for (;;) {
            let value = null;
            try {
              value = check();
            } catch {
              value = null; // 文档还在切换 / 跨上下文访问，重试
            }
            if (value) return value;
            if (Date.now() > deadline) throw new Error(`等超时：${label}`);
            await sleep(40);
          }
        };

        // 结果对象**边跑边填**：中途某个等待超时时，外层仍能拿到已完成的那部分，逐条报
        // pass/fail 和实际值。（第一版是最后一次性 return —— 页面里一抛异常，所有断言都没机会跑。）
        const R = { steps: [], error: null };
        const steps = R.steps;

        try {

        /* ── 给 fetch 打桩：用来证明「被拦时真的没发请求」 ── */
        const calls = [];
        const nativeFetch = window.fetch;
        window.fetch = async function (...args) {
          const url = String(typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? ''));
          const method = String(args[1]?.method ?? 'GET').toUpperCase();
          const body = typeof args[1]?.body === 'string' ? args[1].body : '';
          const res = await nativeFetch.apply(this, args);
          if (url.includes('/api/mcp/key')) {
            calls.push({ method, bytes: body.length, status: res.status });
          }
          return res;
        };
        const keyCalls = () => calls.filter((c) => c.method !== 'GET');

        /* ── 小工具：受控输入必须走 React 的 value setter + input 事件 ── */
        const setInputValue = (input, value) => {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
          ).set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const noteInput = () => document.querySelector('input[aria-label="新密钥的备注"]');
        const genButton = () =>
          [...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成密钥'));
        const rows = () => [...document.querySelectorAll('ul > li')];
        const rowTitle = (li) => li.innerText.split('\n')[0].trim();
        const rowTitles = () => rows().map(rowTitle);
        const buttonIn = (root, label) =>
          [...root.querySelectorAll('button')].find((b) => b.textContent.trim().includes(label));
        const bodyText = () => document.body.innerText;

        /* ── 1. 登录 ── */
        const password = await waitFor(() => document.querySelector('input#password'), '#password');
        password.value = 'admin';
        document.querySelector('button[type=submit]').click();
        await waitFor(() => location.pathname !== '/login', '登录后离开 /login');
        steps.push(`登录 → ${location.pathname}`);

        /* ── 2. 客户端路由到 /mcp（不能用 location.href，那会毁掉这个上下文）── */
        const navLink = await waitFor(() => document.querySelector('a[href="/mcp"]'), '「MCP 服务」导航');
        navLink.click();
        await waitFor(() => location.pathname === '/mcp', '路由到 /mcp');
        await waitFor(() => noteInput(), '备注输入框');
        await waitFor(() => genButton() && !genButton().disabled, '生成按钮可用');
        steps.push('客户端路由到 /mcp（未整页刷新）');

        /* ── 3. 建 3 把，不同备注 ── */
        const createWithNote = async (note) => {
          // 关键：`createKey` 里 `setNoteDraft("")` 发生在 `await reload()` **之前**，
          // 而按钮的 disabled 含 `busy`。只等「输入框清空」会在 busy 还没复位时就放行，
          // 下一轮读到的 disabled 是 busy 造成的 —— 这不是竞态猜测，是踩到之后查出来的。
          await waitFor(
            () => genButton() && !genButton().disabled,
            `「${note}」之前生成按钮应已可用`,
          );
          const input = await waitFor(() => noteInput(), '备注输入框');
          setInputValue(input, note);
          await waitFor(() => noteInput().value === note, `备注写进输入框：${note}`);
          const button = genButton();
          if (button.disabled) {
            throw new Error(
              `「${note}」时生成按钮是禁用的（输入框值=${JSON.stringify(noteInput()?.value)}，` +
                `列表行数=${rows().length}，按钮文本=${JSON.stringify(button.textContent.trim())}）`,
            );
          }
          const before = keyCalls().length;
          button.click();
          await waitFor(() => keyCalls().length > before, `「${note}」的创建请求发出`);
          await waitFor(() => noteInput().value === '', '生成后输入框被清空');
          await waitFor(() => rows().length > 0, '列表出现行');
        };

        await createWithNote('甲-家里');
        await createWithNote('乙-流水线');
        await createWithNote('丙-测试机');
        await waitFor(() => rows().length === 3, `列表应 3 行，实际 ${rows().length}`);
        const afterCreate = rowTitles();
        const createCalls = keyCalls().map((c) => c.status);
        steps.push(`建了 3 把：${afterCreate.join(' / ')}`);

        /* ── 4. 改备注：改「甲-家里」那一行（列表按创建时间倒序，它在最后）── */
        const jia = rows()[rows().length - 1];
        buttonIn(jia, '改备注').click();
        const editInput = await waitFor(() => document.querySelector('input[aria-label="备注"]'), '就地编辑输入框');
        setInputValue(editInput, '甲-改过了');
        await waitFor(() => document.querySelector('input[aria-label="备注"]').value === '甲-改过了', '编辑框写入');
        const saveButton = buttonIn(rows()[rows().length - 1], '保存');
        saveButton.click();
        await waitFor(
          () => rows().some((li) => rowTitle(li) === '甲-改过了'),
          '列表出现改后的备注',
        );
        const afterEdit = rowTitles();
        steps.push(`改备注 → ${afterEdit.join(' / ')}`);

        /* ── 5. 清空备注 → 显示「未命名」── */
        const jiaRow = rows().find((li) => rowTitle(li) === '甲-改过了');
        buttonIn(jiaRow, '改备注').click();
        await waitFor(() => document.querySelector('input[aria-label="备注"]'), '编辑框（清空用）');
        const clearInput = document.querySelector('input[aria-label="备注"]');
        setInputValue(clearInput, '');
        await waitFor(() => document.querySelector('input[aria-label="备注"]').value === '', '编辑框已清空');
        buttonIn(rows().find((li) => li.querySelector('input[aria-label="备注"]')), '保存').click();
        await waitFor(
          () => rows().some((li) => rowTitle(li) === '未命名'),
          '列表出现「未命名」',
        );
        const afterClear = rowTitles();
        steps.push(`清空备注 → ${afterClear.join(' / ')}`);

        /* ── 6. 吊销中间那把（「乙-流水线」）── */
        const middle = rows().find((li) => rowTitle(li) === '乙-流水线');
        buttonIn(middle, '吊销').click();
        const dialog = await waitFor(() => document.querySelector('[role="dialog"]'), '吊销确认弹窗');
        const dialogText = dialog.innerText;
        const confirm = buttonIn(dialog, '吊销');
        if (!confirm) throw new Error(`确认弹窗里没有「吊销」按钮：${dialog.innerText.slice(0, 200)}`);
        confirm.click();
        await waitFor(() => rows().length === 2, `吊销后应剩 2 行，实际 ${rows().length}`);
        const afterRevokeOne = rowTitles();
        steps.push(`吊销中间那把 → ${afterRevokeOne.join(' / ')}`);

        /* ── 7. 😀×64 从页面提交 → 201 ── */
        const emojiNote = '😀'.repeat(64);
        // 先等「上一次的 busy 已复位」—— 否则后面读到的是 busy 造成的禁用/可用，不是这条要测的东西
        await waitFor(() => genButton() && !genButton().disabled, 'emoji 之前生成按钮可用');
        const emojiInput = await waitFor(() => noteInput(), '备注输入框（emoji）');
        setInputValue(emojiInput, emojiNote);
        await waitFor(() => noteInput().value.length === 128, `64 个 😀 应写入 128 个码元，实际 ${noteInput().value.length}`);
        const emojiCounter = bodyText().match(/备注\s*64\s*\/\s*64/);
        const beforeEmoji = keyCalls().length;
        genButton().click();
        await waitFor(() => keyCalls().length > beforeEmoji, 'emoji 创建请求发出');
        const emojiCall = keyCalls()[keyCalls().length - 1];
        await waitFor(() => noteInput().value === '', 'emoji 生成后输入框清空');
        await waitFor(() => rows().length === 3, `emoji 建完应 3 行，实际 ${rows().length}`);
        steps.push(`😀×64 提交 → HTTP ${emojiCall.status}`);

        /* ── 8. 8267 字节那条：64 字素簇 × 每簇 a+64 个组合记号 = 8267 字节 ── */
        const heavy = ('a' + '\u0301'.repeat(64)).repeat(64);
        const heavyBytes = new TextEncoder().encode(JSON.stringify({ note: heavy })).length;
        if (heavyBytes !== 8267) throw new Error(`构造错误：期望 8267 字节，实际 ${heavyBytes}`);
        // 同样先等 busy 复位。这一步必须干净：如果按钮是因为 busy 而禁用，`buttonDisabled`
        // 就成了假绿 —— 这条断言的意义全在「字节门真的拦住」上。
        await waitFor(() => genButton() && !genButton().disabled, '重负载之前生成按钮可用');
        const heavyInput = await waitFor(() => noteInput(), '备注输入框（重负载）');
        setInputValue(heavyInput, heavy);
        // 这里**不假定页面一定会拦**：给它一个渲染周期就读状态，让外层的断言去判。
        // 第一版在这里 waitFor 等「出现 8267 或按钮禁用」，门一旦被改坏就会卡满 20 秒超时，
        // 而且异常把后面的断言全带走了 —— 失败信息退化成一句超时。
        await sleep(500);
        const heavyText = bodyText();
        const heavyDisabled = genButton().disabled;
        const beforeHeavy = keyCalls().length;
        if (!heavyDisabled) genButton().click(); // 门没拦住的话，这一下会真的打出去；断言会看见
        await sleep(800);
        const afterHeavy = keyCalls().length;
        steps.push(`8267 字节输入：按钮禁用=${heavyDisabled} 新增请求=${afterHeavy - beforeHeavy}`);

        /* ── 9. 吊销全部 → 空态 ── */
        const revokeAllButton = [...document.querySelectorAll('button')].find((b) =>
          b.textContent.includes('吊销全部'),
        );
        if (!revokeAllButton) throw new Error('找不到「吊销全部」按钮');
        revokeAllButton.click();
        const allDialog = await waitFor(() => document.querySelector('[role="dialog"]'), '吊销全部确认弹窗');
        const allDialogText = allDialog.innerText;
        const allConfirm = buttonIn(allDialog, '全部吊销');
        if (!allConfirm) throw new Error(`确认弹窗里没有「全部吊销」按钮：${allDialog.innerText.slice(0, 200)}`);
        allConfirm.click();
        await waitFor(() => bodyText().includes('还没有独立密钥'), '空态出现');
        const emptyText = bodyText();
        const countAfterRevokeAll = (emptyText.match(/(\d+)\s*\/\s*20\s*把/) ?? [])[0] ?? '(没找到计数)';
        steps.push('吊销全部 → 空态');

        /* ── 10. 明文只显示一次：在弹窗里生成 → reload → 必须消失 ──
         *
         * reload 不能在这个文档里做：`location.reload()` 会销毁 evaluate 的上下文。
         * `window.open` 的弹窗不受 X-Frame-Options 约束，且父页面的 evaluate 在弹窗
         * reload 后依然存活（实测）。
         */
        const popup = window.open(location.origin + '/mcp', 'e2e-plaintext-once');
        if (!popup) throw new Error('window.open 被拦了，拿不到弹窗');
        const popupReady = () =>
          popup.document &&
          popup.document.readyState === 'complete' &&
          popup.document.querySelector('input[aria-label="新密钥的备注"]');
        await waitFor(popupReady, '弹窗里的 /mcp 渲染完成');

        const popupGen = () =>
          [...popup.document.querySelectorAll('button')].find((b) => b.textContent.includes('生成密钥'));
        await waitFor(() => popupGen() && !popupGen().disabled, '弹窗里生成按钮可用');
        await waitFor(() => !popup.document.body.innerText.includes('只显示这一次'), '弹窗加载时本没有明文块');

        // 弹窗是**全新整页加载**，而 `waitFor` 上面那些条件（readyState、输入框存在、按钮可用）
        // 在 SSR 阶段就成立了 —— React 还没水合。此时写进 DOM 的值会被随后的水合覆盖掉，
        // 表现为「值写进去了又变回空」（第一版就是这么超时的）。
        // 所以这里**以页面自己的计数为准**重试写入：`备注 10 / 64` 出现才说明 React 真收到了。
        const POPUP_NOTE = 'popup-note'; // 10 个字素簇
        await waitFor(() => {
          const el = popup.document.querySelector('input[aria-label="新密钥的备注"]');
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(
            popup.HTMLInputElement.prototype,
            'value',
          ).set;
          setter.call(el, POPUP_NOTE);
          el.dispatchEvent(new popup.Event('input', { bubbles: true }));
          return popup.document.body.innerText.includes('备注 10 / 64');
        }, '弹窗备注写入（以 React 的计数确认为准）');
        popupGen().click();
        await waitFor(
          () => popup.document.body.innerText.includes('只显示这一次'),
          '弹窗出现明文块',
        );
        // 页面里有好几个 <code>（MCP 端点、配置示例），必须按前缀取那把明文，
        // 否则会拿到 http://… 那个端点，后面的「reload 后还在不在」就永远是 true（假通过）
        const plaintext =
          [...popup.document.querySelectorAll('code')]
            .map((el) => el.textContent.trim())
            .find((t) => t.startsWith('elecmcp_')) ?? '';
        const configHadPlaintext = plaintext.length > 0 && popup.document.body.innerText.includes(plaintext);
        steps.push(`弹窗生成 → 明文长度 ${plaintext.length}`);

        const beforeReloadDoc = popup.document;
        popup.location.reload(); // 真正的整页 reload，只刷新弹窗
        // 必须等**换了一个 document**：旧文档在 reload 真正生效前依然是 complete、也还有输入框，
        // 只等 readyState 会立刻拿到旧文档，后面的断言就成了自欺（第一版就是这么假的）。
        await waitFor(
          () =>
            popup.document &&
            popup.document !== beforeReloadDoc &&
            popup.document.readyState === 'complete' &&
            popup.document.querySelector('input[aria-label="新密钥的备注"]'),
          '弹窗 reload 后的新文档',
        );
        const afterReloadText = popup.document.body.innerText;
        const plaintextStillThere = afterReloadText.includes('只显示这一次');
        const plaintextInDom = plaintext.length > 0 && afterReloadText.includes(plaintext);
        const keySurvived = afterReloadText.includes(POPUP_NOTE);
        popup.close();
        steps.push(`弹窗 reload → 明文块还在=${plaintextStillThere}`);

        Object.assign(R, {
          afterCreate,
          afterEdit,
          afterClear,
          afterRevokeOne,
          createCalls,
          emoji: {
            counterMatched: !!emojiCounter,
            posted: emojiCall.status === 201 ? 1 : 0,
            status: emojiCall.status,
          },
          heavy: {
            bytes: heavyBytes,
            buttonDisabled: heavyDisabled,
            showsBytesInText: heavyText.includes('8267'),
            textSnippet: heavyText.replace(/\s+/g, ' ').trim().slice(-200),
            requestsBefore: beforeHeavy,
            requestsAfter: afterHeavy,
            leakedRequest: afterHeavy - beforeHeavy,
          },
          revokeAll: {
            dialogText: allDialogText.replace(/\s+/g, ' ').trim().slice(0, 80),
            emptyState: bodyText().includes('还没有独立密钥'),
            countText: countAfterRevokeAll,
          },
          revokeOne: { dialogText: dialogText.replace(/\s+/g, ' ').trim().slice(0, 80) },
          plaintext: {
            generated: plaintext.length,
            prefix: plaintext.slice(0, 9) + '…',
            shownInConfigWhileFresh: configHadPlaintext,
            afterReloadStillVisible: plaintextStillThere,
            afterReloadInDom: plaintextInDom,
            keyStillListedAfterReload: keySurvived,
          },
        });
        } catch (error) {
          // 页面里等超时 / 断言落空都不要吞掉：记下来，外层每一条断言照样跑、照样报实际值
          R.error = String(error?.message ?? error);
          R.failedAfter = R.steps[R.steps.length - 1] ?? '(还没走出第一步)';
        }
        return R;
      });
      // ↑↑↑↑ 到这一行，上面 10 步已经全部在浏览器里执行完了 ↑↑↑↑

      const s = out.steps.join(' → ');

      /* ── 水合：真实整页加载 /mcp，从控制台断言零告警 ──
       *
       * 这一步不占 evaluate：`page.goto` 是导航，读 `page.consoleMessages()` 是驱动侧的事。
       * 弹窗里的 console 不走本页 session（实测），所以水合必须在本页验。
       */
      const consoleBefore = page.consoleMessages().length;
      await page.goto(`${fixture.url}/mcp`);
      await new Promise((r) => setTimeout(r, 2000));

      const fresh = page.consoleMessages().slice(consoleBefore);
      const hydrationPattern = /hydrat|did not match|server rendered|hydration failed|text content does not match/i;
      const hydrationWarnings = fresh.filter((m) => hydrationPattern.test(m.text));

      /* ── 逐条断言：全部跑完再汇总 ──
       *
       * 收集式而不是 fail-fast：一条挂了不该把后面那些「实际值」证据全带走。
       * （第一版就是 fail-fast —— 反向验证时只看到一句「页面里等超时」，看不到
       * 泄露的请求数到底是几，等于没有失败信息。）
       */
      const failures = [];
      const check = (label, run) => {
        try {
          run();
        } catch (error) {
          failures.push({
            断言: label,
            实际: String(error?.message ?? error).split('\n')[0].trim(),
          });
        }
      };
      const list = (value) => (Array.isArray(value) ? value : []);
      const obj = (value) => value ?? {};

      check('页面内的链路走完', () =>
        assert.equal(
          out.error,
          null,
          `中途断了：${out.error}｜最后完成的步骤：${out.failedAfter ?? '(无)'}｜已完成：${s}`,
        ),
      );
      check('建 3 把 → 列表 3 行', () =>
        assert.equal(
          list(out.afterCreate).length,
          3,
          `期望 3 行，实际 ${list(out.afterCreate).length} 行：${list(out.afterCreate).join(' / ')}`,
        ),
      );
      check('列表按创建时间倒序（新→旧）', () =>
        assert.deepEqual(
          list(out.afterCreate),
          ['丙-测试机', '乙-流水线', '甲-家里'],
          `期望 丙-测试机 / 乙-流水线 / 甲-家里，实际 ${list(out.afterCreate).join(' / ')}`,
        ),
      );
      check('三次创建都是 201', () =>
        assert.deepEqual(
          list(out.createCalls),
          [201, 201, 201],
          `期望 201,201,201，实际 ${list(out.createCalls).join(',')}`,
        ),
      );
      check('改备注立刻反映', () =>
        assert.ok(
          list(out.afterEdit).includes('甲-改过了') && !list(out.afterEdit).includes('甲-家里'),
          `列表里应出现「甲-改过了」且不再有「甲-家里」，实际 ${list(out.afterEdit).join(' / ')}`,
        ),
      );
      check('清空备注显示「未命名」', () =>
        assert.ok(
          list(out.afterClear).includes('未命名') && !list(out.afterClear).includes('甲-改过了'),
          `列表里应出现「未命名」且不再有「甲-改过了」，实际 ${list(out.afterClear).join(' / ')}`,
        ),
      );
      check('吊销中间那把 → 剩 2 把', () =>
        assert.equal(
          list(out.afterRevokeOne).length,
          2,
          `期望 2 行，实际 ${list(out.afterRevokeOne).length} 行：${list(out.afterRevokeOne).join(' / ')}`,
        ),
      );
      check('单把吊销的确认文案说清后果', () =>
        assert.match(
          String(obj(out.revokeOne).dialogText ?? ''),
          /客户端/,
          `确认文案里应有「客户端会失效」，实际：${obj(out.revokeOne).dialogText ?? '(没抓到弹窗)'}`,
        ),
      );
      check('吊销全部的确认文案更重', () =>
        assert.match(
          String(obj(out.revokeAll).dialogText ?? ''),
          /不可撤销|同时断开/,
          `确认文案里应有「不可撤销 / 同时断开」，实际：${obj(out.revokeAll).dialogText ?? '(没抓到弹窗)'}`,
        ),
      );
      check('😀×64 从页面提交 → 201', () =>
        assert.equal(
          obj(out.emoji).status,
          201,
          `期望 201，实际 ${obj(out.emoji).status ?? '(没发出请求)'}`,
        ),
      );
      check('页面计数显示「备注 64 / 64」', () =>
        assert.equal(obj(out.emoji).counterMatched, true, `计数没匹配上，实际 ${obj(out.emoji).counterMatched}`),
      );
      check('重负载构造正好 8267 字节', () =>
        assert.equal(obj(out.heavy).bytes, 8267, `期望 8267，实际 ${obj(out.heavy).bytes}`),
      );
      check('页面提示里出现 8267 字节', () =>
        assert.ok(
          obj(out.heavy).showsBytesInText,
          `提示文本里应有 8267，实际提示片段：${obj(out.heavy).textSnippet ?? '(没抓到)'}`,
        ),
      );
      check('字节超限时生成按钮禁用', () =>
        assert.equal(
          obj(out.heavy).buttonDisabled,
          true,
          `期望按钮禁用=true，实际 ${obj(out.heavy).buttonDisabled}`,
        ),
      );
      check('字节超限时一个请求都不发', () =>
        assert.equal(
          obj(out.heavy).leakedRequest,
          0,
          `期望新增 0 条请求，实际新增 ${obj(out.heavy).leakedRequest} 条` +
            `（${obj(out.heavy).requestsBefore}→${obj(out.heavy).requestsAfter}）`,
        ),
      );
      check('吊销全部 → 空态', () =>
        assert.equal(
          obj(out.revokeAll).emptyState,
          true,
          `期望出现空态，实际计数显示：${obj(out.revokeAll).countText ?? '(没抓到)'}`,
        ),
      );
      check('吊销全部 → 计数 0 / 20', () =>
        assert.match(
          String(obj(out.revokeAll).countText ?? ''),
          /0\s*\/\s*20/,
          `期望 0 / 20，实际 ${obj(out.revokeAll).countText ?? '(没抓到)'}`,
        ),
      );
      check('弹窗里确实生成了明文', () =>
        assert.ok(
          obj(out.plaintext).generated > 0,
          `没拿到明文，这条等于没测到东西（长度 ${obj(out.plaintext).generated}）`,
        ),
      );
      check('刚生成时配置示例带明文', () =>
        assert.equal(
          obj(out.plaintext).shownInConfigWhileFresh,
          true,
          `刚生成时配置示例里应有明文，实际 ${obj(out.plaintext).shownInConfigWhileFresh}`,
        ),
      );
      check('reload 后明文块消失', () =>
        assert.equal(
          obj(out.plaintext).afterReloadStillVisible,
          false,
          `reload 后不该再出现「只显示这一次」的明文块，实际还在`,
        ),
      );
      check('reload 后明文不在 DOM 里', () =>
        assert.equal(
          obj(out.plaintext).afterReloadInDom,
          false,
          `reload 后明文 ${obj(out.plaintext).prefix ?? ''} 仍在 DOM 里，实际 ${obj(out.plaintext).afterReloadInDom}`,
        ),
      );
      check('reload 后密钥本身仍在列表里', () =>
        assert.equal(
          obj(out.plaintext).keyStillListedAfterReload,
          true,
          `消失的应该只是明文，密钥该还在列表里，实际 ${obj(out.plaintext).keyStillListedAfterReload}`,
        ),
      );
      check('水合零告警', () =>
        assert.deepEqual(
          hydrationWarnings.map((m) => m.text),
          [],
          `控制台出现水合告警：${JSON.stringify(hydrationWarnings)}`,
        ),
      );

      /* ── 截图落地（仓库外）。放在汇总断言之前，失败时也留得下现场 ── */
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const shot = path.join(SHOT_DIR, 'mcp-keys-final.png');
      const bytes = await page.screenshot(shot, { fullPage: true });

      if (failures.length > 0) {
        assert.fail(
          `${failures.length} 条断言失败：\n` +
            failures.map((f) => `  ✗ ${f.断言}\n      ${f.实际}`).join('\n'),
        );
      }

      return {
        ...out,
        assertions: { passed: 24, failed: failures.length },
        hydration: {
          freshMessages: fresh.length,
          warnings: hydrationWarnings.length,
          seen: fresh.map((m) => `${m.type}: ${m.text.slice(0, 80)}`),
        },
        screenshot: { file: shot, bytes },
      };
    },
  },
];
