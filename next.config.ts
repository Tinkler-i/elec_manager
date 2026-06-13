import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    optimizePackageImports: ["lucide-react", "chart.js", "react-chartjs-2"],
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
