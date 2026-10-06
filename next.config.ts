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

  // ⚠️ 打包踩坑记录：开发机上的 data/ 会被 trace 进 .next/standalone（包括 data/jwt_secret）
  //
  // 结论（task-31 实测）：**outputFileTracingExcludes 和 turbopackIgnore 都修不了这条泄漏。**
  // 可靠的做法是在构建产物层面清掉 .next/standalone/data：
  //   · fnos/build.sh 已经这么做了（复制完 standalone 后 rm -rf app/server/data）
  //   · Docker 侧不需要 —— .dockerignore:25 排除了 `data`，构建上下文里根本没有它
  //   · 剩下唯一会中的是「本地 next build 之后直接拿 .next/standalone 去部署」
  //
  // 一、outputFileTracingExcludes —— 它**是生效的，但覆盖不到 instrumentation**
  //   ① 只读 JS 源码会得出「它在 Turbopack 下是死的」这个错误结论。三个应用点确实全被
  //      webpack 门挡着：build/index.js:1542（bundler !== Turbopack 才 collectBuildTraces）、
  //      build/adapter/build-complete.js:172、turbopack-build/impl.js:241
  //      （buildTraceContext: undefined）→ collect-build-traces.js:441 拿到空 Map，
  //      :480-525 那段循环不跑。但 Turbopack 在**原生侧**自己实现了它：@next/swc-*.node
  //      里能直接搜到这个键。别按 JS 源码下结论。
  //   ② 实测（Next 16.2.9，构建头 Turbopack，每次各自删 .next 重建），看 api/stats 的 nft：
  //        { "/api/stats": ["**/*.js"] }    → 116 条 → 1 条
  //        { "/api/stats": ["**/*.zzz"] }   → 116 条不变（键匹配、glob 匹配不到）
  //        { "/nonexistent": ["**/*.js"] }  → 116 条不变（glob 有效、键匹配不到）
  //   ③ 但对 data/jwt_secret 没用：键 "*"、"**" 只能把引用从 6 个 nft 减到 1 个，剩下的是
  //      server/instrumentation.js.nft.json；键 "instrumentation"、"/instrumentation" 则
  //      完全无变化。**没有键能匹配到 instrumentation 那条**，文件照样进 standalone。
  //
  // 二、turbopackIgnore —— 对这条**完全无效**。在 auth.ts 里试了 7 处 + 3 种写法（整个表达式
  //    前置、箭头函数、显式 env 分支），全量 scan 一个字节都没变。查文档它的定位是 import/打包
  //    （docs/01-app/03-api-reference/08-turbopack.md: "Skip bundling (Turbopack-only)"），
  //    管不了 fs 对**具体文件**的引用。别在这上面花时间。
  //
  // 注：db.ts 里那几处 turbopackIgnore 是 task-27 加的，当时测到 fnos/ 的动态 glob 消失；
  // 但本轮实验表明它管不住具体文件路径 —— 那几处的实际作用**没有被隔离验证过**。
  env: {
    // 构建期注入版本号。运行时如果飞牛注入了 TRIM_APPVER，以那个为准
    // （它取自 manifest.version，是应用中心里显示的版本）。见 lib/version.ts。
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
};

export default nextConfig;
