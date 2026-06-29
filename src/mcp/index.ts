#!/usr/bin/env bun
import {
  awsInventory,
  createRestorePlan,
  inventory,
  listBackups,
  loadConfig,
  status,
  verifyBackup
} from "../runtime.js";
import { backupHome, ensureHome } from "../config.js";

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const tools = [
  {
    name: "backup_status",
    description: "Read open-backup local status.",
    inputSchema: { type: "object", properties: { home: { type: "string" } } }
  },
  {
    name: "backup_inventory",
    description: "Inventory configured backup sources.",
    inputSchema: { type: "object", properties: { home: { type: "string" }, source: { type: "string" } } }
  },
  {
    name: "backup_list",
    description: "List local backup manifests.",
    inputSchema: { type: "object", properties: { home: { type: "string" }, limit: { type: "number" } } }
  },
  {
    name: "backup_verify",
    description: "Verify a backup by checksum.",
    inputSchema: { type: "object", properties: { home: { type: "string" }, id: { type: "string" } } }
  },
  {
    name: "backup_restore_plan",
    description: "Create a dry-run restore plan.",
    inputSchema: {
      type: "object",
      required: ["target"],
      properties: { home: { type: "string" }, id: { type: "string" }, target: { type: "string" } }
    }
  },
  {
    name: "backup_aws_inventory",
    description: "Run read-only AWS backup posture inventory.",
    inputSchema: {
      type: "object",
      required: ["profile"],
      properties: {
        profile: { type: "string" },
        regions: { type: "array", items: { type: "string" } }
      }
    }
  }
];

async function handle(request: JsonRpcRequest) {
  if (request.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "@hasna/backup", version: "0.1.2" }
    };
  }
  if (request.method === "tools/list") return { tools };
  if (request.method === "tools/call") {
    const name = String(request.params?.name ?? "");
    const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
    const result = await callTool(name, args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  return {};
}

async function callTool(name: string, args: Record<string, unknown>) {
  const home = typeof args.home === "string" ? args.home : undefined;
  if (name === "backup_status") return status({ home });
  if (name === "backup_inventory") {
    const resolvedHome = ensureHome(backupHome(home));
    return inventory(loadConfig(resolvedHome), { source: typeof args.source === "string" ? args.source : undefined });
  }
  if (name === "backup_list") return listBackups({ home, limit: typeof args.limit === "number" ? args.limit : undefined });
  if (name === "backup_verify") return verifyBackup(typeof args.id === "string" ? args.id : "latest", { home });
  if (name === "backup_restore_plan") {
    return createRestorePlan(typeof args.id === "string" ? args.id : "latest", String(args.target), { home });
  }
  if (name === "backup_aws_inventory") {
    return awsInventory({
      profile: String(args.profile),
      regions: Array.isArray(args.regions) ? args.regions.map(String) : undefined
    });
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function main(): Promise<void> {
  const input = await new Response(Bun.stdin.stream()).text();
  for (const line of input.split(/\r?\n/).filter((candidate) => candidate.trim())) {
    const request = JSON.parse(line) as JsonRpcRequest;
    try {
      console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, result: await handle(request) }));
    } catch (error) {
      console.log(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
      }));
    }
  }
}

if (import.meta.main) {
  await main();
}
