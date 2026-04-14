import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 020: Add archived column to notes table
 * Allows users to archive notes for later reference without deletion.
 */
export const migration020: Migration = {
  version: 20,
  description: 'Add archived column to notes table',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 020: Adding archived column to notes table');

    db.exec(`
      ALTER TABLE notes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_notes_archived
        ON notes(archived, updated_at DESC);
    `);

    logger.info('Migration 020: Archived column added successfully');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 020: Removing archived column from notes table');

    db.exec(`
      DROP INDEX IF EXISTS idx_notes_archived;

      -- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
      CREATE TABLE notes_backup (
        id TEXT PRIMARY KEY,
        binder_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        starred INTEGER NOT NULL DEFAULT 0,
        sync_version INTEGER DEFAULT 1,
        sync_checksum TEXT,
        server_updated_at INTEGER
      );

      INSERT INTO notes_backup
        SELECT id, binder_id, title, created_at, updated_at, deleted, pinned, starred,
               sync_version, sync_checksum, server_updated_at
        FROM notes;

      DROP TABLE notes;
      ALTER TABLE notes_backup RENAME TO notes;

      -- Recreate indexes
      CREATE INDEX idx_notes_binder ON notes(binder_id);
      CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
      CREATE INDEX idx_notes_deleted ON notes(deleted);
      CREATE INDEX idx_notes_starred ON notes(starred, updated_at DESC);
    `);

    logger.info('Migration 020: Archived column removed');
  },
};
