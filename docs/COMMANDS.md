# Command Reference

## Setup

```sh
backup init
backup doctor
backup status
```

## Sources

```sh
backup sources list
backup sources add <path> --name <name>
backup sources add <path> --name <name> --mode inventory-only
backup sources inspect <name-or-id>
backup sources remove <name-or-id>
```

## Destinations

```sh
backup destinations list
backup destinations add local <path> --name local
backup destinations add s3 s3://bucket/prefix --name s3-main --aws-profile default --region us-east-1
backup destinations test <name-or-id>
backup destinations inspect <name-or-id>
backup destinations remove <name-or-id>
```

## Backup

```sh
backup inventory
backup plan
backup run
backup run --source hasna-state --destination local
backup run --dry-run
backup list
backup show latest
backup manifest latest
backup verify latest
```

## Restore Planning

```sh
backup restore plan latest --target /tmp/restore-test
backup restore plan <backup-id> --target ~/Restore
```

Restore apply is intentionally not part of the initial release. Plans are written to `~/.hasna/backup/restore-plans/`.

## AWS

```sh
backup aws inventory --profile hasna-xyz-infra
backup aws s3-audit --profile hasna-xyz-infra --bucket hasna-xyz-infra-backups-prod
backup aws backup-audit --profile hasna-xyz-infra --regions us-east-1
backup aws rds-audit --profile hasna-xyz-infra --regions us-east-1,eu-central-1
```
