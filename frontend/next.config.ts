import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle used by frontend/Dockerfile.
  output: "standalone",
};

export default nextConfig;
