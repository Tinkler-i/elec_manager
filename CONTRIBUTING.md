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
- 说明用中文，祈使句（「改成…」「补上…」），**不超过 50 字**，句末不加句号

### 正文：默认不写

**大多数提交只有一行标题就够了。** 只在「为什么」无法从标题和 diff 里看出来时才写正文，
且**不超过 5 行**。

正文解释**为什么改**。不解释**怎么改**（diff 就在下面），也不解释**怎么验的**（那是
报告的事，不是历史的事）。

### 什么不该出现在提交信息里

| 不要写 | 为什么 |
|---|---|
| 验证过程与数字（`实测 37 项全过`、`8192 → 201`） | 那是报告的内容。历史里没人靠这个做判断 |
| 谁发现的、谁要求的（`QA 实测发现`、`按 Lead 的要求`） | 未来读代码的人不知道这些指代 |
| 任务编号（`task-42`） | 仓库外的东西，历史里查不到 |
| 时间线叙述（`这次`、`上次`、`之前是…后来改成…`） | 历史是快照，不是日记 |
| 工具原始输出、堆栈 | 同上 |

### 判据（两条都要满足）

1. **标题单独拎出来，能不能看懂「改了什么」**
2. **正文里有没有任何一句只在讲「这件事是怎么被发现 / 怎么被验证的」** —— 有就是写错了

### 例子

```
feat(mcp): MCP 密钥支持多把，每把可加备注

原来只能存一把，没法区分哪把给哪个客户端用。
```

```
fix(api): 请求体不是合法 JSON 时不再记录请求体内容

V8 的解析错误会引用原始输入约 11 个字符，密码这类短值会整段进日志。
```

### 验证证据写在哪

写进**报告**（`D:\Code\AI\Elec\team\reports\`，在仓库外，不进版本控制）。

> 这条**推翻**了早先的写法。早先写的是「验证证据要留，只换主语」，结果是提交信息被
> 写成了一份几十行的报告 —— 实测数字、复现步骤、工具输出全在里面。问题不在「留不留
> 证据」，在于**放错了地方**：提交信息是给未来读代码的人看的历史快照，他要的是「改了什么、
> 为什么」，不是「当时怎么验的」。证据本身有价值，价值在报告里。
>
> 别再改回去。

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
