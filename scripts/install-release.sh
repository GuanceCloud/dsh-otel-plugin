#!/usr/bin/env bash
set -euo pipefail

profile="web"
source_spec=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) profile="$2"; shift 2 ;;
    --source) source_spec="$2"; shift 2 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then return; fi
  mkdir -p "$temp_root/bin"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable --install-directory "$temp_root/bin" >/dev/null
    PATH="$temp_root/bin:$PATH"
  else
    npm install --prefix "$temp_root/pnpm" pnpm >/dev/null
    PATH="$temp_root/pnpm/node_modules/.bin:$PATH"
  fi
  export PATH
  command -v pnpm >/dev/null 2>&1 || {
    printf 'unable to provide pnpm through corepack or npm\n' >&2
    exit 1
  }
}

if [[ -z "$source_spec" && -f "$script_dir/dsh-otel-plugin.tar.gz" ]]; then
  source_spec="$script_dir/dsh-otel-plugin.tar.gz"
fi
if [[ -z "$source_spec" ]]; then
  printf 'missing release archive; place dsh-otel-plugin.tar.gz beside this installer or pass --source\n' >&2
  exit 2
fi

ensure_pnpm
if command -v dsh >/dev/null 2>&1; then
  dsh plugin --profile "$profile" add "$source_spec"
else
  npx --yes @deepseek-ai/dsh plugin --profile "$profile" add "$source_spec"
fi
printf 'installed dsh-otel-plugin into profile %s\n' "$profile"
