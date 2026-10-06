import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    unoptimized: true,
  },
  experimental: {
    // chart.js / react-chartjs-2 已经换成 recharts，这里一并清掉
    optimizePackageImports: ["lucide-react"],
  },
  serverExternalPackages: ["better-sqlite3", "@modelcontextprotocol/sdk"],

  // ⚠️ 打包踩坑记录：开发机上的 data/ 被 trace 进 .next/standalone
  //
  // 结论：这个坑由 src/lib/db.ts 路径定义处的 /*turbopackIgnore: true*/ 解决（task-27），
  // 打包侧再由 fnos/build.sh 兜一道。**不要用 outputFileTracingExcludes 兜这个底。**
  // 下面两条都是实测出来的，不是读文档得来的 —— 只读源码会把你带反。
  //
  // ① 只读 JS 源码会得出「这个选项在 Turbopack 下是死的」这个错误结论。
  //    三个应用点确实全被 webpack 门挡着：
  //      build/index.js:1542                 bundler !== Turbopack 才 collectBuildTraces
  //      build/adapter/build-complete.js:172  同样门
  //      build/turbopack-build/impl.js:241    buildTraceContext: undefined
  //    → collect-build-traces.js:441 拿到空 Map，:480-525 那段循环根本不跑。
  //    但 Turbopack 是在**原生侧**自己实现这个选项的：@next/swc-*.node（130MB 那个）里
  //    能直接搜到 outputFileTracingExcludes。所以选项是生效的，只是不在 JS 里。
  //
  // ② 实测（Next 16.2.9，构建头显示 Turbopack，每次各自删 .next 重建），看 api/stats 的 nft：
  //      { "/api/stats": ["**/*.js"] }    → 116 条 → 1 条
  //      { "/api/stats": ["**/*.zzz"] }   → 116 条不变（键匹配、glob 匹配不到）
  //      { "/nonexistent": ["**/*.js"] }  → 116 条不变（glob 有效、键匹配不到）
  //    两个阴性对照说明变化确实来自这个选项，不是构建抖动。
  //
  // 那为什么还是别用它：db.ts 那条 trace 落在 server/instrumentation.js.nft.json 里。
  // task-27 在当时的代码上试过 "*"、"**"、"/api/stats"、"instrumentation"、"/instrumentation"
  // 配 ./data/**、**/data/**、**/*.db 等组合，一条都没能把它移掉（该条目在 db.ts 修好后
  // 已不再出现，没法在当前代码上重验）。有效的是 /*turbopackIgnore: true*/ —— 加完之后
  // 连脏树重建，standalone 顶层都只剩 .next / node_modules / package.json / server.js。
  env: {
    // 构建期注入版本号。运行时如果飞牛注入了 TRIM_APPVER，以那个为准
    // （它取自 manifest.version，是应用中心里显示的版本）。见 lib/version.ts。
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
};

export default nextConfig;
