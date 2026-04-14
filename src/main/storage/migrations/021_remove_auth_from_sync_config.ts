import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 021: Remove Auth Fields from Sync Config
 *
 * Removes auth-related columns from sync_config table to achieve complete
 * auth/sync decoupling. Auth data should be managed exclusively by AuthService.
 *
 * Columns being removed:
 * - access_token
 * - refresh_token
 * - token_expires_at
 * - server_user_id
 * - server_url
 *
 * Columns being retained:
 * - id
 * - desktop_user_uuid (sync's own node identifier)
 * - sync_enabled
 * - last_push_at
 * - last_pull_at
 * - created_at
 * - updated_at
 */
export const migration021: Migration = {
  version: 21,
  description: 'Remove auth fields from sync_config table',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 021: Removing auth fields from sync_config table');

    // SQLite doesn't support DROP COLUMN, so we need to recreate the table
    db.exec(`
      -- Create new sync_config table without auth fields
      CREATE TABLE sync_config_new (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        desktop_user_uuid TEXT,
        sync_enabled INTEGER DEFAULT 0,
        last_push_at INTEGER,
        last_pull_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Copy data from old table (excluding auth fields)
      INSERT INTO sync_config_new (
        id,
        desktop_user_uuid,
        sync_enabled,
        last_push_at,
        last_pull_at,
        created_at,
        updated_at
      )
      SELECT
        id,
        desktop_user_uuid,
        sync_enabled,
        last_push_at,
        last_pull_at,
        created_at,
        updated_at
      FROM sync_config;

      -- Drop old table
      DROP TABLE sync_config;

      -- Rename new table to sync_config
      ALTER TABLE sync_config_new RENAME TO sync_config;
    `);

    logger.info('Migration 021: Auth fields removed from sync_config successfully');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 021: Rolling back - restoring auth fields to sync_config table');

    // Recreate table with auth fields (for rollback compatibility)
    db.exec(`
      -- Create sync_config table with auth fields
      CREATE TABLE sync_config_new (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        server_url TEXT,
        desktop_user_uuid TEXT,
        server_user_id TEXT,
        sync_enabled INTEGER DEFAULT 0,
        last_push_at INTEGER,
        last_pull_at INTEGER,
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Copy data from current table
      INSERT INTO sync_config_new (
        id,
        desktop_user_uuid,
        sync_enabled,
        last_push_at,
        last_pull_at,
        created_at,
        updated_at
      )
      SELECT
        id,
        desktop_user_uuid,
        sync_enabled,
        last_push_at,
        last_pull_at,
        created_at,
        updated_at
      FROM sync_config;

      -- Drop current table
      DROP TABLE sync_config;

      -- Rename new table
      ALTER TABLE sync_config_new RENAME TO sync_config;
    `);

    logger.warn('Migration 021: Rollback complete - auth fields restored (but will be empty)');
  },
};
