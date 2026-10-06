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

  // ⚠️ 不要用 outputFileTracingExcludes 去解决「开发机上的 data/ 被 trace 进 standalone」。
  //
  // 这个选项确实存在（next/dist/server/config-schema.js 的 schema 里有），但在
  // Next 16 + Turbopack 下够不着那类条目：排除逻辑在 next/dist/build/collect-build-traces.js
  // （约 441-533 行），遍历的是 chunksTrace.entryNameFilesMap 里的**路由**，逐个改写
  // server/<route>.js.nft.json；而 data/elec.db 那条只出现在
  // server/instrumentation.js.nft.json —— instrumentation 不在那个 map 里，结构上排除不到。
  //
  // task-27 实测过 7 种键/glob 组合（"*"、"**"、"/api/stats"、"instrumentation" 配
  // ./data/**、**/data/**、**/*.db、**/*.js），没有一种能把 data/elec.db 移出去。
  // 对照组：键 "/api/stats" + "**/*.js" 能把该路由的 nft 从 6 条减到 3 条 ——
  // 说明选项本身是工作的，只是覆盖不到 instrumentation。**别再试这条路了。**
  //
  // 正解在别处：src/lib/db.ts 路径定义处的 /*turbopackIgnore: true*/，
  // 以及 fnos/build.sh 复制完 standalone 之后清掉 app/server/data。
  env: {
    // 构建期注入版本号。运行时如果飞牛注入了 TRIM_APPVER，以那个为准
    // （它取自 manifest.version，是应用中心里显示的版本）。见 lib/version.ts。
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
};

export default nextConfig;
