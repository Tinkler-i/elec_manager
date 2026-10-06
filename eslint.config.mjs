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
  // 「静默 catch」门禁：API 路由里的 catch 必须留痕（见 docs/coding-standards.md
  // 「catch 必须留痕」）。2026-10 实测过一次：规范里早写着「不要吞异常」，
  // src/app/api 下 17 处 catch 照样全吞了 —— 规则不进门禁就等于不会响。
  //
  // 为什么**只**覆盖 src/app/api/**：这一层的契约是「异常 → 500 + 服务端日志」，
  // 留痕是硬要求。其它层的 catch 有各自的合法形态，一刀切只会逼出注释禁用（等于把门关掉）：
  //   · src/proxy.ts —— token 校验失败是**预期控制流**（401 / 跳登录页），不是异常；
  //   · src/lib/api.ts —— 网络失败是**转译成 ApiError 后重抛**，调用方会看到；
  //   · src/lib/auth.ts —— 读不到 jwt_secret 文件就**继续生成**，刻意忽略；
  //   · 客户端组件 —— 用 toast 告知用户，不需要服务端日志；
  //   · src/lib/mcp-server.ts —— 把错误作为工具结果回给 MCP 调用方。
  // 这些「静默」都是有意的，规则不覆盖它们；覆盖范围写进规范，别读成「全局都管」。
  {
    files: ["src/app/api/**/*.ts"],
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
