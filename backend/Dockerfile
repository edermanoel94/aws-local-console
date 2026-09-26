# syntax=docker/dockerfile:1

# AWS Local Console - Go API image.
#   build   -> static binary from ./cmd/api, cross-compiled on the build machine's native
#              platform for the target one (fast multi-arch builds, no emulation)
#   runtime -> small alpine image (busybox wget is used by the compose healthcheck), non-root;
#              time zone data is embedded in the binary (timetzdata)

ARG GO_VERSION=1.27.1

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-trimpath
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS=$TARGETOS GOARCH=$TARGETARCH go build -tags timetzdata -ldflags="-s -w" -o /out/api ./cmd/api

# No RUN here: nothing executes on the target platform, so arm64 builds need no emulation.
FROM alpine:3.24 AS runtime
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/api /app/api
WORKDIR /app
# Alpine's built-in unprivileged `nobody` user.
USER 65534:65534
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=20 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/v1/health" || exit 1
ENTRYPOINT ["/app/api"]
