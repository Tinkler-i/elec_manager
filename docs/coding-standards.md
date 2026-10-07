# 代码规范

## TypeScript

- 保持 `tsconfig.json` 的 strict 开着。不要用 `any` 绕类型；确实表达不了时用 `unknown` 加类型收窄。
- 类型写在 `src/types/` 或紧邻实现的位置。跨模块复用的类型放 `src/types/`。
- 不要用 `as` 强转来消除报错。报错通常说明数据来源不可靠，去查来源。

## React 与 Next 16

- 默认写服务端组件。需要状态、事件、浏览器 API 时，在文件顶部加 `'use client'`，并尽量把它推到叶子节点 —— 客户端组件会把它下面的整棵子树一起拖进 bundle。
- 取数在服务端组件里直接调 `src/lib/`，不要为了「统一」再包一层 fetch 打自己的 API。
- 路由级鉴权写在 `src/proxy.ts`，不要在每个页面里重复判断。
- **Next 16 把 `middleware` 改名成了 `proxy`**，文件是 `src/proxy.ts`。写新代码前先看 `node_modules/next/dist/docs/` 里的对应文档，这个版本的 API 和记忆里的可能不一样。

这一版还有几处和记忆里不一样，都已实测确认：

- **`error.tsx` 的重试函数叫 `unstable_retry`，不是 `reset`。** `reset` 只清除错误状态、重渲染子树，**不会重新取数** —— 服务端那次失败会原样复现，「重试」等于坏的。要重新取数必须用 `unstable_retry`。
- **`_` 前缀的目录不进路由。** 这是私有目录约定，`src/app/_foo/page.tsx` 在构建产物里根本不存在。调试用的临时路由别用下划线开头。
- **服务端组件读数据库不会自动变成动态渲染。** 没有 `cookies()` / `headers()` / `searchParams` 这类动态 API 的页面默认静态预渲染，`better-sqlite3` 读出来的数据会在 **build 时被烤进 HTML**。读数据库的页面必须显式 `export const dynamic = 'force-dynamic'`，否则测试时看着正常、上线后数据不更新。
- **错误态不在 SSR 的 HTML 里。** 服务端渲染抛错时浏览器先拿到 500 和 Next 的默认错误壳，水合之后才由 `error.tsx` 渲染出错误 UI。判断「错误态对不对」要看水合后的页面，不能只看 HTML。

## 样式

- Tailwind v4，配置在 `postcss.config.mjs`，不再有 `tailwind.config.js`。
- 复用 `src/components/ui/` 里的基础组件，不要为了一个小差异复制一整套。
- 条件类名用 `cn()`，不要手拼字符串。

## 数据访问

- 所有 SQL 写在 `src/lib/db.ts`，页面、API、MCP 都调它导出的函数。
- 不要绕过 `db.ts` 自己开 SQLite 连接。
- 写文件的路径从 `db.ts` 导出的常量取（`DATA_DIR`、`BACKUP_DIR`），不要自己拼 `process.cwd()`。

## 错误处理

- API 路由里，参数错误返回 400 并说明哪个字段不对；未认证返回 401 且带上 `WWW-Authenticate`；服务端异常返回 500，日志里留堆栈，响应体里不要带堆栈。
- 不要吞异常。捕获后要么处理，要么往上抛，不要 `catch {}` 了事。
- 客户端 `fetch` 失败要给用户看得懂的话，不要把原始错误对象直接渲染出来。

### `catch` 必须留痕

**规则**：`catch` 块必须留下服务端痕迹（`console.error` 或等价手段）。只返回响应、把异常对象丢掉是不允许的 —— 调用方拿到 500，但没人知道为什么。

> 上面「日志里留堆栈」「不要吞异常」两条其实早就写着，但 2026-10 实测发现 15 处 API 路由的 `catch` 全是「返回 500 + 中文文案、不留任何痕迹」。**规则写在文档里不等于会被执行** —— 所以下面把判断方法也写出来，而不是只留一句结论。

**怎么判断一个「声明了却没用到」的 `error` 参数是「参数多余」还是「漏日志」**：靠事实，不靠形状。

| 要查的事实 | 怎么查 | 结论 |
|---|---|---|
| **有没有返回假成功** | `catch` 里是不是返回了 2xx | 返回了成功 → 失败被藏起来了，**比 warning 严重，单独报** |
| **异常有没有留痕** | 有没有 `console.error` 之类 | 没留痕 → **补日志**，不是删参数 |

> 这张表是**评审规则**，不是观测记录：task-37 的样本里只出现了第二行（没有一处返回假成功，也没有一处留痕）；第一行「返回 2xx」**没有实测样本**，是从判据推出来的。

这 15 处 `catch (error)` 的形状**完全一样**（都是「返回 500 + 中文文案」），所以**形状分不出来**该删参数还是该补日志。那次实测里两条事实是：没有一处返回假成功（失败没被藏），但**一处都没留痕**（运维无法诊断）—— 于是结论是补日志，`error` 参数自然被用上，lint 的 `no-unused-vars` 也随之消失。

**warning 消失是结果，不是目的。** 别把「`error` 未使用」当成「把参数删掉」的命令；先问这个参数为什么在这儿。

