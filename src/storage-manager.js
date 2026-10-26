const { app, session } = require('electron');
const path = require('path');
const fs = require('fs');

const PARTITION_PREFIX = 'timworkspaces-';
const MAINTENANCE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const ICON_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Não apaga cookies, localStorage nem IndexedDB: logins e dados offline sobrevivem
const CACHE_ONLY_STORAGES = ['shadercache', 'cachestorage'];

const partitionsDir = () => path.join(app.getPath('userData'), 'Partitions');
const maintenanceFile = () => path.join(app.getPath('userData'), 'maintenance.json');

function partitionIdFor(serviceId) {
  const id = String(serviceId || '');
  return id && id !== 'default' ? id.replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
}

function sessionFor(serviceId) {
  return session.fromPartition('persist:' + PARTITION_PREFIX + partitionIdFor(serviceId));
}

async function dirSize(dir) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  const sizes = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return dirSize(full);
    if (!entry.isFile()) return 0;
    try { return (await fs.promises.stat(full)).size; } catch { return 0; }
  }));
  return sizes.reduce((a, b) => a + b, 0);
}

async function listServicePartitionDirs() {
  try {
    const entries = await fs.promises.readdir(partitionsDir(), { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith(PARTITION_PREFIX))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

let orphansPruned = false;

// Só corre uma vez por arranque, antes de qualquer sessão órfã ser carregada
async function pruneOrphanPartitions(validIds) {
  if (orphansPruned || !Array.isArray(validIds) || validIds.length === 0) return 0;
  orphansPruned = true;
  const keep = new Set(validIds.map((id) => (PARTITION_PREFIX + partitionIdFor(id)).toLowerCase()));
  let removed = 0;
  for (const name of await listServicePartitionDirs()) {
    if (keep.has(name.toLowerCase())) continue;
    try {
      await fs.promises.rm(path.join(partitionsDir(), name), { recursive: true, force: true });
      removed++;
    } catch {}
  }
  return removed;
}

async function clearPartitionCaches(sess) {
  await Promise.allSettled([
    sess.clearCache(),
    sess.clearCodeCaches({}),
    sess.clearStorageData({ storages: CACHE_ONLY_STORAGES })
  ]);
}

async function clearServiceCache(serviceId) {
  await clearPartitionCaches(sessionFor(serviceId));
}

async function clearAllCaches() {
  const dirs = await listServicePartitionDirs();
  for (const name of dirs) {
    await clearPartitionCaches(session.fromPartition('persist:' + name));
  }
}

// Remoção de serviço: apaga tudo da sessão; a pasta vazia sai no próximo arranque
async function clearServicePartition(serviceId) {
  const sess = sessionFor(serviceId);
  await Promise.allSettled([sess.clearStorageData(), sess.clearCache(), sess.clearCodeCaches({})]);
}

async function getUsage(serviceIds) {
  const ids = Array.isArray(serviceIds) ? serviceIds : [];
  const services = {};
  await Promise.all(ids.map(async (id) => {
    services[id] = await dirSize(path.join(partitionsDir(), PARTITION_PREFIX + partitionIdFor(id)));
  }));
  const total = await dirSize(app.getPath('userData'));
  return { services, total };
}

async function pruneIconCache(iconCacheDir) {
  let names;
  try { names = await fs.promises.readdir(iconCacheDir); } catch { return; }
  const now = Date.now();
  await Promise.all(names.map(async (name) => {
    const full = path.join(iconCacheDir, name);
    try {
      const stat = await fs.promises.stat(full);
      if (now - stat.mtimeMs > ICON_CACHE_MAX_AGE_MS) await fs.promises.rm(full, { force: true });
    } catch {}
  }));
}

async function readLastMaintenance() {
  try {
    const data = JSON.parse(await fs.promises.readFile(maintenanceFile(), 'utf8'));
    return Number(data.lastRun) || 0;
  } catch {
    return 0;
  }
}

async function runMaintenance({ iconCacheDir, force = false } = {}) {
  const lastRun = await readLastMaintenance();
  if (!force && Date.now() - lastRun < MAINTENANCE_INTERVAL_MS) return false;
  await clearAllCaches();
  if (iconCacheDir) await pruneIconCache(iconCacheDir);
  try {
    await fs.promises.writeFile(maintenanceFile(), JSON.stringify({ lastRun: Date.now() }), 'utf8');
  } catch {}
  return true;
}

module.exports = {
  pruneOrphanPartitions,
  clearServiceCache,
  clearAllCaches,
  clearServicePartition,
  getUsage,
  runMaintenance
};
