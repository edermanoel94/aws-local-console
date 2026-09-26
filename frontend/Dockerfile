# syntax=docker/dockerfile:1

# AWS Local Console - Next.js frontend image.
# Multi-stage build on top of Next.js `output: "standalone"`:
#   deps    -> installs dependencies with the pnpm version pinned in package.json (via corepack)
#   builder -> runs `next build` (NEXT_PUBLIC_* values are inlined here)
#   runner  -> minimal image with only the traced standalone server, running as non-root

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
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
# The browser calls the Go API directly, so this must be an address reachable
# from the host running the browser, not a compose-internal hostname.
# NEXT_PUBLIC_* variables are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack install && pnpm build

FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
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
