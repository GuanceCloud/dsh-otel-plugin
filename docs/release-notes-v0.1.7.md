# dsh-otel-plugin v0.1.7

## Fixed

- Align the OSS `install.sh` flow with the standard external-plugin contract used by OpenClaw and Hermes.
- Keep Unix and Windows release installers on the same argument contract while allowing OSS-backed downloads through `OSS_ENDPOINT`.
- Prevent the published OSS installer from falling back to GitHub Release archive URLs during connector-driven installs.

## Validation

- `npm run check`
- `npm test`
- `npm run smoke:otlp`
- `npm run package:release`
