# dsh-otel-plugin v0.1.8

## Fixed

- Add `headers["To-Headless"] = "true"` to installer-managed `gtrace.json` when it is missing.
- Keep existing `To-Headless` values unchanged instead of overwriting them.
- Align Unix OSS installer, Unix release installer, and Windows release installer on the same GTrace header behavior.

## Validation

- `npm run check`
- `npm test`
