# 参与开发

## 环境

- **Node 22**。飞牛的 `nodejs_v22` 提供的是 Node 22（`NODE_MODULE_VERSION` 127）。用 Node 24 编译出来的 `better-sqlite3` 是 ABI 137，装到设备上会 `ERR_DLOPEN_FAILED`，症状是页面能打开但登录接口 500。
- **npm**。本项目用 npm 管理依赖，不要混用 pnpm 或 yarn。
- 飞牛打包需要 `fnpack`，下载和用法见 [fnos/README.md](fnos/README.md)。

## 常用命令

```bash
npm run dev      # 本地开发，默认 3000 端口
npm run build    # 生产构建
npm run start    # 跑构建产物
npm run lint     # ESLint
npm run mcp      # 启动 stdio 版 MCP 服务（需要联网拉 tsx，见下方已知问题）
```

## 分支

从 `master` 开分支，命名 `<类型>/<主题>`：

| 类型 | 用途 | 例子 |
|---|---|---|
| `feat` | 新功能 | `feat/export-csv` |
| `fix` | 修 bug | `fix/login-401` |
| `refactor` | 重构，不改行为 | `refactor/db-layer` |
| `docs` | 文档 | `docs/api-guide` |
| `chore` | 构建、依赖、杂项 | `chore/node22-abi` |

**不直接推 `master`**，推自己的分支然后开 PR。

## 提交

用 Conventional Commits：

```
<type>(<scope>): <说明>
```

- `type`：`feat` `fix` `docs` `refactor` `test` `chore` `ci` `perf`
- `scope`（可选）：`web` `api` `db` `mcp` `fnos` `ci`
- 说明用中文，一句话讲清做了什么。正文写「为什么」，代码本身能看出来的不用重复。

```
feat(mcp): MCP 密钥改成哈希存储，明文只显示一次

原来密钥直接存明文，拿到数据库就能用。改成存 SHA-256 哈希，
生成时返回一次明文，之后无法再取出。
```

### 正文的视角：写代码，不写协作过程

提交信息是给**未来读代码的人**看的。他不知道、也不需要知道这个改动是谁在什么时候
提出来的、经过了谁的验证。所以：

| 不要写 | 要写 |
|---|---|
| `task-42 汇报里说「非对象 → 400」不成立` | `null body 在 5 处路由返回 500，与其它非对象值不一致` |
| `QA 实测发现 JSON 解析错误会引用输入` | `实测：JSON 解析错误的 message 会引用输入约 11 个字符` |
| `devops 报的机制是错的` | `原注释的机制与实际不符：实际是…` |
| `按 Lead 的要求给 15 处 catch 补日志` | `15 处 catch 只返回 500、异常不留痕，运维无法诊断` |

**判据**：把这条提交单独拎出来给一个不认识这个项目协作方式的人看，他能不能只看懂
「哪里错了、为什么改、怎么验的」。看不懂就是写错了。

**验证证据要留，只换主语。** 实测数字、复现命令、反向验证（改坏看它红不红）这些
是有价值的，保留 —— 但主语是「怎么验的」，不是「谁验的」。

## 质量门

提交 PR 之前，本地必须跑通：

```bash
npm run lint
npm run build
```

两个都过才有资格提 PR。CI 只在打 tag 时构建 fpk，**不会替你做类型检查和 lint** —— 别指望 CI 兜底。

涉及 `src/**` 或 `fnos/**` 的改动，还要起一次服务实测受影响的流程（登录、读数、导出、打包升级等），在 PR 里写明怎么测的。

## PR

- **一个 PR 一件事**。顺手改的无关内容拆出去。
- 用 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)，写清：改了什么 / 为什么 / 怎么验证的 / 影响面。
- 改了 `fnos/App.Native.ElecMeter/**` 的，附上构建出的 fpk 的 SHA256。
- 改了两侧接口（见 [docs/architecture.md](docs/architecture.md#接口契约)）的，在 PR 里显式指出，不要只改一边。

## 评审

评审看四件事：

1. 逻辑对不对，边界情况有没有处理
2. 有没有破坏既有行为（尤其 DB schema 和 API 返回结构）
3. 有没有更简单的做法
4. 是否遵守本文和 [docs/coding-standards.md](docs/coding-standards.md)

结论只有三种：通过、改了再审、说明理由后保留。第三种要在 PR 里留下理由。

## 发布

见 [docs/release.md](docs/release.md)。要点：**版本号平时不动，tag 只在明确要发版时打。**

## 目录职责

| 目录 | 内容 |
|---|---|
| `src/app/**` | 页面（App Router）和 API 路由 |
| `src/app/api/**` | HTTP 接口 |
| `src/components/**` | React 组件 |
| `src/lib/**` | 数据访问、认证、业务逻辑、工具 |
| `src/types/**` | 共享类型 |
| `mcp-server.ts` | stdio 版 MCP 服务（根目录） |
| `scripts/**` | 一次性脚本，`node` 直接跑 |
| `fnos/App.Native.ElecMeter/**` | 飞牛应用包定义（manifest、生命周期脚本、打包产物） |
| `.github/workflows/**` | CI |
| `docs/**` | 项目文档 |

## 已知问题

- **`npm run mcp` 依赖联网**。脚本是 `npx tsx mcp-server.ts`，但 `tsx` 不在 `devDependencies` 里，`npx` 会去网上现拉。断网环境这个入口不可用。
- **没有自动化测试**。当前全靠人工验证，见 [docs/coding-standards.md](docs/coding-standards.md#测试)。

## 文档

- [docs/architecture.md](docs/architecture.md) —— 架构、数据流、接口契约
- [docs/coding-standards.md](docs/coding-standards.md) —— 代码规范
- [docs/release.md](docs/release.md) —— 发布流程
- [CHANGELOG.md](CHANGELOG.md) —— 变更记录
