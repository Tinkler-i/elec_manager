import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // fnos/build.sh 把 Next 的 standalone 产物复制到这个目录（.gitignore 里也忽略了它）。
    // 那是构建产物，不是源码；本地跑过一次 fpk 打包，lint 就会多出上千条来自压缩产物的报错。
    "fnos/App.Native.ElecMeter/app/server/**",
  ]),
  // scripts/ 下是 `node xxx.js` 直接跑的工具脚本，用 require 和 __dirname，属于 CommonJS
  // —— package.json 没有 type: module，它们本来就该长这样。TypeScript 的
  // no-require-imports 规则是为 ESM 源码设的，在这里不适用。
  // 只对 .js 生效：scripts/ 里的 .ts（如 test-calculations.ts）仍按 ESM 规则检查。
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // 「静默 catch」门禁：catch 必须留痕（见 docs/coding-standards.md「catch 必须留痕」）。
  // 2026-10 实测过两次：① 规范里早写着「不要吞异常」，src/app/api 下 17 处 catch 照样全吞；
  // ② 立了规则之后，规则自己找出第 17 处（`catch (e)` 用了 e，所以 no-unused-vars 从来没报过它）。
  // 规则不进门禁就等于不会响。
  //
  // 覆盖范围 = 两处「错误只回给调用方、服务端零痕迹」的出口：
  //   · src/app/api/**        —— HTTP 层：异常 → 500 + 服务端日志；
  //   · src/lib/mcp-server.ts —— MCP 工具：异常 → errorResult 回给客户端（一个 AI agent）。
  //     这层比 HTTP 更隐蔽：浏览器至少有个 500 让人看见，而 agent 收到 isError 之后可能
  //     静默重试 / 换参数 / 直接放弃，运维完全不知道发生过。
  //
  // 有意**不**覆盖的地方 —— 不是漏了，是这些「静默」都有意为之，一刀切只会逼出注释禁用
  // （等于把门关掉）。下一个人若想扩范围，请先读这一段的理由：
  //   · scripts/** —— 测试脚本里清理临时目录、解析 SSE 的 `catch {}`：清理失败本来就该静默，
  //     报出来反而会掩盖真正的测试结果。**别顺手加进来。**
  //   · src/proxy.ts —— token 校验失败是**预期控制流**（401 / 跳登录页），不是异常；
  //   · src/lib/api.ts —— 网络失败是**转译成 ApiError 后重抛**，调用方会看到；
  //   · src/lib/auth.ts —— 读不到 jwt_secret 文件就**继续生成**，刻意忽略；
  //   · 客户端组件（src/components/**、页面）—— 用 toast 告知用户，不需要服务端日志。
  // 覆盖范围同步写在规范里，别读成「全局都管」。
  {
    files: ["src/app/api/**/*.ts", "src/lib/mcp-server.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CatchClause > BlockStatement:not(:has(CallExpression[callee.object.name='console']))",
          message:
            "catch 块必须留痕：加 console.error(...) 记录异常（或等价手段）。只返回响应、把异常丢掉会让运维无法诊断 —— 见 docs/coding-standards.md「catch 必须留痕」。",
        },
      ],
    },
  },
]);

export default eslintConfig;
