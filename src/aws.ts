import type { AwsCommandResult } from "./types.js";

const DEFAULT_REGIONS = ["us-east-1", "eu-central-1", "us-west-2", "eu-west-1"];

export function awsInventory(options: { profile: string; regions?: string[] }) {
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    profile: options.profile,
    s3Buckets: awsJson<string[]>(["s3api", "list-buckets", "--query", "Buckets[].Name"], options.profile),
    backup: backupAudit(options),
    rds: rdsAudit(options)
  };
}

export function s3Audit(options: { profile: string; bucket?: string }) {
  const buckets = options.bucket
    ? [options.bucket]
    : (awsJson<string[]>(["s3api", "list-buckets", "--query", "Buckets[].Name"], options.profile).data ?? []);
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    profile: options.profile,
    buckets: buckets.map((bucket) => auditBucket(options.profile, bucket))
  };
}

export function backupAudit(options: { profile: string; regions?: string[] }) {
  const regions = options.regions?.length ? options.regions : DEFAULT_REGIONS;
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    profile: options.profile,
    regions: regions.map((region) => ({
      region,
      vaults: awsJson(["backup", "list-backup-vaults"], options.profile, region),
      plans: awsJson(["backup", "list-backup-plans"], options.profile, region),
      protectedResources: awsJson(["backup", "list-protected-resources"], options.profile, region),
      recentBackupJobs: awsJson([
        "backup",
        "list-backup-jobs",
        "--by-created-after",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      ], options.profile, region),
      recentRestoreJobs: awsJson([
        "backup",
        "list-restore-jobs",
        "--by-created-after",
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      ], options.profile, region)
    }))
  };
}

export function rdsAudit(options: { profile: string; regions?: string[] }) {
  const regions = options.regions?.length ? options.regions : DEFAULT_REGIONS;
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    profile: options.profile,
    regions: regions.map((region) => {
      const instances = awsJson<{ DBInstances?: unknown[] }>(["rds", "describe-db-instances"], options.profile, region);
      const clusters = awsJson<{ DBClusters?: unknown[] }>(["rds", "describe-db-clusters"], options.profile, region);
      return {
        region,
        instances: summarizeInstances(instances),
        clusters: summarizeClusters(clusters)
      };
    })
  };
}

function auditBucket(profile: string, bucket: string) {
  return {
    bucket,
    location: awsJson(["s3api", "get-bucket-location", "--bucket", bucket], profile),
    versioning: awsJson(["s3api", "get-bucket-versioning", "--bucket", bucket], profile),
    encryption: awsJson(["s3api", "get-bucket-encryption", "--bucket", bucket], profile),
    publicAccessBlock: awsJson(["s3api", "get-public-access-block", "--bucket", bucket], profile),
    lifecycle: awsJson(["s3api", "get-bucket-lifecycle-configuration", "--bucket", bucket], profile),
    objectLock: awsJson(["s3api", "get-object-lock-configuration", "--bucket", bucket], profile)
  };
}

export function awsJson<T = unknown>(args: string[], profile: string, region?: string): AwsCommandResult<T> {
  const command = ["aws", "--profile", profile, ...args, "--output", "json"];
  if (region) command.splice(3, 0, "--region", region);
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe", env: process.env });
  if (result.exitCode !== 0) {
    return {
      ok: false,
      command,
      error: result.stderr.toString().trim() || result.stdout.toString().trim()
    };
  }
  const stdout = result.stdout.toString().trim();
  return {
    ok: true,
    command,
    data: stdout ? JSON.parse(stdout) as T : undefined
  };
}

function summarizeInstances(result: AwsCommandResult<{ DBInstances?: unknown[] }>) {
  if (!result.ok) return result;
  const instances = result.data?.DBInstances ?? [];
  const items = instances.map((raw) => {
    const item = raw as Record<string, unknown>;
    const summary = {
      id: item.DBInstanceIdentifier,
      engine: item.Engine,
      status: item.DBInstanceStatus,
      backupRetentionPeriod: item.BackupRetentionPeriod,
      preferredBackupWindow: item.PreferredBackupWindow,
      latestRestorableTime: item.LatestRestorableTime,
      deletionProtection: item.DeletionProtection,
      storageEncrypted: item.StorageEncrypted,
      multiAZ: item.MultiAZ,
      copyTagsToSnapshot: item.CopyTagsToSnapshot
    };
    return { ...summary, findings: rdsFindings(summary) };
  });
  return {
    ok: true,
    count: instances.length,
    findings: items.flatMap((item) => item.findings.map((finding) => ({ resource: item.id, ...finding }))),
    items
  };
}

function summarizeClusters(result: AwsCommandResult<{ DBClusters?: unknown[] }>) {
  if (!result.ok) return result;
  const clusters = result.data?.DBClusters ?? [];
  const items = clusters.map((raw) => {
    const item = raw as Record<string, unknown>;
    const summary = {
      id: item.DBClusterIdentifier,
      engine: item.Engine,
      status: item.Status,
      backupRetentionPeriod: item.BackupRetentionPeriod,
      preferredBackupWindow: item.PreferredBackupWindow,
      latestRestorableTime: item.LatestRestorableTime,
      deletionProtection: item.DeletionProtection,
      storageEncrypted: item.StorageEncrypted,
      copyTagsToSnapshot: item.CopyTagsToSnapshot
    };
    return { ...summary, findings: rdsFindings(summary) };
  });
  return {
    ok: true,
    count: clusters.length,
    findings: items.flatMap((item) => item.findings.map((finding) => ({ resource: item.id, ...finding }))),
    items
  };
}

function rdsFindings(summary: Record<string, unknown>) {
  const findings: Array<{ severity: "critical" | "high" | "medium" | "low"; message: string }> = [];
  const retention = typeof summary.backupRetentionPeriod === "number" ? summary.backupRetentionPeriod : 0;
  if (retention <= 0) findings.push({ severity: "critical", message: "Automated backups are disabled." });
  else if (retention < 7) findings.push({ severity: "high", message: `Automated backup retention is short: ${retention} day(s).` });
  if (summary.deletionProtection !== true) findings.push({ severity: "high", message: "Deletion protection is disabled." });
  if (summary.storageEncrypted !== true) findings.push({ severity: "high", message: "Storage encryption is disabled." });
  if (summary.copyTagsToSnapshot !== true) findings.push({ severity: "medium", message: "Tags are not copied to snapshots." });
  if (!summary.latestRestorableTime) findings.push({ severity: "medium", message: "Latest restorable time is not reported." });
  return findings;
}
