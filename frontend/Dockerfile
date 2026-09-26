# syntax=docker/dockerfile:1

# AWS Local Console - Next.js frontend image.
# Multi-stage build on top of Next.js `output: "standalone"`:
#   deps    -> installs dependencies with the pnpm version pinned in package.json (via corepack)
#   builder -> runs `next build`
#   runner  -> minimal image with only the traced standalone server, running as non-root
# deps and builder run on the build machine's native platform: the standalone output is plain
# JavaScript (next.config.ts keeps native modules such as sharp out of it), so one build serves
# every target platform of a multi-arch image without emulation. Only the runner is per-platform.

ARG NODE_VERSION=24

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
# libc6-compat helps prebuilt native modules (e.g. SWC) that expect glibc.
RUN apk add --no-cache libc6-compat && corepack enable pnpm
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Fetch the exact pnpm release from the `packageManager` field, then install
# from the lockfile only. The store lives in a BuildKit cache mount.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    corepack install && \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM base AS builder
# No API address is baked into the bundle: the browser calls /api/v1 on this
# server, which proxies to API_INTERNAL_URL read at runtime (see the runner stage).
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack install && pnpm build

FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    API_INTERNAL_URL=http://backend:8080
WORKDIR /app
# The official node image ships an unprivileged `node` user (uid 1000).
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
# Liveness probe with Node's built-in fetch: any non-5xx answer (redirects are
# not followed) means the server is up, independently of individual routes.
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=20 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/', { redirect: 'manual' }).then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
