import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  BackupArchiveEntry,
  BackupDestination,
  BackupHome,
  BackupManifest,
  BackupRunResult,
  RestorePlan,
  VerifyResult
} from "./types.js";
import { backupHome, destinationUri, ensureHome, findDestination, findSource, loadConfig, uniqueId, writeJsonAtomic } from "./config.js";
import { inventorySource } from "./inventory.js";

export async function runBackup(options: {
  source?: string;
  destination?: string;
  dryRun?: boolean;
  home?: string;
} = {}): Promise<BackupRunResult> {
  const home = ensureHome(backupHome(options.home));
  const config = loadConfig(home);
  const sources = findSource(config, options.source);
  const destination = findDestination(config, options.destination);
  const id = uniqueId("bkp");
  const inventory = sources.map((source) => inventorySource(source));
  const manifest: BackupManifest = {
    id,
    createdAt: new Date().toISOString(),
    host: hostname(),
    destination,
    policy: config.policy,
    archives: [],
    inventory
  };

  for (const source of sources) {
    const sourceInventory = inventory.find((item) => item.source.id === source.id);
    if (!sourceInventory?.exists) {
      manifest.archives.push({
        sourceId: source.id,
        sourceName: source.name,
        sourcePath: source.path,
        mode: source.mode,
        skippedReason: "source-missing"
      });
      continue;
    }
    if (source.mode === "inventory-only") {
      manifest.archives.push({
        sourceId: source.id,
        sourceName: source.name,
        sourcePath: source.path,
        mode: source.mode,
        skippedReason: "inventory-only"
      });
      continue;
    }

    const archiveName = `${id}-${sanitizeName(source.name)}.tgz`;
    const archivePath = join(home.tmpDir, archiveName);
    const entry: BackupArchiveEntry = {
      sourceId: source.id,
      sourceName: source.name,
      sourcePath: source.path,
      mode: source.mode,
      archiveName
    };

    if (!options.dryRun) {
      createArchive(source.path, archivePath, source.excludes);
      entry.bytes = statSync(archivePath).size;
      entry.sha256 = await sha256File(archivePath);
      const destinationKey = `${id}/${archiveName}`;
      entry.destinationUri = await copyArchiveToDestination(archivePath, destination, destinationKey);
    } else {
      entry.destinationUri = destinationUri(destination, `${id}/${archiveName}`);
    }
    manifest.archives.push(entry);
  }

  const manifestPath = join(home.manifestsDir, `${id}.json`);
  if (!options.dryRun) {
    writeJsonAtomic(manifestPath, manifest);
    await copyManifestToDestination(manifestPath, destination, `${id}/manifest.json`);
    appendRun(home, manifest);
  }

  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    manifest,
    manifestPath
  };
}

export function listBackups(options: { home?: string; limit?: number } = {}) {
  const home = ensureHome(backupHome(options.home));
  const manifests = readManifests(home)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, options.limit ?? 50);
  return {
    ok: true,
    count: manifests.length,
    backups: manifests.map((manifest) => ({
      id: manifest.id,
      createdAt: manifest.createdAt,
      host: manifest.host,
      destination: destinationUri(manifest.destination),
      archives: manifest.archives.length
    }))
  };
}

export function getManifest(idOrLatest: string, options: { home?: string } = {}): BackupManifest {
  const home = ensureHome(backupHome(options.home));
  const manifests = readManifests(home).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (idOrLatest === "latest") {
    const latest = manifests[0];
    if (!latest) throw new Error("No backups found.");
    return latest;
  }
  const manifest = manifests.find((candidate) => candidate.id === idOrLatest);
  if (!manifest) throw new Error(`Backup not found: ${idOrLatest}`);
  return manifest;
}

export async function verifyBackup(idOrLatest = "latest", options: { home?: string } = {}): Promise<VerifyResult> {
  const home = ensureHome(backupHome(options.home));
  const manifest = getManifest(idOrLatest, { home: home.root });
  const checks: VerifyResult["checks"] = [];
  for (const archive of manifest.archives) {
    if (!archive.sha256 || !archive.destinationUri) {
      checks.push({
        sourceName: archive.sourceName,
        ok: archive.mode === "inventory-only",
        message: archive.skippedReason ?? "archive not materialized"
      });
      continue;
    }
    const localPath = await materializeArchiveForRead(manifest.destination, archive.destinationUri, home);
    const actualSha256 = await sha256File(localPath);
    checks.push({
      sourceName: archive.sourceName,
      ok: actualSha256 === archive.sha256,
      expectedSha256: archive.sha256,
      actualSha256,
      message: actualSha256 === archive.sha256 ? "checksum matched" : "checksum mismatch"
    });
  }
  return {
    ok: checks.every((check) => check.ok),
    backupId: manifest.id,
    checkedAt: new Date().toISOString(),
    checks
  };
}

