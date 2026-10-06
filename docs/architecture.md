# 架构

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16（App Router、Turbopack） |
| UI | React 19、Tailwind CSS v4、shadcn（base-nova 风格，基于 `@base-ui/react`） |
| 数据库 | SQLite，通过 `better-sqlite3`（同步 API） |
| 认证 | `jose`（Edge 中间件）+ `jsonwebtoken` / `bcryptjs`（服务端） |
| MCP | `@modelcontextprotocol/sdk`，同时提供 HTTP 和 stdio 两种接入 |
| 打包 | 飞牛 fpk（`fnpack`）+ Docker |

## 部署形态

两种，共用同一份代码：

**飞牛应用包**。`fnos/App.Native.ElecMeter/` 是包定义，`cmd/main` 是生命周期入口。它设置环境变量、拉起 Next 服务、把数据写到飞牛的持久化目录。CI 打 tag 时构建 amd64 和 arm64 两个架构。

**Docker**。`Dockerfile` 多阶段构建，产物是 Next 的 standalone 输出。

## 目录与数据流

```
浏览器
  │
  ├─ 页面 (src/app/*/page.tsx) ── 客户端组件 (src/components/**)
  │                                      │
  └─ fetch ──────────────────────► src/app/api/**/route.ts
                                         │
                                         ▼
                                    src/lib/**  ──►  better-sqlite3  ──►  SQLite 文件
                                         ▲
                                         │
                              MCP (HTTP /api/mcp、stdio mcp-server.ts)
```

页面和组件不直接读数据库。所有数据访问都经过 `src/lib/`，API 路由是唯一的 HTTP 出口。MCP 复用同一套 `src/lib/`，不另写一份查询。

## 模块边界

| 模块 | 位置 | 职责 |
|---|---|---|
| 页面 | `src/app/**/page.tsx`、`layout.tsx` | 路由、服务端取数、页面骨架 |
| API | `src/app/api/**/route.ts` | 参数校验、鉴权、调 `src/lib/`、拼返回结构 |
| 组件 | `src/components/**` | 展示与交互，不含数据访问 |
| 数据访问 | `src/lib/db.ts` | SQLite 连接、schema 初始化、查询函数 |
| 认证 | `src/lib/auth.ts` | 密码校验、JWT 签发与验证 |
| 代理 | `src/proxy.ts` | Next 16 的中间件，路由级鉴权与放行名单 |
| MCP | `mcp-server.ts`、`src/lib/mcp-server.ts` | 把业务能力暴露成 MCP 工具 |
| 打包 | `fnos/App.Native.ElecMeter/**` | 生命周期脚本、环境变量、包元数据 |

**改动规则**：动 `src/lib/db.ts` 的导出函数签名，等于改了 API 和 MCP 两边的契约，必须同时检查调用方。

## 接口契约

这三处是跨模块的约定，改一边不改另一边会在设备上炸，且编译器查不出来。

### 1. 环境变量

`cmd/main` 实际只设置两个：`ELEC_DB_PATH` 和 `ELEC_BACKUP_DIR`。其余是应用侧的可选覆盖。

| 变量 | 谁设置 | 谁读取 | 说明 |
|---|---|---|---|
| `ELEC_DB_PATH` | `cmd/main:70` | `src/lib/db.ts:5`、`src/lib/auth.ts:22` | SQLite 文件路径 |
| `ELEC_BACKUP_DIR` | `cmd/main:71` | `src/lib/db.ts:20` | 备份目录 |
| `ELEC_DATA_DIR` | **没人设置** | `src/lib/db.ts:17` | 可选覆盖，不设时回退到 `dirname(ELEC_DB_PATH)` |
| `ELEC_UPDATE_REPO` | **没人设置** | `src/app/api/update/route.ts:20` | 更新检查读的仓库，有默认值 |
| `JWT_SECRET` | **没人设置** | `src/lib/auth.ts:17`、`src/proxy.ts:36` | 不设时由 `auth.ts` 读或生成 `jwt_secret` 文件 |
| `GITHUB_TOKEN` | 可选 | `src/app/api/update/route.ts:63` | 提高 GitHub API 配额，匿名只有 60 次/小时 |

飞牛侧把 `ELEC_BACKUP_DIR` 指向 `TRIM_PKGVAR`（升级后保留的目录）。**任何写备份的代码都必须走 `src/lib/db.ts` 导出的 `BACKUP_DIR`，不要自己拼 `process.cwd()`** —— 安装目录在升级时整体替换，写进去的备份会跟着没。

`JWT_SECRET` 这条有个已知陷阱：`proxy.ts` 只读环境变量，而这个变量要等 `auth.ts` 第一次运行（登录接口被调用）才被设置。**冷启动后、`auth.ts` 运行之前，proxy 无法验证任何 token**，会把有效 cookie 误判成失效并跳转登录页。

### 2. 数据库 schema

表结构在 `src/lib/db.ts` 的初始化逻辑里。改动只能追加，不能删列或改列类型 —— 设备上的库有真实数据（当前 523 条读数）。需要改结构时写迁移，别指望重建表。

### 3. HTTP 返回结构

`src/app/api/**` 的 JSON 结构是对外契约，改字段名或删字段要同步改所有调用方（页面、组件、MCP）。

## 鉴权

两条路径：

- **会话**。登录签发 JWT，`src/proxy.ts` 放行白名单之外的路径，其余要求有效会话。
- **MCP 密钥**。`elecmcp_` 前缀的密钥，库里只存 SHA-256 哈希，明文只在生成时返回一次。`/api/mcp` 同时接受会话和密钥，`/api/mcp/key` 只接受会话。

`src/proxy.ts` 的 `PUBLIC_EXACT_PATHS` 是精确匹配。加路径时注意别把子路径一起放行 —— `/api/mcp` 放行不等于 `/api/mcp/key` 放行。

## 为什么这么设计

几个不那么直观的选择，避免以后有人「顺手优化」掉：

**为什么 `better-sqlite3` 是 external 包**。Next 的打包器处理不了原生模块，`next.config.ts` 里把它列进 `serverExternalPackages`，否则运行时找不到 `.node` 文件。

**为什么认证用两套 JWT 库**。`src/proxy.ts` 跑在 Edge runtime，只能用 Web Crypto 兼容的 `jose`；`src/lib/auth.ts` 跑在 Node runtime，用 `jsonwebtoken`。不要为了统一而合并 —— 合并后必有一边跑不起来。

**为什么 `cmd/main` 里的路径判断这么多**。飞牛的安装目录（`TRIM_APPDEST`）在升级时整体替换，持久化目录（`TRIM_PKGVAR`）保留。数据、备份、日志必须落在持久化目录里。
