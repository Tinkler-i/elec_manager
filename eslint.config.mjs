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
    // 飞牛打包会把 standalone 产物复制到 fnos/App.Native.ElecMeter/app/server/。
    // 那是构建产物（.gitignore 里），不是源码；不忽略的话本地跑一次 fpk 打包，
    // 下次 lint 就会多出两百多个来自压缩产物的报错。
    "fnos/App.Native.ElecMeter/app/server/**",
  ]),
  // scripts/ 下是 `node xxx.js` 直接跑的 CommonJS 工具脚本（用 require 和 __dirname），
  // TypeScript 的 no-require-imports 规则在这里不适用。
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
