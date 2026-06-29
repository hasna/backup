# @hasna/backup

Local-first backup coverage, verification, restore planning, and AWS backup posture audits for agents and operators.

`open-backup` is the control layer around proven backup targets. It does not try to replace S3, AWS Backup, RDS snapshots, or local archives. It answers the operational questions those systems leave scattered:

- What important data is covered?
- Where is it backed up?
- When was the last successful run?
- Can the artifact be verified?
- What would restore touch before anything is applied?
- Which AWS resources have weak backup posture?

## Install

```sh
bun install -g @hasna/backup
```

## Quick Start

```sh
backup init
backup sources add ~/.hasna --name hasna-state
backup destinations add local ~/.hasna/backup/local --name local
backup plan
backup run
backup verify latest
backup restore plan latest --target /tmp/open-backup-restore
```

## S3 Destination

```sh
backup destinations add s3 s3://my-backups/laptop --name s3-main --aws-profile default --region us-east-1
backup run --destination s3-main
backup verify latest
```

S3 support uses the installed AWS CLI and explicit named profiles. `open-backup` does not store AWS credentials.

## AWS Audits

Read-only AWS posture checks are available for backup buckets, AWS Backup, and RDS/Aurora:

```sh
backup aws s3-audit --profile hasna-xyz-infra --bucket hasna-xyz-infra-backups-prod
backup aws backup-audit --profile hasna-xyz-infra --regions us-east-1
backup aws rds-audit --profile hasna-xyz-infra --regions us-east-1,eu-central-1
backup aws inventory --profile hasna-xyz-infra
```

## CLI Surface

```text
backup init
backup doctor
backup inventory
backup status
backup sources list|add|remove|inspect
backup destinations list|add|remove|test|inspect
backup plan
backup run
backup list
backup show <backup-id|latest>
backup manifest <backup-id|latest>
backup verify <backup-id|latest>
backup restore plan <backup-id|latest> --target <path>
backup aws inventory|s3-audit|backup-audit|rds-audit
backup-mcp
```

All CLI commands emit JSON by default so humans, agents, and CI can consume the same contract.

## Safety Model

- Restore is plan-only in the MVP. It never overwrites live data.
- Secrets are excluded by default through archive exclusions.
- Source mode `inventory-only` records coverage metadata without archiving file contents.
- AWS commands are read-only except S3 uploads/downloads performed by explicit backup run/verify against an S3 destination.
- Destructive backup lifecycle changes are not implemented in the MVP.

## Local State

The default state directory is:

```text
~/.hasna/backup/
  config.json
  manifests/
  runs.jsonl
  restore-plans/
  tmp/
```

Override it for tests or isolated runs:

```sh
HASNA_BACKUP_HOME=/tmp/backup-state backup init
```

## Hasna Baseline

The first internal profile should cover:

```sh
backup init
backup sources add ~/.hasna --name hasna-state
backup sources add ~/.codewith --name codewith-state
backup sources add ~/workspace --name workspace
backup destinations add s3 s3://hasna-xyz-infra-backups-prod/open-backup/$(hostname) --name infra-s3 --aws-profile hasna-xyz-infra --region us-east-1
backup run --destination infra-s3
backup verify latest
```

## MCP

`backup-mcp` exposes read-only tools by default:

- `backup_status`
- `backup_inventory`
- `backup_list`
- `backup_verify`
- `backup_restore_plan`
- `backup_aws_inventory`

The MCP surface intentionally does not expose restore apply or destructive lifecycle changes.

## License

Apache-2.0
