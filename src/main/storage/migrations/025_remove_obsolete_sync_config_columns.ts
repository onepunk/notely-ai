import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 025: Remove obsolete columns from sync_config table
 *
 * This migration removes:
 * - sync_enabled: Now stored in settings table as 'syncEnabled' (single source of truth)
 * - desktop_user_uuid: Deprecated, device ID is now stored in settings as 'sync.device_id'
 *
 * The sync_config table now only retains:
 * - id, last_push_at, last_pull_at, created_at, updated_at
 *
 * SQLite doesn't support DROP COLUMN directly, so we need to:
 * 1. Create a new table with the desired schema
 * 2. Copy data from the old table
 * 3. Drop the old table
 * 4. Rename the new table
 */

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

export const migration025: Migration = {
  version: 25,
  description: 'Remove obsolete sync_enabled and desktop_user_uuid columns from sync_config',
  up: (db: DatabaseInstance) => {
    logger.info('Migration 025: Removing obsolete columns from sync_config');

    // Check if sync_config table exists
    if (!tableExists(db, 'sync_config')) {
      logger.info('Migration 025: sync_config table does not exist, skipping');
      return;
    }

    // Check if the columns we want to remove actually exist
    const hasSyncEnabled = tableHasColumn(db, 'sync_config', 'sync_enabled');
    const hasDesktopUserUuid = tableHasColumn(db, 'sync_config', 'desktop_user_uuid');

    if (!hasSyncEnabled && !hasDesktopUserUuid) {
      logger.info('Migration 025: Obsolete columns already removed, skipping');
      return;
    }

    // Before removing sync_enabled, migrate its value to settings table if set
    if (hasSyncEnabled) {
      try {
        const syncConfig = db.prepare('SELECT sync_enabled FROM sync_config WHERE id = 1').get() as
          | { sync_enabled: number }
          | undefined;

        if (syncConfig?.sync_enabled === 1) {
          // Check if settings.syncEnabled exists and is not already set
          const existingSetting = db
            .prepare("SELECT value FROM settings WHERE key = 'syncEnabled'")
            .get() as { value: string } | undefined;

          if (!existingSetting || existingSetting.value !== 'true') {
            // Migrate the value to settings
            db.prepare(
              "INSERT OR REPLACE INTO settings (key, value) VALUES ('syncEnabled', 'true')"
            ).run();
            logger.info('Migration 025: Migrated sync_enabled=1 to settings.syncEnabled=true');
          }
        }
      } catch (error) {
        logger.warn('Migration 025: Failed to migrate sync_enabled value', { error });
        // Non-fatal - continue with column removal
      }
    }

    // SQLite doesn't support DROP COLUMN, so we need to recreate the table
    db.exec(`
      -- Create new table with clean schema (no obsolete columns)
      CREATE TABLE IF NOT EXISTS sync_config_new (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_push_at INTEGER,
        last_pull_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Copy data from old table (only the columns we're keeping)
      INSERT OR REPLACE INTO sync_config_new (id, last_push_at, last_pull_at, created_at, updated_at)
      SELECT id, last_push_at, last_pull_at, created_at, updated_at
      FROM sync_config
      WHERE id = 1;

      -- Drop old table
      DROP TABLE sync_config;

      -- Rename new table to original name
      ALTER TABLE sync_config_new RENAME TO sync_config;
    `);

    // Also remove the obsolete sync.auto_sync_enabled setting if it exists
    try {
      db.prepare("DELETE FROM settings WHERE key = 'sync.auto_sync_enabled'").run();
      logger.info('Migration 025: Removed obsolete sync.auto_sync_enabled setting');
    } catch (error) {
      logger.debug('Migration 025: sync.auto_sync_enabled not found or already removed');
    }

    logger.info('Migration 025: Successfully removed obsolete columns from sync_config');
  },
  down: (db: DatabaseInstance) => {
    logger.info('Migration 025: Rolling back - re-adding obsolete columns to sync_config');

    // SQLite doesn't support ADD COLUMN with constraints easily, so recreate table
    db.exec(`
      -- Create table with original schema
      CREATE TABLE IF NOT EXISTS sync_config_old (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        desktop_user_uuid TEXT,
        sync_enabled INTEGER DEFAULT 0,
        last_push_at INTEGER,
        last_pull_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Copy data from current table
      INSERT OR REPLACE INTO sync_config_old (id, desktop_user_uuid, sync_enabled, last_push_at, last_pull_at, created_at, updated_at)
      SELECT id, NULL, 0, last_push_at, last_pull_at, created_at, updated_at
      FROM sync_config
      WHERE id = 1;

      -- Drop current table
      DROP TABLE sync_config;

      -- Rename to original name
      ALTER TABLE sync_config_old RENAME TO sync_config;
    `);

    // Re-add the obsolete seed setting
    db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES ('sync.auto_sync_enabled', 'false')"
    ).run();

    logger.info('Migration 025: Rollback complete');
  },
};
