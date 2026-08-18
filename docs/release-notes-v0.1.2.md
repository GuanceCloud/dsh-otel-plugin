# dsh-otel-plugin v0.1.2

This release makes the DeepSeek Harness OTEL plugin installable through a complete, checksum-verified GitHub Release flow.

## Highlights

- Adds a release installer for Linux/macOS and PowerShell.
- Downloads `latest` or a pinned version from GitHub Releases.
- Verifies release archives with SHA-256 checksums.
- Provides `pnpm` temporarily through Corepack or npm when it is not installed globally.
- Installs into the selected DSH profile through `dsh plugin` or the `npx` fallback.
- Atomically merges endpoint, headers, trace/metrics paths, and resource attributes into `gtrace.json`.
- Preserves existing user configuration and supports `--no-config`.
- Writes independent diagnostics to `$DSH_HOME/gtrace-hooks.log` or `~/.dsh/gtrace-hooks.log`.

## Installation

```bash
curl -fsSL https://github.com/GuanceCloud/dsh-otel-plugin/releases/latest/download/install-release.sh \
  -o /tmp/dsh-otel-plugin-install.sh
chmod +x /tmp/dsh-otel-plugin-install.sh
/tmp/dsh-otel-plugin-install.sh latest \
  --profile web \
  --endpoint 'https://llm-openway.guance.com' \
  --x-token '<client_token>' \
  --tag 'agent_id=<agent_id>' \
  --tag 'agent_name=<agent_name>'
```

## Verification

- TypeScript check passed.
- 12 unit tests passed.
- OTLP Trace/Metrics smoke test passed.
- Real `latest` Release installation passed in a temporary `DSH_HOME` without global `pnpm`.
