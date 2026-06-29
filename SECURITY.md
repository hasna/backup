# Security

Do not report secrets in public issues. Send sensitive reports through a private channel to the maintainers.

`open-backup` is conservative by default:

- restore execution is not implemented in the MVP
- secret-like paths are excluded from archive mode by default
- `inventory-only` mode can track that a sensitive source exists without archiving values
- AWS audits use explicit named profiles and do not store cloud credentials

Never include API keys, tokens, private keys, `.env` contents, `.connect` token stores, or `.secrets` values in bug reports.
