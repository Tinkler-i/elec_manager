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
]);

export default eslintConfig;
