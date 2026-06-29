import { backupAudit, awsInventory, rdsAudit, s3Audit } from "./aws.js";
import {
  addDestination,
  addSource,
  backupHome,
  ensureHome,
  findDestination,
  findSource,
  initBackup,
  loadConfig,
  removeDestination,
  removeSource
} from "./config.js";
import { createRestorePlan, destinationHealth, getManifest, listBackups, runBackup, verifyBackup } from "./backup.js";
import { inventory } from "./inventory.js";

export function status(options: { home?: string } = {}) {
  const home = ensureHome(backupHome(options.home));
  const config = loadConfig(home);
  const backups = listBackups({ home: home.root, limit: 5 });
  return {
    ok: true,
    home: home.root,
    configPath: home.configPath,
    sources: config.sources.length,
    destinations: config.destinations.length,
    recentBackups: backups.backups
  };
}

export {
  addDestination,
  addSource,
  awsInventory,
  backupAudit,
  backupHome,
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
  verifyBackup
};
