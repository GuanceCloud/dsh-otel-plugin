# dsh-otel-plugin v0.1.0

The first release of the DeepSeek Harness GTrace OTEL integration.

## Highlights

- Collects terminal DSH turns through the native session telemetry lifecycle.
- Emits GTrace-compatible OTLP/HTTP Protobuf traces and metrics.
- Models `invoke_agent`, `llm`, `tool`, `skill`, and `assistant` spans.
- Supports completed, cancelled, and error turn outcomes.
- Includes token usage, tool results, content capture modes, recursive redaction, and bounded attribute sizes.
- Uses fail-open export behavior so telemetry failures do not interrupt DSH.
- Disables the built-in session telemetry OTEL backend through the bundle patch to prevent duplicate reporting.

## Installation

### Linux and macOS

```bash
curl -fsSL -o install-release.sh \
  https://github.com/GuanceCloud/dsh-otel-plugin/releases/latest/download/install-release.sh
bash install-release.sh --profile web
```

### Windows PowerShell

```powershell
irm https://github.com/GuanceCloud/dsh-otel-plugin/releases/latest/download/install-release.ps1 -OutFile install-release.ps1
.\install-release.ps1 -Profile web
```

The scripts install the published `dsh-otel-plugin.tar.gz` package into the selected DSH profile. They use the existing `dsh` command when available and fall back to `npx @deepseek-ai/dsh`.

## Configuration

Configuration precedence is:

```text
Cordis config > DSH_OTEL_* / OTEL_* environment variables > project .dsh/gtrace.json > user ~/.dsh/gtrace.json > defaults
```

Example:

```bash
export DSH_OTEL_ENDPOINT=https://llm-openway.guance.com
export DSH_OTEL_HEADERS='X-Token=agent_xxx,To-Headless=true'
```

The default capture mode is `preview`; use `DSH_OTEL_CAPTURE_CONTENT=none` to disable message, argument, and result content capture.

## Compatibility

- DeepSeek Harness: `>=0.1.0-rc.7 <0.2.0`
- Node.js: `^22.19.0 || >=24.0.0`
- Platforms: Linux, macOS, and Windows

DeepSeek Harness is still in developer preview. Future Harness releases may introduce compatibility-breaking changes.

