import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { BackupConfig, BackupSource, SourceInventory } from "./types.js";

const MAX_INVENTORY_ENTRIES = 5_000;

export function inventory(config: BackupConfig, options: { source?: string } = {}) {
  const sources = options.source
    ? config.sources.filter((source) => source.id === options.source || source.name === options.source)
    : config.sources;
  if (options.source && sources.length === 0) throw new Error(`Source not found: ${options.source}`);
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    sourceCount: sources.length,
    sources: sources.map((source) => inventorySource(source))
  };
}

export function inventorySource(source: BackupSource): SourceInventory {
  if (!existsSync(source.path)) {
    return {
      source,
      exists: false,
      kind: "missing",
      bytes: 0,
      files: 0,
      directories: 0,
      skipped: 0,
      truncated: false
    };
  }

  const initial = statSync(source.path);
  if (initial.isFile()) {
    return {
      source,
      exists: true,
      kind: "file",
      bytes: initial.size,
      files: 1,
      directories: 0,
      skipped: 0,
      truncated: false
    };
  }
  if (!initial.isDirectory()) {
    return {
      source,
      exists: true,
      kind: "other",
      bytes: initial.size,
      files: 0,
      directories: 0,
      skipped: 1,
      truncated: false
    };
  }

  let bytes = 0;
  let files = 0;
  let directories = 0;
  let skipped = 0;
  let seen = 0;
  let truncated = false;
  const stack = [source.path];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen >= MAX_INVENTORY_ENTRIES) {
      truncated = true;
      break;
    }
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      skipped += 1;
      continue;
    }
    for (const entry of entries) {
      if (shouldExclude(entry, source.excludes)) {
        skipped += 1;
        continue;
      }
      const fullPath = join(current, entry);
      seen += 1;
      if (seen >= MAX_INVENTORY_ENTRIES) {
        truncated = true;
        break;
      }
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          directories += 1;
          stack.push(fullPath);
        } else if (stat.isFile()) {
          files += 1;
          bytes += stat.size;
        } else {
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
    }
  }

  return {
    source,
    exists: true,
    kind: "directory",
    bytes,
    files,
    directories,
    skipped,
    truncated
  };
}

export function shouldExclude(nameOrPath: string, patterns: string[]): boolean {
  const name = basename(nameOrPath);
  return patterns.some((pattern) => {
    if (pattern.includes("*")) {
      const regex = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`);
      return regex.test(name) || regex.test(nameOrPath);
    }
    return name === pattern || nameOrPath.includes(`/${pattern}/`);
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
