# dsh-otel-plugin v0.1.1

## Fixed

- Align the Unix `install.sh` and `install-release.sh` installers with the standard external-plugin flow used by OpenClaw and Hermes.
- Accept the connector's generic `--type gtrace` argument and resolve the published GitHub archive automatically when no source is supplied.
- Keep Windows and Unix installers consistent, including archive checksum verification and runtime configuration.
