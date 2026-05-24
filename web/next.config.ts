import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/sdk"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