**先例**：`src/app/api/auth/login/route.ts` 的 `catch` 一直是先 `console.error(...)` 再返回通用文案，其余 15 处已与它统一（文案用中文，与响应体文案对齐）。

**运行时证据**：把 `ELEC_BACKUP_DIR` 指向一个普通文件触发备份失败路径 —— 补日志前客户端拿到 500 而服务端**零输出**；补上之后同一条路径输出
`创建备份失败: SqliteError: unable to open database file ... code: 'SQLITE_CANTOPEN'`。

**日志里不得出现请求体、凭据或文件内容**（2026-10 真实凭据泄漏事故）：

`await request.json()` 解析失败抛的 `SyntaxError`，**V8 会把原始输入的约 11 个字符窗口拼进 message**。路由的 catch 一记日志，请求体片段就进了服务端日志。实测（standalone 构建 + 真实 HTTP）：

```
登录失败: SyntaxError: Unexpected token 'S', ..."assword": SuperSecre"... is not valid JSON
登录失败: SyntaxError: Unexpected token 'S', "ShortQA1" is not valid JSON
```

- 长值泄漏**前缀**：`SuperSecretQA12345` → `SuperSecre`
- **短值（≤11 字符）整体泄漏**：`ShortQA1` → 完整进日志
- 只有**结构错误**（例如值没加引号）才触发；合法 JSON 不泄漏

**修法**：解析统一走 `src/lib/read-json.ts` 的 `readJson(request)`，失败返回 **400「请求体不是合法 JSON」**，日志只写固定文案。6 处：`auth/login`、`auth/password`、`readings`、`readings/[id]`、`readings/batch-delete`、`settings`。修后重放同样的请求，日志里 `SuperSecre` / `ShortQA1` **0 命中**。

**其它 catch 的日志成分**（构造失败后读真实日志得到的，不是读代码推断的）：

| 日志 | 里面有什么 | 有客户端输入吗 |
|---|---|---|
| `请求体不是合法 JSON（按 400 处理；内容不入日志）` | 固定文案 | 无 |
| `创建备份失败: SqliteError: unable to open database file` | sqlite 错误码 | 无 |
| `获取备份列表失败: Error: ENOTDIR ... scandir '<BACKUP_DIR>'` | 服务端配置的目录路径 | 无 |
| `MCP 工具 backup_database 失败: SqliteError: ...` | 工具名 + 错误码 | 无 |
| `删除备份失败: Error: EPERM ... unlink '<BACKUP_DIR>\<客户端传的文件名>'` | 路径里含 `path.basename(file)` | **有，见下** |

better-sqlite3 的异常**不带 SQL 参数**（实测 `UNIQUE constraint failed: t.id`、`NOT NULL constraint failed: t.notes`、`no such table: missing` 都只有表/列名；只有把值拼进 SQL 文本才会回显，而本仓库的 SQL 全是 `?` 占位符）。

**已知残余（如实记录，不当成已解决）**：`DELETE /api/backup?file=` 和 `GET /api/backup?file=` 走 fs，失败时错误消息的路径含 `path.basename(客户端传的文件名)`。它被限制在单段路径内、不含内容，与访问日志里的 URL 同级，按**可接受残余**处理；要做到「日志里零客户端输入」，把这两处 catch 改成只记错误码。

**这一条没有 lint 兜底**：`no-restricted-syntax` 只看「catch 块里有没有 `console.*` 调用」，**看不出参数里是不是带用户输入** —— `console.error('x:', error)` 照样过。只能靠评审和这条规范。

**门禁覆盖到哪（2026-10 更新过）**：`eslint.config.mjs` 里有 `no-restricted-syntax` 规则，覆盖**两个「错误只回给调用方、服务端零痕迹」的出口**，范围内共 **26 处 catch**（`src/app/api` 17 + `src/lib/mcp-server.ts` 9），全部有日志：

| 覆盖 | 为什么是这两处 |
|---|---|
| `src/app/api/**/*.ts` | HTTP 层：异常 → 500 + 服务端日志 |
| `src/lib/mcp-server.ts` | MCP 工具：异常 → `errorResult` 回给客户端（一个 AI agent）。**比 HTTP 更隐蔽** —— 浏览器至少有个 500 让人看见，而 agent 收到 `isError` 之后可能静默重试 / 换参数 / 直接放弃，运维完全不知道发生过 |

**反向验证**（两处都做过）：删掉 `src/app/api/stats/route.ts` 或 `src/lib/mcp-server.ts` 里任一处 `console.error` → `npm run lint` exit 1，报 `no-restricted-syntax`。

规则上线时抓出**第 17 处**：`src/app/api/update/route.ts` 的 `catch (e)` —— 它用了 `e`（拼错误文案），所以当初的 `no-unused-vars` 没报它，但它同样没留痕，已补 `console.error`。**告警只能发现「变量没用」，发现不了「该记没记」**，这就是要单独立规则的原因。

**规则的一个已知误报**：`catch (e) { throw e; }`（**重抛、块里没有 `console.*`**）也会被判红。语义上这是误报 —— 重抛没有吞掉异常，错误会往上传播。