export async function createRestorePlan(idOrLatest: string, target: string, options: { home?: string } = {}): Promise<RestorePlan> {
  const home = ensureHome(backupHome(options.home));
  const manifest = getManifest(idOrLatest, { home: home.root });
  const planId = uniqueId("restore");
  const targetRoot = resolve(target);
  const operations: RestorePlan["operations"] = [];
  const warnings: string[] = [];

  for (const archive of manifest.archives) {
    if (!archive.archiveName || !archive.destinationUri) {
      warnings.push(`Source ${archive.sourceName} has no archive: ${archive.skippedReason ?? "unknown reason"}`);
      continue;
    }
    const localPath = await materializeArchiveForRead(manifest.destination, archive.destinationUri, home);
    const destinationPath = join(targetRoot, sanitizeName(archive.sourceName));
    operations.push({
      sourceName: archive.sourceName,
      archiveName: archive.archiveName,
      destinationPath,
      entriesPreview: listArchiveEntries(localPath).slice(0, 100),
      command: `mkdir -p ${quoteShell(destinationPath)} && tar -xzf ${quoteShell(localPath)} -C ${quoteShell(destinationPath)}`
    });
  }

  const planPath = join(home.restorePlansDir, `${planId}.json`);
  const plan: RestorePlan = {
    id: planId,
    backupId: manifest.id,
    createdAt: new Date().toISOString(),
    target: targetRoot,
    planPath,
    operations,
    warnings
  };
  writeJsonAtomic(planPath, plan);
  return plan;
}

export function destinationHealth(destination: BackupDestination) {
  if (destination.type === "local") {
    const path = destination.path ?? "";
    return { ok: existsSync(path), destination, message: existsSync(path) ? "local path exists" : "local path does not exist" };
  }
  const args = ["aws"];
  if (destination.awsProfile) args.push("--profile", destination.awsProfile);
  if (destination.region) args.push("--region", destination.region);
  args.push("s3api", "head-bucket", "--bucket", destination.bucket ?? "");
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe", env: process.env });
  return {
    ok: result.exitCode === 0,
    destination,
    command: args,
    message: result.exitCode === 0 ? "bucket reachable" : result.stderr.toString().trim()
  };
}

function createArchive(sourcePath: string, archivePath: string, excludes: string[]): void {
  mkdirSync(dirname(archivePath), { recursive: true, mode: 0o700 });
  const parent = dirname(sourcePath);
  const base = basename(sourcePath);
  const args = ["tar", "-czf", archivePath, "-C", parent];
  for (const exclude of excludes) args.push(`--exclude=${exclude}`);
  args.push(base);
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe", env: process.env });
  if (result.exitCode !== 0) {
    throw new Error(`tar failed for ${sourcePath}: ${result.stderr.toString().trim()}`);
  }
}

async function copyArchiveToDestination(archivePath: string, destination: BackupDestination, key: string): Promise<string> {
  if (destination.type === "local") {
    const target = join(destination.path ?? "", key);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    await Bun.write(target, Bun.file(archivePath));
    return target;
  }
  const uri = destinationUri(destination, key);
  runAwsS3Cp(destination, archivePath, uri);
  return uri;
}

async function copyManifestToDestination(manifestPath: string, destination: BackupDestination, key: string): Promise<void> {
  if (destination.type === "local") {
    const target = join(destination.path ?? "", key);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    await Bun.write(target, Bun.file(manifestPath));
    return;
  }
  runAwsS3Cp(destination, manifestPath, destinationUri(destination, key));
}

async function materializeArchiveForRead(destination: BackupDestination, uri: string, home: BackupHome): Promise<string> {
  if (!uri.startsWith("s3://")) return uri;
  const target = join(home.tmpDir, `${uniqueId("verify")}-${basename(uri)}`);
  const args = ["aws"];
  if (destination.awsProfile) args.push("--profile", destination.awsProfile);
  if (destination.region) args.push("--region", destination.region);
  args.push("s3", "cp", uri, target);
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe", env: process.env });
  if (result.exitCode !== 0) throw new Error(`Failed to download ${uri}: ${result.stderr.toString().trim()}`);
  return target;
}

function runAwsS3Cp(destination: BackupDestination, localPath: string, uri: string): void {
  const args = ["aws"];
  if (destination.awsProfile) args.push("--profile", destination.awsProfile);
  if (destination.region) args.push("--region", destination.region);
  args.push("s3", "cp", localPath, uri);
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe", env: process.env });
  if (result.exitCode !== 0) throw new Error(`S3 upload failed: ${result.stderr.toString().trim()}`);
}

function listArchiveEntries(path: string): string[] {
  const result = Bun.spawnSync(["tar", "-tzf", path], { stdout: "pipe", stderr: "pipe", env: process.env });
  if (result.exitCode !== 0) return [`unable to list archive: ${result.stderr.toString().trim()}`];
  return result.stdout.toString().split(/\r?\n/).filter(Boolean);
}

function readManifests(home: BackupHome): BackupManifest[] {
  const result = Bun.spawnSync(["bash", "-lc", `find ${quoteShell(home.manifestsDir)} -maxdepth 1 -type f -name '*.json' -print`], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env
  });
  if (result.exitCode !== 0) return [];
  return result.stdout.toString().split(/\r?\n/).filter(Boolean).map((path) => JSON.parse(readFileSync(path, "utf8")) as BackupManifest);
}

function appendRun(home: BackupHome, manifest: BackupManifest): void {
  writeFileSync(home.runsPath, `${JSON.stringify({ id: manifest.id, createdAt: manifest.createdAt, destination: destinationUri(manifest.destination) })}\n`, {
    flag: "a",
    mode: 0o600
  });
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise());
  });
  return hash.digest("hex");
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
