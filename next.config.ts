import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "chart.js", "react-chartjs-2"],
  },
  serverExternalPackages: ["better-sqlite3", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
