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

  // ⚠️ 打包踩坑记录：standalone 里不该出现仓库的 data/（含 data/jwt_secret）
  //
  // 现状：源头已修 —— src/lib/auth.ts 的 5 处 /*turbopackIgnore: true*/；并由
  // scripts/lib/check-standalone-clean.mjs 在 postbuild 阶段把门，一旦再漏进
  // .next/standalone 就直接 exit 1。这里只留三条「别再试」的记录：
  //
  // ① outputFileTracingExcludes —— 在本项目当前 HEAD 上**没观察到效果**，别靠它。
  //    QA 跑了 10 组键/glob（含最宽的 "*" + "**/*.js"），api/stats 的 nft 一律 116/6 不变。
  //    （task-30 另有一台机器观察到 116→1，未能被独立复现；两边不一致，以 10 组实测为准。）
  //    ※ 顺带记一笔：只读 JS 源码会得出「它在 Turbopack 下是死的」这个结论 —— 三个应用点
  //      确实全被 webpack 门挡着（build/index.js:1542、build/adapter/build-complete.js:172、
  //      turbopack-build/impl.js:241 的 buildTraceContext: undefined）。但那不足以定论，
  //      因为 Turbopack 可能在原生侧另有实现。结论按实测走：没观察到效果。
  //
  // ② turbopackIgnore —— **有用，但只认实参位置**。写在语句前面等于没写：
  //      ✓ path.join(/*turbopackIgnore: true*/ path.dirname(DB_PATH), 'jwt_secret')
  //      ✗ const x = /*turbopackIgnore: true*/ path.join(...)                 语句位置，不看
  //      ✗ path.join(path.dirname(/*turbopackIgnore: true*/ DB_PATH), ...)   注释贴错了实参
  //    实测（脏树，每次删 .next 重建）：加上之后 data/ 条目 1→0、standalone 顶层 5→4 项；
  //    故意拿掉后门变红（顶层 5 项含 data，exit 1）。详见 task-32。
  //
  // ③ src/lib/db.ts 里那几处 ignore **是承重的**，别删。隔离验证（拿掉 → 重建 → 逐字节还原）：
  //    非 node_modules 的 trace 条目 144→275、data/ 条目 0→3、standalone 顶层 4→26 项
  //    （整个仓库被 trace 进去）。
  //
  // Docker 侧不需要额外防御：.dockerignore:25 已排除 `data`，构建上下文里根本没有它。
  env: {
    // 构建期注入版本号。运行时如果飞牛注入了 TRIM_APPVER，以那个为准
    // （它取自 manifest.version，是应用中心里显示的版本）。见 lib/version.ts。
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
};

export default nextConfig;
