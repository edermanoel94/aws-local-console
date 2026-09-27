import type { NextConfig } from "next";

// sharp is only used by next/image optimization, which this app does not use. Keeping it out of the
// standalone bundle saves ~20MB and, more importantly, keeps the build output free of native binaries,
// so one build can serve every platform of the multi-arch image (see frontend/Dockerfile).
const NATIVE_IMAGE_LIBS = ["node_modules/sharp/**/*", "node_modules/@img/**/*", "node_modules/.pnpm/sharp@*/**/*", "node_modules/.pnpm/@img+*/**/*"];

const nextConfig: NextConfig = {
  // Self-contained server bundle used by frontend/Dockerfile.
  output: "standalone",
  images: { unoptimized: true },
  outputFileTracingExcludes: { "/*": NATIVE_IMAGE_LIBS, "*": NATIVE_IMAGE_LIBS },
  // The floating dev indicator overlaps the sidebar footer; compile/runtime errors still show in the overlay.
  devIndicators: false,
  // `next dev` blocks its dev resources (HMR, chunks) for origins other than localhost; the console must also work
  // when opened as 127.0.0.1 (the E2E suite checks it). Production builds are not affected by this setting.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
