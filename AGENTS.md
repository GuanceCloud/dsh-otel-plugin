# Repository Instructions

- Keep the plugin compatible with DeepSeek Harness `0.1.x` native session telemetry.
- Preserve the `invoke_agent` root and direct `llm`, `tool:*`, and `assistant` children.
- Derive Metrics only from the same normalized spans used for Trace export.
- Keep telemetry fail-open and `emit()` free of network or filesystem I/O.
- Run `npm run check`, `npm test`, and `npm run smoke:otlp` before release packaging.
