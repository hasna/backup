import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  addDestination,
  addSource,
  createRestorePlan,
  initBackup,
  listBackups,
  runBackup,
  verifyBackup
} from "../src/index.js";

let tempRoot = "";

beforeEach(() => {
  tempRoot = join("/tmp", `open-backup-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempRoot, { recursive: true });
});

afterEach(() => {
  Bun.spawnSync(["rm", "-rf", tempRoot]);
});

test("runs, lists, verifies, and plans a local backup", async () => {
  const source = join(tempRoot, "source");
  const destination = join(tempRoot, "dest");
  const home = join(tempRoot, "state");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "hello.txt"), "hello backup\n");

  initBackup({ home });
  addSource({ home, name: "fixture", path: source });
  addDestination({ home, name: "local", type: "local", target: destination });

  const run = await runBackup({ home });
  expect(run.ok).toBe(true);
  expect(run.manifest.archives[0]?.sha256).toBeTruthy();

  const listed = listBackups({ home });
  expect(listed.count).toBe(1);
  expect(listed.backups[0]?.id).toBe(run.manifest.id);

  const verification = await verifyBackup("latest", { home });
  expect(verification.ok).toBe(true);

  const plan = await createRestorePlan("latest", join(tempRoot, "restore"), { home });
  expect(plan.operations.length).toBe(1);
  expect(plan.operations[0]?.entriesPreview.some((entry) => entry.includes("hello.txt"))).toBe(true);
});

test("inventory-only sources do not create archives but verify cleanly", async () => {
  const source = join(tempRoot, "metadata-only");
  const destination = join(tempRoot, "dest");
  const home = join(tempRoot, "state");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "secret.txt"), "not archived\n");

  initBackup({ home });
  addSource({ home, name: "metadata", path: source, mode: "inventory-only" });
  addDestination({ home, name: "local", type: "local", target: destination });

  await runBackup({ home });
  const verification = await verifyBackup("latest", { home });
  expect(verification.ok).toBe(true);
  expect(verification.checks[0]?.message).toBe("inventory-only");
});
