# dsh-otel-plugin v0.1.6

## Fixed

- Preserve the profile-local archive referenced by pnpm after installation.
- Remove stale `dsh-otel-plugin` file dependencies before reinstalling.
- Support repeated installation and upgrade without `ENOENT` from an expired temporary archive.
