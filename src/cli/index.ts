#!/usr/bin/env bun
import type { DestinationType, SourceMode } from "../types.js";
import {
  addDestination,
  addSource,
  awsInventory,
  backupAudit,
  createRestorePlan,
  destinationHealth,
  findDestination,
  findSource,
  getManifest,
  initBackup,
  inventory,
  listBackups,
  loadConfig,
  rdsAudit,
  removeDestination,
  removeSource,
  runBackup,
  s3Audit,
  status,
  verifyBackup
} from "../runtime.js";
import { backupHome, ensureHome } from "../config.js";

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const [command = "help", ...rest] = parsed.positional;
  const home = stringFlag(parsed, "home");

  try {
    switch (command) {
      case "init":
        print(initBackup({ home }));
        return;
      case "doctor":
        print(doctor(home));
        return;
      case "status":
        print(status({ home }));
        return;
      case "inventory":
        print(inventory(loadConfig(ensureHome(backupHome(home))), { source: stringFlag(parsed, "source") }));
        return;
      case "sources":
        print(handleSources(rest, parsed, home));
        return;
      case "destinations":
        print(handleDestinations(rest, parsed, home));
        return;
      case "plan":
        print(await runBackup({ source: stringFlag(parsed, "source"), destination: stringFlag(parsed, "destination"), dryRun: true, home }));
        return;
      case "run":
        print(await runBackup({ source: stringFlag(parsed, "source"), destination: stringFlag(parsed, "destination"), dryRun: Boolean(parsed.flags["dry-run"]), home }));
        return;
      case "list":
        print(listBackups({ home, limit: numberFlag(parsed, "limit") }));
        return;
      case "show":
      case "manifest":
        print(getManifest(rest[0] ?? "latest", { home }));
        return;
      case "verify":
        print(await verifyBackup(rest[0] ?? "latest", { home }));
        return;
      case "restore":
        print(await handleRestore(rest, parsed, home));
        return;
      case "aws":
        print(handleAws(rest, parsed));
        return;
      case "help":
        printHelp();
        return;
      default:
        printHelp();
        process.exitCode = 1;
    }
  } catch (error) {
    process.exitCode = 1;
    print({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function handleSources(rest: string[], parsed: ParsedArgs, home?: string) {
  const subcommand = rest[0] ?? "list";
  const config = loadConfig(ensureHome(backupHome(home)));
  if (subcommand === "list") return { ok: true, sources: config.sources };
  if (subcommand === "add") {
    const path = required(rest[1], "source path");
    return addSource({
      name: stringFlag(parsed, "name") ?? path.split("/").filter(Boolean).pop() ?? "source",
      path,
      mode: normalizeSourceMode(stringFlag(parsed, "mode")),
      excludes: stringFlag(parsed, "exclude")?.split(",").map((part) => part.trim()).filter(Boolean),
      home
    });
  }
  if (subcommand === "remove") return removeSource(required(rest[1], "source id or name"), { home });
  if (subcommand === "inspect") return { ok: true, sources: findSource(config, required(rest[1], "source id or name")) };
  throw new Error(`Unknown sources command: ${subcommand}`);
}

function handleDestinations(rest: string[], parsed: ParsedArgs, home?: string) {
  const subcommand = rest[0] ?? "list";
  const config = loadConfig(ensureHome(backupHome(home)));
  if (subcommand === "list") return { ok: true, destinations: config.destinations };
  if (subcommand === "add") {
    const type = normalizeDestinationType(required(rest[1], "destination type"));
    const target = required(rest[2], "destination target");
    return addDestination({
      type,
      target,
      name: stringFlag(parsed, "name") ?? (type === "s3" ? "s3" : "local"),
      awsProfile: stringFlag(parsed, "aws-profile"),
      region: stringFlag(parsed, "region"),
      home
    });
  }
  if (subcommand === "remove") return removeDestination(required(rest[1], "destination id or name"), { home });
  if (subcommand === "inspect") return { ok: true, destination: findDestination(config, required(rest[1], "destination id or name")) };
  if (subcommand === "test") return destinationHealth(findDestination(config, required(rest[1], "destination id or name")));
  throw new Error(`Unknown destinations command: ${subcommand}`);
}

async function handleRestore(rest: string[], parsed: ParsedArgs, home?: string) {
  const subcommand = rest[0] ?? "plan";
  if (subcommand !== "plan") throw new Error("Only `backup restore plan` is supported in this release.");
  const id = rest[1] ?? "latest";
  const target = required(stringFlag(parsed, "target"), "--target");
  return createRestorePlan(id, target, { home });
}

function handleAws(rest: string[], parsed: ParsedArgs) {
  const subcommand = rest[0] ?? "inventory";
  const profile = required(stringFlag(parsed, "profile"), "--profile");
  const regions = stringFlag(parsed, "regions")?.split(",").map((part) => part.trim()).filter(Boolean);
  if (subcommand === "inventory") return awsInventory({ profile, regions });
  if (subcommand === "s3-audit") return s3Audit({ profile, bucket: stringFlag(parsed, "bucket") });
  if (subcommand === "backup-audit") return backupAudit({ profile, regions });
  if (subcommand === "rds-audit") return rdsAudit({ profile, regions });
  throw new Error(`Unknown aws command: ${subcommand}`);
}

function doctor(home?: string) {
  const resolved = ensureHome(backupHome(home));
  return {
    ok: true,
    home: resolved.root,
    hasTar: commandOk(["tar", "--version"]),
    hasAws: commandOk(["aws", "--version"]),
    commands: ["init", "doctor", "inventory", "sources", "destinations", "plan", "run", "list", "show", "verify", "restore", "aws"]
  };
}

function commandOk(command: string[]): boolean {
  return Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe", env: process.env }).exitCode === 0;
}

function normalizeSourceMode(value?: string): SourceMode {
  if (!value) return "archive";
  if (value === "archive" || value === "inventory-only") return value;
  throw new Error(`Invalid source mode: ${value}`);
}

function normalizeDestinationType(value: string): DestinationType {
  if (value === "local" || value === "s3") return value;
  throw new Error(`Invalid destination type: ${value}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
      if (inlineValue !== undefined) {
        flags[rawKey] = inlineValue;
      } else if (argv[index + 1] && !argv[index + 1].startsWith("-")) {
        flags[rawKey] = argv[index + 1];
        index += 1;
      } else {
        flags[rawKey] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

function numberFlag(parsed: ParsedArgs, name: string): number | undefined {
  const value = stringFlag(parsed, name);
  if (!value) return undefined;
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) throw new Error(`Invalid number for --${name}: ${value}`);
  return parsedValue;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`Usage: backup <command> [options]

Commands:
  init
  doctor
  status
  inventory [--source name]
  sources list|add|remove|inspect
  destinations list|add|remove|test|inspect
  plan [--source name] [--destination name]
  run [--source name] [--destination name] [--dry-run]
  list
  show <backup-id|latest>
  manifest <backup-id|latest>
  verify <backup-id|latest>
  restore plan <backup-id|latest> --target <path>
  aws inventory|s3-audit|backup-audit|rds-audit --profile <profile>
`);
}

if (import.meta.main) {
  await main();
}
