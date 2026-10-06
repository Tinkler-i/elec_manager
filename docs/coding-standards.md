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

**当前没有自动化测试，全靠人工验证。** 这是已知缺口，不是可以忽略的现状。

引入测试时按这个顺序：

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
