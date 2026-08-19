#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="${DSH_OTEL_PLUGIN_NAME:-dsh-otel-plugin}"
OSS_ENDPOINT="${OSS_ENDPOINT:-}"
DOWNLOAD_BASE_URL=""
profile="web"
version_input="latest"
source_spec=""
endpoint=""
x_token=""
tags=()
write_config=1
temp_root="$(mktemp -d)"

cleanup() {
  rm -rf "$temp_root"
}

trap cleanup EXIT

log() { printf '[install] %s\n' "$1" >&2; }
fail() { printf '[install] %s\n' "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  OSS_ENDPOINT=https://example.com/agent_plugins install.sh [latest|vX.Y.Z|X.Y.Z|URL|/path/archive.tar.gz] [options]

Options:
  --profile NAME       DSH profile (default: web)
  --type TYPE          telemetry type (accepted for connector compatibility)
  --oss-endpoint URL   OSS root endpoint; overrides the OSS_ENDPOINT environment variable
  --source SPEC        local archive or URL; overrides the version argument
  --endpoint URL       OTLP base URL, written to gtrace.json
  --x-token TOKEN      GTrace X-Token, written to gtrace.json
  --tag KEY=VALUE      resource attribute; may be repeated
  --no-config          install without changing gtrace.json
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type) [[ $# -ge 2 ]] || fail '--type requires a value'; [[ "$2" == "gtrace" ]] || fail "unsupported --type: $2"; shift 2 ;;
    --type=*) [[ "${1#*=}" == "gtrace" ]] || fail "unsupported --type: ${1#*=}"; shift ;;
    --profile) [[ $# -ge 2 ]] || fail '--profile requires a value'; profile="$2"; shift 2 ;;
    --profile=*) profile="${1#*=}"; shift ;;
    --oss-endpoint) [[ $# -ge 2 ]] || fail '--oss-endpoint requires a value'; OSS_ENDPOINT="$2"; shift 2 ;;
    --oss-endpoint=*) OSS_ENDPOINT="${1#*=}"; shift ;;
    --source) [[ $# -ge 2 ]] || fail '--source requires a value'; source_spec="$2"; shift 2 ;;
    --source=*) source_spec="${1#*=}"; shift ;;
    --endpoint) [[ $# -ge 2 ]] || fail '--endpoint requires a URL'; endpoint="$2"; shift 2 ;;
    --endpoint=*) endpoint="${1#*=}"; shift ;;
    --x-token) [[ $# -ge 2 ]] || fail '--x-token requires a token'; x_token="$2"; shift 2 ;;
    --x-token=*) x_token="${1#*=}"; shift ;;
    --tag) [[ $# -ge 2 ]] || fail '--tag requires KEY=VALUE'; tags+=("$2"); shift 2 ;;
    --tag=*) tags+=("${1#*=}"); shift ;;
    --no-config) write_config=0; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) fail "unknown argument: $1" ;;
    *) version_input="$1"; shift ;;
  esac
done

require_command() { command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }

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
  command -v pnpm >/dev/null 2>&1 || fail 'unable to provide pnpm through corepack or npm'
}

download_and_verify() {
  local url="$1" target="$2" name checksum expected actual
  name="$(basename "$target")"
  log "downloading ${url}"
  curl -fsSL "$url" -o "$target"
  if curl -fsSL "${url}.sha256" -o "${target}.sha256"; then
    checksum="${target}.sha256"
  else
    checksum="${temp_root}/SHA256SUMS"
    curl -fsSL "$(dirname "$url")/SHA256SUMS" -o "$checksum" || fail "checksum not found for ${name}"
  fi
  expected="$(awk -v name="$name" '$2 == name || $2 == "*" name { print $1; exit }' "$checksum")"
  actual="$(sha256sum "$target" | awk '{print $1}')"
  [[ -n "$expected" && "$expected" == "$actual" ]] || fail "sha256 verification failed for ${name}"
  log 'sha256 verified'
}

normalize_version() {
  local value="$1"
  value="${value#v}"
  printf '%s' "$value"
}

resolve_download_base_url() {
  if [[ -z "$OSS_ENDPOINT" ]]; then
    fail 'OSS_ENDPOINT is required for install.sh. Example: OSS_ENDPOINT=https://static.guance.com/agent_plugins bash install.sh latest'
  fi
  local root="${OSS_ENDPOINT%/}"
  case "$root" in
    */"$PLUGIN_NAME") printf '%s' "$root" ;;
    *) printf '%s/%s' "$root" "$PLUGIN_NAME" ;;
  esac
}

