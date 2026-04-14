import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

const createSyncEngineTableSql = `
  CREATE TABLE IF NOT EXISTS sync_engine_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER DEFAULT 0,
    node_id TEXT,
    last_hlc_logical_ms INTEGER DEFAULT 0,
    last_hlc_counter INTEGER DEFAULT 0,
    memory_budget_mb INTEGER DEFAULT 50,
    cache_enabled INTEGER DEFAULT 1,
    performance_mode TEXT DEFAULT 'balanced' CHECK (performance_mode IN ('fast','balanced','memory')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
`;

const createUserSyncTableSql = `
  CREATE TABLE IF NOT EXISTS sync_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    desktop_user_uuid TEXT,
    sync_enabled INTEGER DEFAULT 0,
    last_push_at INTEGER,
    last_pull_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

const ensureUserSyncRowSql = `
  INSERT OR IGNORE INTO sync_config (
    id,
    desktop_user_uuid,
    sync_enabled,
    last_push_at,
    last_pull_at,
    created_at,
    updated_at
  ) VALUES (1, NULL, 0, NULL, NULL, unixepoch() * 1000, unixepoch() * 1000);
`;

const ensureEngineConfigRowSql = `
  INSERT OR IGNORE INTO sync_engine_config (
    id,
    enabled,
    node_id,
    last_hlc_logical_ms,
    last_hlc_counter,
    memory_budget_mb,
    cache_enabled,
    performance_mode,
    created_at,
    updated_at
  ) VALUES (1, 1, NULL, 0, 0, 50, 1, 'balanced', unixepoch() * 1000, unixepoch() * 1000);
`;

const tableExists = (db: DatabaseInstance, tableName: string): boolean => {
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
  const row = stmt.get(tableName) as { name: string } | undefined;
  return Boolean(row);
};

const tableHasColumn = (db: DatabaseInstance, tableName: string, columnName: string): boolean => {
  if (!tableExists(db, tableName)) {
    return false;
  }

  const stmt = db.prepare(`PRAGMA table_info(${tableName});`);
  const columns = stmt.all() as Array<{ name: string }>;
  return columns.some((col) => col.name === columnName);
};

const renameSyncConfigIfLegacy = (db: DatabaseInstance): boolean => {
  if (!tableExists(db, 'sync_config')) {
    return false;
  }

  const hasNodeId = tableHasColumn(db, 'sync_config', 'node_id');
  const hasDesktopUuid = tableHasColumn(db, 'sync_config', 'desktop_user_uuid');

  // Legacy table stores HLC settings (node_id, last_hlc_logical_ms, etc.)
  if (hasNodeId && !hasDesktopUuid) {
    logger.info('Migration 022: Renaming legacy sync_config to sync_engine_config');
    db.exec('ALTER TABLE sync_config RENAME TO sync_engine_config;');
    return true;
  }

  return false;
};

export const migration022: Migration = {
  version: 22,
  description: 'Split sync configuration into user config and engine config tables',
  up: (db: DatabaseInstance) => {
    logger.info('Migration 022: Splitting sync configuration tables');

    const renamed = renameSyncConfigIfLegacy(db);

    // Ensure engine config table exists (either renamed legacy or brand new)
    db.exec(createSyncEngineTableSql);

    if (!renamed) {
      // If we created a new engine config table, ensure a default row exists
      db.exec(ensureEngineConfigRowSql);
    }

    // Ensure user-facing sync_config table exists with expected schema
    db.exec(createUserSyncTableSql);
    db.exec(ensureUserSyncRowSql);

    logger.info('Migration 022: Sync configuration tables ready');
  },
  down: (db: DatabaseInstance) => {
    logger.info('Migration 022: Rolling back split sync configuration tables');

    if (tableExists(db, 'sync_config')) {
      db.exec('DROP TABLE IF EXISTS sync_config;');
    }

    if (tableExists(db, 'sync_engine_config')) {
      db.exec('ALTER TABLE sync_engine_config RENAME TO sync_config;');
    }
  },
};
