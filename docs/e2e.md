# 端到端测试（E2E）

一条命令跑完，给一份 pass/fail 清单：

```bash
npm run build          # e2e 跑的是 standalone 产物，先构建
npm run test:e2e
```

跑之前**不需要**手动起服务、改数据库路径、找空端口 —— 那些由 `scripts/lib/fixture.mjs` 包了。
跑完不需要手动收尾：浏览器进程树、临时数据目录、端口都由代码收干净。

## 为什么要这层

原来的成本不在浏览器慢，而在**每一步都要过一次模型**：

```
起服务（手搓 standalone + 临时库 + 随机端口）
  → 点一下，等模型思考
  → 再点一下，等模型思考
```

`scripts/lib/cdp.mjs` 把「点一下一个回合」压成**一次往返跑完整条链路**：传一个 async 函数
给 `page.evaluate()`，等元素、填表、点击、等跳转、读 DOM 全在页面里跑完。

## 第一原则：大多数验收不该开浏览器

浏览器是最后手段，不是默认手段。**开之前先问：这条断言在 HTTP 层能不能做？**

| 要断的东西 | 用什么 | 例子 |
|---|---|---|
| 认证 / 授权 | `fixture.http` | 未登录 401、cookie 过期、登出后失效、无效密钥 |
| API 契约 | `fixture.http` | 字段名与结构、脱敏黑名单、分页参数 |
| 状态码 | `fixture.http` | 400 / 401 / 403 / 404 / 500 的分支 |
| 迁移 | `fixture.http` + 临时库 | 表结构、老库升级、schema 初始化 |
| 响应头 | `fixture.http` | `Set-Cookie` 属性、`WWW-Authenticate`、`Content-Type` |
| 备份 / 导出往返 | `fixture.http` | 下载再上传、文件内容 |
| **水合** | 浏览器 | SSR 出来的 HTML 与客户端渲染是否一致 |
| **布局** | 浏览器 | 元素位置、可见性、溢出、响应式断点 |
| **剪贴板** | 浏览器 | 权限、异步写入、内容正确 |
| **截图像素** | 浏览器（真机更好，见下） | 视觉回归 |
| **真实交互链路** | 浏览器 | 填 → 点 → 等 → 读，多步连起来才有意义的那种 |

`scripts/e2e/run.mjs` 会在**没有任何用例需要浏览器时直接不开浏览器**，并在输出里说明。
这不是省几秒，是让「该在哪层测」这件事有可见的反馈。

## 两个库

### `scripts/lib/fixture.mjs`

```js
import { start } from '../lib/fixture.mjs';

const fx = await start();                 // 默认端口 16900，方便复用 cookie 与调试
const res = await fx.http.get('/api/auth/check');
await fx.http.login();                    // 登录后 cookie 自动带上
const out = await fx.http.get('/api/settings');
await fx.stop();
```

- **不会自己构建**。产物不在就报「先跑 `npm run build`」—— 构建几十秒，该由你决定什么时候付。
- 临时 `ELEC_DB_PATH` / `ELEC_BACKUP_DIR` 放在系统临时目录，`stop()` 时删掉。
- 端口默认固定，被占用时给的是「谁占的、怎么换、怎么清」而不是一句 `ECONNREFUSED`。
  想随机用 `start({ port: 0 })`，代价是地址每次都变。
- 就绪判据是**轮询 HTTP 状态码**（`/api/auth/check` 期望 401），不是 TCP 通就算好 ——
  端口通了不等于路由活了。超时会把服务输出一起打出来。
- `http` 的 cookie jar 是 **fixture 级共享**的。需要干净状态的用例自己调 `fx.http.clearCookie()`，
  否则会踩到「上一条用例已经登录过」这类顺序依赖。
- 故意不导出 `ELEC_DB_PATH` 的默认值：每个用例该在自己的临时库里跑。

### `scripts/lib/cdp.mjs`

零依赖 —— 只用 Node 自带的全局 `WebSocket` 直接说 DevTools 协议。**不引 playwright / puppeteer。**

```js
import { launch } from '../lib/cdp.mjs';

const browser = await launch();           // E2E_BROWSER / CHROME_PATH / EDGE_PATH 可覆盖
const page = await browser.newPage();
await page.goto(`${fx.url}/login`);

// 一次往返，整段流程在页面里跑完
const out = await page.evaluate(async () => {
  const steps = [];
  const waitFor = async (check, label) => { /* ... */ };
  const input = await waitFor(() => document.querySelector('input#password'), '密码框');
  input.value = 'admin';
  document.querySelector('button[type=submit]').click();
  await waitFor(() => location.pathname !== '/login', '跳转');
  return { steps, path: location.pathname, body: document.body.innerText.length };
});

await browser.close();                    // 杀进程树 + 删临时 profile
```

