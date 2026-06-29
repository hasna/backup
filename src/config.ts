import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { BackupConfig, BackupDestination, BackupHome, BackupSource, DestinationType, SourceMode } from "./types.js";

export const DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".cache",
  ".env",
  ".env.*",
  ".secrets",
  ".connect",
  "*.pem",
  "*_TOKEN",
  "*_KEY"
];

export function backupHome(root = process.env.HASNA_BACKUP_HOME): BackupHome {
  const base = root?.trim() ? resolve(expandHome(root.trim())) : join(homedir(), ".hasna", "backup");
  return {
    root: base,
    configPath: join(base, "config.json"),
    manifestsDir: join(base, "manifests"),
    restorePlansDir: join(base, "restore-plans"),
    tmpDir: join(base, "tmp"),
    runsPath: join(base, "runs.jsonl")
  };
}

export function ensureHome(home = backupHome()): BackupHome {
  for (const path of [home.root, home.manifestsDir, home.restorePlansDir, home.tmpDir]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  return home;
}

export function initBackup(options: { home?: string } = {}) {
  const home = ensureHome(backupHome(options.home));
  if (!existsSync(home.configPath)) {
    saveConfig(defaultConfig(), home);
  }
  return {
    ok: true,
    home: home.root,
    configPath: home.configPath,
    commands: ["sources add", "destinations add", "plan", "run", "verify", "restore plan"]
  };
}

export function loadConfig(home = ensureHome()): BackupConfig {
  if (!existsSync(home.configPath)) {
    const config = defaultConfig();
    saveConfig(config, home);
    return config;
  }
  return JSON.parse(readFileSync(home.configPath, "utf8")) as BackupConfig;
}

export function saveConfig(config: BackupConfig, home = ensureHome()): void {
  const updated = { ...config, updatedAt: new Date().toISOString() };
  writeJsonAtomic(home.configPath, updated);
}

export function addSource(input: { name: string; path: string; mode?: SourceMode; excludes?: string[]; home?: string }) {
  const home = ensureHome(backupHome(input.home));
  const config = loadConfig(home);
  const source: BackupSource = {
    id: uniqueId("src"),
    name: input.name,
    type: "local",
    path: resolve(expandHome(input.path)),
    mode: input.mode ?? "archive",
    excludes: input.excludes ?? DEFAULT_EXCLUDES,
    createdAt: new Date().toISOString()
  };
  config.sources = config.sources.filter((existing) => existing.name !== source.name && existing.id !== source.id);
  config.sources.push(source);
  saveConfig(config, home);
  return { ok: true, source };
}

export function removeSource(idOrName: string, options: { home?: string } = {}) {
  const home = ensureHome(backupHome(options.home));
  const config = loadConfig(home);
  const before = config.sources.length;
  config.sources = config.sources.filter((source) => source.id !== idOrName && source.name !== idOrName);
  saveConfig(config, home);
  return { ok: config.sources.length < before, removed: before - config.sources.length };
}

export function addDestination(input: {
  name: string;
  type: DestinationType;
  target: string;
  awsProfile?: string;
  region?: string;
  home?: string;
}) {
  const home = ensureHome(backupHome(input.home));
  const config = loadConfig(home);
  const parsedS3 = input.type === "s3" ? parseS3Uri(input.target) : null;
  const destination: BackupDestination = {
    id: uniqueId("dst"),
    name: input.name,
    type: input.type,
    path: input.type === "local" ? resolve(expandHome(input.target)) : undefined,
    bucket: parsedS3?.bucket,
    prefix: parsedS3?.prefix,
    awsProfile: input.awsProfile,
    region: input.region,
    createdAt: new Date().toISOString()
  };
  config.destinations = config.destinations.filter((existing) => existing.name !== destination.name && existing.id !== destination.id);
  config.destinations.push(destination);
  saveConfig(config, home);
  return { ok: true, destination };
}

export function removeDestination(idOrName: string, options: { home?: string } = {}) {
  const home = ensureHome(backupHome(options.home));
  const config = loadConfig(home);
  const before = config.destinations.length;
  config.destinations = config.destinations.filter((destination) => destination.id !== idOrName && destination.name !== idOrName);
  saveConfig(config, home);
  return { ok: config.destinations.length < before, removed: before - config.destinations.length };
}

export function findSource(config: BackupConfig, idOrName?: string): BackupSource[] {
  if (!idOrName) return config.sources;
  const source = config.sources.find((candidate) => candidate.id === idOrName || candidate.name === idOrName);
  if (!source) throw new Error(`Source not found: ${idOrName}`);
  return [source];
}

export function findDestination(config: BackupConfig, idOrName?: string): BackupDestination {
  if (idOrName) {
    const destination = config.destinations.find((candidate) => candidate.id === idOrName || candidate.name === idOrName);
    if (!destination) throw new Error(`Destination not found: ${idOrName}`);
    return destination;
  }
  const destination = config.destinations[0];
  if (!destination) throw new Error("No destinations configured. Run `backup destinations add ...` first.");
  return destination;
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function parseS3Uri(uri: string): { bucket: string; prefix: string } {
  if (!uri.startsWith("s3://")) throw new Error(`Invalid S3 URI: ${uri}`);
  const withoutScheme = uri.slice("s3://".length);
  const [bucket, ...prefixParts] = withoutScheme.split("/");
  if (!bucket) throw new Error(`Invalid S3 URI, missing bucket: ${uri}`);
  return { bucket, prefix: prefixParts.join("/").replace(/^\/+|\/+$/g, "") };
}

export function destinationUri(destination: BackupDestination, key?: string): string {
  if (destination.type === "local") return key ? join(destination.path ?? "", key) : destination.path ?? "";
  const prefix = [destination.prefix, key].filter(Boolean).join("/");
  return `s3://${destination.bucket}/${prefix}`;
}

export function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

export function uniqueId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${random}`;
}

function defaultConfig(): BackupConfig {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    policy: {
      retentionDays: 30,
      compression: "tgz",
      encryption: "none"
    },
    sources: [],
    destinations: []
  };
}
