import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 019: Add starred column to notes table
 * Allows users to favorite/star notes for quick access.
 */
export const migration019: Migration = {
  version: 19,
  description: 'Add starred column to notes table',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 019: Adding starred column to notes table');

    db.exec(`
      ALTER TABLE notes ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_notes_starred
        ON notes(starred, updated_at DESC);
    `);

    logger.info('Migration 019: Starred column added successfully');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 019: Removing starred column from notes table');

    db.exec(`
      DROP INDEX IF EXISTS idx_notes_starred;

      -- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
      CREATE TABLE notes_backup (
        id TEXT PRIMARY KEY,
        binder_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        sync_version INTEGER DEFAULT 1,
        sync_checksum TEXT,
        server_updated_at INTEGER
      );

      INSERT INTO notes_backup
        SELECT id, binder_id, title, created_at, updated_at, deleted, pinned,
               sync_version, sync_checksum, server_updated_at
        FROM notes;

      DROP TABLE notes;
      ALTER TABLE notes_backup RENAME TO notes;

      -- Recreate indexes
      CREATE INDEX idx_notes_binder ON notes(binder_id);
      CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
      CREATE INDEX idx_notes_deleted ON notes(deleted);
    `);

    logger.info('Migration 019: Starred column removed');
  },
};