- `evaluate(fn, ...args)`：传函数或表达式。函数会被序列化后在页面里执行，
  用 `awaitPromise` 等它的 promise —— 所以 `async () => {...}` 能跑完一整段流程。
  返回值要能 JSON 序列化（`returnByValue`）。
- `screenshot(path, { fullPage })`：写 PNG，返回字节数。
- `consoleMessages()`：页面的 `console.*`、`Log` 条目、未捕获异常都会收到。
- `grantPermissions(['clipboardReadWrite','clipboardSanitizedWrite'], origin)`：
  **无头下不给权限，剪贴板调用会被直接拒**。
- `setViewport(w, h, dpr)`：复现真机 DPR。
- `close()`：杀进程树（Windows 用 `taskkill /T /F`）、等退出、删临时 profile。
  不调它会在机器上留 headless 进程 —— 这是这类工具最容易留下的垃圾。

## 无头浏览器的诚实边界

这些差异是真实存在的，别把无头结果当成真机结论：

| 维度 | 差异 | 影响 |
|---|---|---|
| **字体** | 无头机器上装的字体可能和真机不同，回退字体不同 | 文字宽度、换行位置会变 |
| **像素** | 抗锯齿、子像素渲染、字体 hinting 与真机不同 | **像素级对比会误报** |
| **DPR** | 默认 1，真机常见 2 / 3 | 位图资源、1px 边框的观感不同 |
| **GPU** | 无头常带 `--disable-gpu` | canvas / WebGL / 视频帧可能不一致 |
| **扩展** | 干净 profile，没有用户装的扩展 | 真机上扩展会改 DOM |
| **交互** | 没有真实的系统对话框、打印预览、通知、文件选择器 | 这些路径验不了 |
| **剪贴板** | 必须显式授权，且没有真实剪贴板历史 | 只能验「写进去了」，验不了「能粘贴到别处」 |

**结论**：像素级对比、字体渲染、真实设备观感 —— **仍然要真机浏览器**。
无头浏览器适合断「结构、状态码、DOM 内容、流程是否走通」，不适合断「好不好看」。

## 一次跑完的画法

**反模式**：一个动作一次 `evaluate`。

```js
// 差：三次往返，每次都要在外面思考下一步
await page.evaluate(() => document.querySelector('#password').value = 'admin');
await page.evaluate(() => document.querySelector('button').click());
const path = await page.evaluate(() => location.pathname);
```

**要的写法**：一段流程一次往返，中间的等待和判断都在页面里。

```js
// 好：一次往返 + 页面内的轮询等待
const out = await page.evaluate(async () => { /* 等 → 填 → 点 → 等 → 读 */ });
```

判断标准：**函数里出现第 3 个 `await` 时，它就该是一个 `evaluate` 而不是三次调用。**

## 自检：确认这道门真的会红

```bash
npm run test:e2e -- --probe-failure
```

插入一条必然失败的断言，确认跑者给出**非零退出码**并列出失败清单。
「红着的门等于没有门」在这里的具体版本：**只证明过绿会绿，等于没证明过这道门**。

## 善后：不留垃圾

跑完（或 Ctrl+C）会收掉三样：浏览器进程树、临时 profile 目录、临时数据目录，并确认端口已释放。
正常结束时会看到：

```
· 浏览器已关（进程树已杀，临时 profile 已删）
· fixture 已停：进程退出=true 端口释放=true 临时目录删除=true
```

**硬杀的兜底**：进程被 `taskkill /F`、被管道掐断、终端直接关掉时，收尾代码根本没机会跑。
所以 `start()` / `launch()` 启动时会顺手清掉 `%TEMP%` 下 `elec-cdp-*` / `elec-e2e-*` 中
**超过 2 小时没被碰过**的目录 —— 只动这两个前缀，刚创建的一律不碰（那是正在用的）。
清到了会在输出里说一声。

> 这条兜底不是凭空加的：我自己用 `Select-Object -First 16` 掐断管道跑测试，就把
> `elec-cdp-*` 和 `elec-e2e-*` 各留了一个。**别用会掐断管道的方式跑 e2e。**

## 新增用例

在 `scripts/e2e/` 下加一个 `.mjs`（`_` 开头的会被跳过），导出 `cases`：

```js
export const cases = [
  {
    name: '未登录访问 /api/settings → 401',
    needsBrowser: false,                       // 不需要浏览器就别要
    fn: async ({ fixture, assert }) => {
      const res = await fixture.http.get('/api/settings');
      assert.equal(res.status, 401);
      return { status: res.status };           // 返回值会原样打进输出，当证据用
    },
  },
];
```

`ctx` 里有 `{ fixture, browser, page, assert }`。用例抛异常即失败，用 `node:assert/strict` 就够，
不用引断言库。
