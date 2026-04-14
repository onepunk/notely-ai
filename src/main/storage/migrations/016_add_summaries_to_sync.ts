/**
 * Migration 016: Add summaries support to sync v2 system
 *
 * Adds summaries_hash column to local_merkle_state table
 * and updates entity_type constraints to include summaries
 *
 * NOTE: This migration modifies local_merkle_state which is dropped in migration 030.
 * It's kept for backwards compatibility with existing databases that haven't
 * run migration 030 yet.
 */

import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

export const migration016: Migration = {
  version: 16,
  description: 'Add summaries support to sync v2 system',

  up(db: DatabaseInstance) {
    // Check if table exists first (it will be dropped in migration 030)
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='local_merkle_state'")
      .get();

    if (!tableExists) {
      logger.info('Migration 016: local_merkle_state table does not exist, skipping');
      return;
    }

    // Check if column already exists
    const columns = db.prepare('PRAGMA table_info(local_merkle_state)').all() as Array<{
      name: string;
    }>;
    const columnNames = columns.map((c) => c.name);

    if (columnNames.includes('summaries_hash')) {
      logger.info('Migration 016: summaries_hash column already exists, skipping');
      return;
    }

    // Add summaries_hash column to local_merkle_state table
    db.exec(`
      ALTER TABLE local_merkle_state
      ADD COLUMN summaries_hash TEXT NULL;
    `);

    // Update existing rows to have empty string hash for summaries
    db.exec(`
      UPDATE local_merkle_state
      SET summaries_hash = ''
      WHERE summaries_hash IS NULL;
    `);

    logger.info('Migration 016: Added summaries support to sync v2 system');
  },

  down(db: DatabaseInstance) {
    // Check if table exists
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='local_merkle_state'")
      .get();

    if (!tableExists) {
      logger.info('Migration 016: local_merkle_state table does not exist, skipping rollback');
      return;
    }

    // Remove summaries_hash column from local_merkle_state table
    // Note: SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
    db.exec(`
      -- Create temporary table without summaries_hash
      CREATE TABLE local_merkle_state_backup (
        user_id TEXT PRIMARY KEY,
        root_hash TEXT,
        binders_hash TEXT,
        notes_hash TEXT,
        transcriptions_hash TEXT,
        logical_timestamp INTEGER NOT NULL DEFAULT 0,
        last_server_sync INTEGER,
        dirty INTEGER NOT NULL DEFAULT 1,
        version_number INTEGER NOT NULL DEFAULT 1,
        last_updated INTEGER NOT NULL DEFAULT 0,
        node_id TEXT
      );

      -- Copy data (excluding summaries_hash)
      INSERT INTO local_merkle_state_backup
      SELECT
        user_id, root_hash, binders_hash, notes_hash, transcriptions_hash,
        logical_timestamp, last_server_sync, dirty, version_number, last_updated, node_id
      FROM local_merkle_state;

      -- Drop original table and rename backup
      DROP TABLE local_merkle_state;
      ALTER TABLE local_merkle_state_backup RENAME TO local_merkle_state;
    `);

    logger.info('Migration 016: Removed summaries support from sync v2 system');
  },
};
