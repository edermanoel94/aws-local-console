#!/usr/bin/env sh
# Wait until an HTTP endpoint answers with a 2xx status.
#
# Usage: scripts/wait-for.sh <url> [timeout_seconds] [label]
#   url              endpoint to probe (e.g. http://localhost:4566/_floci/health)
#   timeout_seconds  give up after this many seconds (default: 120)
#   label            friendly name used in log lines (default: the url)
#
# Portable POSIX sh; uses curl when available and falls back to wget.
set -eu

if [ $# -lt 1 ]; then
  echo "usage: $0 <url> [timeout_seconds] [label]" >&2
  exit 2
fi

url=$1
timeout=${2:-120}
label=${3:-$1}
interval=2

probe() {
  if command -v curl >/dev/null 2>&1; then
    curl --silent --fail --output /dev/null --max-time 5 "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet --output-document=/dev/null --timeout=5 "$url"
  else
    echo "wait-for: neither curl nor wget is installed" >&2
    exit 2
  fi
}

start=$(date +%s)
printf 'Waiting for %s (%s, timeout %ss) ' "$label" "$url" "$timeout"
while ! probe; do
  now=$(date +%s)
  if [ $((now - start)) -ge "$timeout" ]; then
    printf '\nTimed out after %ss waiting for %s (%s)\n' "$timeout" "$label" "$url" >&2
    exit 1
  fi
  printf '.'
  sleep "$interval"
done
printf ' ready (%ss)\n' "$(( $(date +%s) - start ))"
