# AWS Backup Posture

`open-backup` treats AWS as three separate surfaces:

1. S3 object/archive buckets
2. AWS Backup vaults, plans, jobs, and recovery points
3. RDS/Aurora automated backup and deletion-protection posture

All AWS audit commands use the local AWS CLI and explicit profiles.

## S3 Audit

```sh
backup aws s3-audit --profile hasna-xyz-infra --bucket hasna-xyz-infra-backups-prod
```

The audit checks:

- bucket location
- versioning
- default encryption
- public access block
- lifecycle rules
- Object Lock configuration

For hardened backup buckets, prefer:

- S3 Versioning enabled
- public access blocked
- default encryption enabled, preferably SSE-KMS when key control matters
- lifecycle rules for old versions and incomplete multipart uploads
- Object Lock on buckets/prefixes that require immutability
- replication or copy to a separate account/Region for critical data

## AWS Backup Audit

```sh
backup aws backup-audit --profile hasna-xyz-infra --regions us-east-1
```

The audit reports backup vaults, plans, protected resources, recent backup jobs, and recent restore jobs. It does not mutate vaults or plans.

## RDS Audit

```sh
backup aws rds-audit --profile hasna-xyz-infra --regions us-east-1,eu-central-1
```

The audit reports:

- DB instance or cluster identifier
- engine
- status
- automated backup retention
- latest restorable time
- deletion protection
- storage encryption
- multi-AZ where available
- copy-tags-to-snapshot where available

The command is designed to catch app data stores with disabled backups, short retention, or weak deletion protection.
