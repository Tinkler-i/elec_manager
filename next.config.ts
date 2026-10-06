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
  env: {
    // 构建期注入版本号。运行时如果飞牛注入了 TRIM_APPVER，以那个为准
    // （它取自 manifest.version，是应用中心里显示的版本）。见 lib/version.ts。
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
};

export default nextConfig;
