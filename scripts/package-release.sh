#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('$root/package.json').version")"
out="$root/release-assets"
rm -rf "$out"
mkdir -p "$out"
npm --prefix "$root" run build >/dev/null
packed="$(npm --prefix "$root" pack --pack-destination "$out" --silent)"
cp "$out/$packed" "$out/dsh-otel-plugin-v$version.tar.gz"
cp "$out/$packed" "$out/dsh-otel-plugin.tar.gz"
cp "$root/scripts/install-release.sh" "$out/install-release.sh"
cp "$root/scripts/install-release.ps1" "$out/install-release.ps1"
cp "$root/scripts/install.sh" "$out/install.sh"
(
  cd "$out"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$packed" "dsh-otel-plugin-v$version.tar.gz" "dsh-otel-plugin.tar.gz" install.sh install-release.sh install-release.ps1 > SHA256SUMS
  else
    shasum -a 256 "$packed" "dsh-otel-plugin-v$version.tar.gz" "dsh-otel-plugin.tar.gz" install.sh install-release.sh install-release.ps1 > SHA256SUMS
  fi
)
printf 'release assets: %s\n' "$out"
