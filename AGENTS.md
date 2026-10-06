<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# 多 agent 协作约定

这个仓库同时有两个 AI 在开发。下面的分工与分支规则**对双方都生效**，动别人范围内的文件前先在 PR 里说明原因。

判断依据一句话：**「应用怎么跑」归应用开发，「怎么打包、怎么在别的平台跑」归 CI。**

## 分工

| 范围 | 负责方 |
|---|---|
| `src/**`、`mcp-server.ts`、`next.config.ts`、`scripts/**` | 应用开发 |
| `package.json` / `package-lock.json`（依赖增删） | 应用开发 |
| `fnos/App.Native.ElecMeter/**`（manifest、`cmd/*` 生命周期脚本、`config/*`、`wizard/*`、`app/*`） | 应用开发 |
| `.github/workflows/**`、`fnos/build.sh` | 多平台适配 / CI |
| `README.md`、`fnos/README.md` | 各自只改自己负责的段落，不重排全文 |

## 分支

- 应用开发：`app/<主题>`，例如 `app/mcp-key`
- 多平台 / CI：`ci/<主题>`，例如 `ci/node22-abi`
- **不直接推 `master`。** 推自己的分支 → 开 PR → 由仓库所有者合并
- 开工前先 `git fetch && git rebase Github/master`；分支活过一天就再 rebase 一次

## 发布

- **tag 和 Release 只在仓库所有者明确要求时才打。** 不要自行发版
- 版本号（`package.json` 与 `fnos/App.Native.ElecMeter/manifest` 里的 `version`）在发版时统一改，平时不动
- 只从 `master` 打 tag，且两个架构都构建成功才算发出版

## 共享文件

`package.json`、`package-lock.json`、`.gitignore`、`AGENTS.md` 是共享的。

- 改之前先确认没有别人正在动同一个文件
- `package-lock.json` **不要手工合并** —— 冲突就删掉重新 `npm install` 生成
- `AGENTS.md` 的修改走 PR，因为它是双方的共同约定

## CI 里已经踩过的坑（改之前先读 `fnos/README.md`）

这三处是修过 bug 的，不是随手写的：

1. **`node-version` 必须是 22。** 飞牛 `nodejs_v22` 提供的是 Node 22（`NODE_MODULE_VERSION` 127）。用 Node 24 编出来的 `better-sqlite3` 是 ABI 137，装到设备上 `ERR_DLOPEN_FAILED` —— 症状是**页面能打开但登录接口 500**。workflow 里有两道断言专门拦这个。
2. **arm64 的 fnpack 资源名是 `linux-arm`，不是 `linux-arm64`。** 官方文档写错了，`linux-arm64` 实际返回 404。
3. **矩阵保留 `fail-fast: false`。** 否则一个架构失败会把另一个已经跑完的 job 也取消掉，连健康的产物都拿不到。

## 排查构建产物时的一个陷阱

在压缩后的 JS 里搜特征字符串，**不要用 `Select-String` 或 `findstr`** —— 压缩后是几十万字符的单行，这两个工具超出行长度上限会**静默跳过**，报「未找到」但字符串其实在里面。用 `Get-Content -Raw` 配 `.Contains()`。
