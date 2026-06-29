# Changelog

## 0.1.2

- Add `prepare` so GitHub installs build the CLI and MCP binaries when npm package metadata is unavailable.

## 0.1.1

- Republish via npm CLI path after Bun publish reported success while package metadata remained unavailable through the public registry.

## 0.1.0

- Initial OSS package scaffold.
- Local source/destination configuration.
- Local and S3 backup run support.
- Manifest, checksum verification, and restore-plan generation.
- Read-only AWS S3, AWS Backup, and RDS/Aurora audit commands.
- Minimal read-only MCP bridge.
