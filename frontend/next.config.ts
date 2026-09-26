import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle used by frontend/Dockerfile.
  output: "standalone",
  // The floating dev indicator overlaps the sidebar footer; compile/runtime errors still show in the overlay.
  devIndicators: false,
};

export default nextConfig;
