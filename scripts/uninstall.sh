#!/usr/bin/env bash
set -euo pipefail

profile="${2:-web}"
if [[ "${1:-}" == "--profile" ]]; then shift 2; fi
temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT
if ! command -v pnpm >/dev/null 2>&1; then
  mkdir -p "$temp_root/bin"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable --install-directory "$temp_root/bin" >/dev/null
    PATH="$temp_root/bin:$PATH"
  else
    npm install --prefix "$temp_root/pnpm" pnpm >/dev/null
    PATH="$temp_root/pnpm/node_modules/.bin:$PATH"
  fi
  export PATH
fi
command -v pnpm >/dev/null 2>&1 || {
  printf 'unable to provide pnpm through corepack or npm\n' >&2
  exit 1
}
if command -v dsh >/dev/null 2>&1; then
  dsh plugin --profile "$profile" remove dsh-otel-plugin
else
  npx --yes @deepseek-ai/dsh plugin --profile "$profile" remove dsh-otel-plugin
fi
printf 'removed dsh-otel-plugin from profile %s; user gtrace.json files were preserved\n' "$profile"