download_latest_archive() {
  local target="$1"
  download_and_verify "${DOWNLOAD_BASE_URL%/}/${PLUGIN_NAME}.tar.gz" "$target"
}

download_version_archive() {
  local version="$1" target="$2"
  download_and_verify "${DOWNLOAD_BASE_URL%/}/${PLUGIN_NAME}-v${version}.tar.gz" "$target"
}

resolve_archive() {
  local target="$temp_root/${PLUGIN_NAME}.tar.gz" version
  if [[ -n "$source_spec" ]]; then
    if [[ "$source_spec" == http://* || "$source_spec" == https://* ]]; then
      download_and_verify "$source_spec" "$target"
    else
      cp "$source_spec" "$target"
    fi
    printf '%s' "$target"
    return
  fi
  version="${version_input#v}"
  if [[ "$version_input" == "latest" || -z "$version_input" ]]; then
    download_latest_archive "$target"
  else
    download_version_archive "$version" "$target"
  fi
  printf '%s' "$target"
}

config_file="${DSH_OTEL_CONFIG_FILE:-${DSH_HOME:-$HOME/.dsh}/gtrace.json}"
configure() {
  [[ "$write_config" -eq 1 ]] || return
  require_command node
  local tags_json='[]'
  if [[ ${#tags[@]} -gt 0 ]]; then
    tags_json="$(printf '%s\n' "${tags[@]}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s.trim().split(/\n+/).filter(Boolean))))')"
  fi
  DSH_OTEL_CONFIG_FILE_RUNTIME="$config_file" DSH_OTEL_ENDPOINT_RUNTIME="$endpoint" DSH_OTEL_TOKEN_RUNTIME="$x_token" DSH_OTEL_TAGS_RUNTIME="$tags_json" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const file = process.env.DSH_OTEL_CONFIG_FILE_RUNTIME;
let config = {};
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (raw) config = JSON.parse(raw);
}

const endpoint = process.env.DSH_OTEL_ENDPOINT_RUNTIME || '';
const token = process.env.DSH_OTEL_TOKEN_RUNTIME || '';
const tags = JSON.parse(process.env.DSH_OTEL_TAGS_RUNTIME || '[]');
config.enabled ??= true;
if (endpoint) config.endpoint = endpoint;
config.headers ??= {};
if (token) config.headers['X-Token'] = token;
config.tracePath ??= 'v1/write/otel-llm';
config.metricsPath ??= 'v1/write/otel-metrics';
config.resourceAttributes ??= {};
for (const tag of tags) {
  const index = String(tag).indexOf('=');
  if (index <= 0) throw new Error('invalid --tag: ' + tag);
  config.resourceAttributes[String(tag).slice(0, index)] = String(tag).slice(index + 1);
}
const temp = file + '.tmp-' + process.pid;
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', 'utf8');
fs.renameSync(temp, file);
NODE
  log "updated ${config_file}"
}

reset_stale_plugin_reference() {
  local package_file="$profile_root/package.json"
  [[ -f "$package_file" ]] || return 0
  node - "$package_file" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  if (config[section] && Object.prototype.hasOwnProperty.call(config[section], 'dsh-otel-plugin')) {
    delete config[section]['dsh-otel-plugin'];
  }
}
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
NODE
  rm -f "$profile_root/pnpm-lock.yaml"
  rm -rf "$profile_root/node_modules/dsh-otel-plugin"
  rm -f "$profile_root"/.dsh-otel-plugin-install-*.tar.gz
}

require_command curl
require_command tar
require_command sha256sum
DOWNLOAD_BASE_URL="$(resolve_download_base_url)"
archive="$(resolve_archive)"
profile_root="${DSH_HOME:-$HOME/.dsh}/profiles/${profile}"
mkdir -p "$profile_root"
reset_stale_plugin_reference
stable_archive="${profile_root}/.dsh-otel-plugin-install-${BASHPID}.tar.gz"
cp "$archive" "$stable_archive"
archive="$stable_archive"
ensure_pnpm
if command -v dsh >/dev/null 2>&1; then
  dsh plugin --profile "$profile" add "$archive"
else
  npx --yes @deepseek-ai/dsh plugin --profile "$profile" add "$archive"
fi
configure
log "installed dsh-otel-plugin into profile ${profile}"
log 'restart the DSH process before starting a new session'
