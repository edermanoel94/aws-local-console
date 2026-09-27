# syntax=docker/dockerfile:1

# AWS Local Console - single image with the Go API and the Next.js web console.
#
#   api-build -> static Go binary, cross-compiled on the build machine's native platform
#   web-deps  -> frontend dependencies (pnpm version pinned by `packageManager`, via corepack)
#   web-build -> `next build` with `output: "standalone"`
#   runtime   -> Node.js running docker/entrypoint.mjs, which starts the API on 127.0.0.1:${API_PORT}
#                and the web server on :${PORT}; only the web port is exposed, and the browser
#                reaches the API through the web server's /api/v1 proxy.
#
# Build stages run on $BUILDPLATFORM and the runtime stage has no RUN, so multi-arch images
# (linux/amd64, linux/arm64) build without emulation. That works because the Go binary is
# cross-compiled and the standalone web output is plain JavaScript (next.config.ts keeps native
# modules such as sharp out of it).

ARG GO_VERSION=1.27.1
ARG NODE_VERSION=24
# Reported by /api/v1/health and the image labels; release builds pass the tag (e.g. 1.2.3).
ARG VERSION=dev

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS api-build
ARG TARGETOS TARGETARCH VERSION
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-trimpath
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY backend/ ./
# timetzdata embeds time zone data, so the runtime image needs no tzdata package.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS=$TARGETOS GOARCH=$TARGETARCH go build -tags timetzdata \
      -ldflags="-s -w -X github.com/edermanoel94/aws-local-console/backend/internal/api.Version=${VERSION}" \
      -o /out/api ./cmd/api

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS web-base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
# libc6-compat helps prebuilt native build tools (e.g. SWC) that expect glibc.
RUN apk add --no-cache libc6-compat && corepack enable pnpm
WORKDIR /app

FROM web-base AS web-deps
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
# Install from the lockfile only; the store lives in a BuildKit cache mount.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    corepack install && \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM web-base AS web-build
COPY --from=web-deps /app/node_modules ./node_modules
COPY frontend/ ./
RUN corepack install && pnpm build

# No RUN here: nothing executes on the target platform.
FROM node:${NODE_VERSION}-alpine AS runtime
ARG VERSION
LABEL org.opencontainers.image.title="AWS Local Console" \
      org.opencontainers.image.description="Web console to explore and operate AWS services running on Floci (Go API + Next.js)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/edermanoel94/aws-local-console" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    API_PORT=8080 \
    FLOCI_ENDPOINT=http://floci:4566 \
    AWS_REGION=us-east-1 \
    AWS_ACCESS_KEY_ID=test \
    AWS_SECRET_ACCESS_KEY=test
WORKDIR /app
COPY --from=api-build /out/api /app/bin/api
# The official node image ships an unprivileged `node` user (uid 1000).
COPY --from=web-build --chown=node:node /app/public ./public
COPY --from=web-build --chown=node:node /app/.next/standalone ./
COPY --from=web-build --chown=node:node /app/.next/static ./.next/static
COPY docker/entrypoint.mjs /app/entrypoint.mjs
USER node
EXPOSE 3000
# Healthy only when both processes answer: the web server proxies this request to the API.
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=20 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "/app/entrypoint.mjs"]