**不放宽 selector**：放宽到允许 `ThrowStatement`，会同时放过 `catch { throw new Error('generic') }`（把原始错误丢掉的那类），而 selector 分不出这两者。宁可偶尔误报一次让人看一眼，也不要开一条分不出来的口子。

**遇到时不要用注释禁用**：确认是「保留原始错误的重抛」就在评审里放行；如果是「转译后重抛」（如 `src/lib/api.ts` 把网络错误转成 `ApiError`，见下面「不覆盖的地方」），说明为什么。当前 `src/app/api/**` 与 `src/lib/mcp-server.ts` 里**没有**这种写法（基线干净），所以是**潜在**误报、不是现行问题。

**不覆盖的地方 —— 不是漏了，是这些「静默」有意为之**（一刀切只会逼出注释禁用，等于把门关掉）：

- `scripts/**` —— 测试脚本里清理临时目录、解析 SSE 的 `catch {}`：清理失败本来就该静默，报出来反而会掩盖真正的测试结果。`eslint.config.mjs` 里也写了这条理由。
- `src/proxy.ts` —— token 校验失败是**预期控制流**（401 / 跳登录页），不是异常。
- `src/lib/api.ts` —— 网络失败是**转译成 `ApiError` 后重抛**，调用方会看到。
- `src/lib/auth.ts` —— 读不到 `jwt_secret` 文件就**继续生成**，刻意忽略并继续。
- 客户端组件（`src/components/**`、页面）—— 用 toast 告知用户，不需要服务端日志。

**规则本身拦不住的**：

- **日志内容有没有意义** —— 它只看「块内有没有调用 `console.*`」，`console.error('x')` 不带异常对象也能过。
- **换成别的 logger** —— 规则认的是 `console`，换 logger 要同步改规则。

本节原来写的是「这条规则没有 lint 规则兜底」，加了规则之后那句已经不成立，已改成本段。

## 命名

| 对象 | 风格 | 例子 |
|---|---|---|
| 文件（组件） | kebab-case | `navigation-dock.tsx` |
| 文件（工具） | kebab-case | `mcp-key.ts` |
| React 组件 | PascalCase | `NavigationDock` |
| 函数 / 变量 | camelCase | `verifyMcpKey` |
| 常量 | UPPER_SNAKE | `BACKUP_DIR` |
| 类型 / 接口 | PascalCase | `ReadingRecord` |
| 数据库表 | snake_case | `auth_password` |
| 环境变量 | `ELEC_` 前缀 + UPPER_SNAKE | `ELEC_DB_PATH` |

## 注释

写「为什么」，不写「做了什么」。代码能看出来的不用注释。

```ts
// 好：解释了不直观的约束
// 飞牛升级会整体替换安装目录，备份必须落在 TRIM_PKGVAR 下
const dir = BACKUP_DIR;

// 差：重复代码
// 设置备份目录
const dir = BACKUP_DIR;
```

改 bug 时如果原因是某个外部约束，把约束写进注释 —— 否则下一个人会把它「优化」掉。

## 测试

**已有自动化测试，但覆盖面有限**（这句话 2026-10 更新过：之前写的是「当前没有自动化测试，全靠人工验证」，已经不符合实际）：

- `npm test` → `scripts/test-calculations.ts`：纯函数与统计口径（图表取数、月度用电量、级联修正、设置白名单、备份目录）。
- 构建之后跑两个真实进程校验：`scripts/test-cold-start.mjs`（冷启动会话）、`scripts/test-backup-http.mjs`（备份往返）。
- `npm run test:e2e` → `scripts/e2e/*.mjs`：起临时库 + 真实浏览器跑端到端。**开浏览器之前先读 [docs/e2e.md](e2e.md#第一原则大多数验收不该开浏览器)** —— 认证、状态码、响应头这些在 HTTP 层断就行，开了浏览器反而更慢更脆。
- `npm run build` 的 postbuild → `scripts/lib/check-standalone-clean.mjs`：检查 `.next/standalone` 顶层是否被 trace 脏了。

以上都在 CI 里跑。下面这个顺序是给**新增**测试用的。

1. **纯函数**（`src/lib/` 里不碰数据库的）—— 用 `node --test`，不需要额外框架。
2. **数据访问层** —— 对临时 SQLite 文件跑，覆盖 schema 初始化和主要查询。
3. **API 路由** —— 覆盖鉴权分支（有会话 / 无会话 / 密钥 / 无效密钥）和参数校验。

**不要为了覆盖率写测试。** 优先覆盖曾经出过问题的地方：登录鉴权、ABI 相关的构建产物、备份路径。

人工验证的最低要求见 [CONTRIBUTING.md](CONTRIBUTING.md#质量门)。

## 禁止事项

- 不要把 `node_modules`、构建产物、`.next/`、`data/` 提交进仓库（`.gitignore` 已覆盖）。
- 不要在代码里硬编码路径、端口、密钥。
- 不要改 `package-lock.json` 的手工合并结果。冲突就删掉重新 `npm install` 生成。
- 不要在没有迁移的情况下改数据库表结构。
