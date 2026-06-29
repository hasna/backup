export type SourceMode = "archive" | "inventory-only";
export type DestinationType = "local" | "s3";

export interface BackupSource {
  id: string;
  name: string;
  type: "local";
  path: string;
  mode: SourceMode;
  excludes: string[];
  createdAt: string;
}

export interface BackupDestination {
  id: string;
  name: string;
  type: DestinationType;
  path?: string;
  bucket?: string;
  prefix?: string;
  awsProfile?: string;
  region?: string;
  createdAt: string;
}

export interface BackupPolicy {
  retentionDays: number;
  compression: "tgz";
  encryption: "none";
}

export interface BackupConfig {
  version: 1;
  createdAt: string;
  updatedAt: string;
  policy: BackupPolicy;
  sources: BackupSource[];
  destinations: BackupDestination[];
}

export interface BackupHome {
  root: string;
  configPath: string;
  manifestsDir: string;
  restorePlansDir: string;
  tmpDir: string;
  runsPath: string;
}

export interface SourceInventory {
  source: BackupSource;
  exists: boolean;
  kind: "file" | "directory" | "missing" | "other";
  bytes: number;
  files: number;
  directories: number;
  skipped: number;
  truncated: boolean;
}

export interface BackupArchiveEntry {
  sourceId: string;
  sourceName: string;
  sourcePath: string;
  mode: SourceMode;
  archiveName?: string;
  bytes?: number;
  sha256?: string;
  destinationUri?: string;
  skippedReason?: string;
}

export interface BackupManifest {
  id: string;
  createdAt: string;
  host: string;
  destination: BackupDestination;
  policy: BackupPolicy;
  archives: BackupArchiveEntry[];
  inventory: SourceInventory[];
}

export interface BackupRunResult {
  ok: boolean;
  dryRun: boolean;
  manifest: BackupManifest;
  manifestPath: string;
}

export interface VerifyResult {
  ok: boolean;
  backupId: string;
  checkedAt: string;
  checks: Array<{
    sourceName: string;
    ok: boolean;
    expectedSha256?: string;
    actualSha256?: string;
    message: string;
  }>;
}

export interface RestorePlan {
  id: string;
  backupId: string;
  createdAt: string;
  target: string;
  planPath: string;
  operations: Array<{
    sourceName: string;
    archiveName?: string;
    destinationPath: string;
    entriesPreview: string[];
    command: string;
  }>;
  warnings: string[];
}

export interface AwsCommandResult<T = unknown> {
  ok: boolean;
  command: string[];
  data?: T;
  error?: string;
}
