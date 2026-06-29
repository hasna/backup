# Contributing

Use Bun for development:

```sh
bun install
bun run typecheck
bun test
bun run build
```

Before changing backup or restore behavior, include tests for:

- manifest stability
- checksum verification
- dry-run restore planning
- non-overwrite behavior
- AWS read-only command failure handling

Keep destructive operations behind explicit opt-in flags and document the safety model.
