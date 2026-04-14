import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { Migration } from './MigrationRunner';

/**
 * Migration 013: Add deleted column to transcription_sessions
 * Adds soft delete support to transcription_sessions table for consistency with binders and notes
 */
export const migration013: Migration = {
  version: 13,
  description: 'Add deleted column to transcription_sessions table',

  up: (db: DatabaseInstance) => {
    // Add deleted column with default value FALSE
    db.exec(`
      ALTER TABLE transcription_sessions 
      ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
    `);

    // Add index for deleted column for efficient queries
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transcription_sessions_deleted 
      ON transcription_sessions(deleted);
    `);

    // Add composite index for deleted + other common query patterns
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transcription_sessions_deleted_note 
      ON transcription_sessions(deleted, note_id);
    `);
  },

  down: (db: DatabaseInstance) => {
    // Drop the indexes first
    db.exec(`
      DROP INDEX IF EXISTS idx_transcription_sessions_deleted_note;
      DROP INDEX IF EXISTS idx_transcription_sessions_deleted;
    `);

    // SQLite doesn't support DROP COLUMN, so we'd need to recreate the table
    // For safety, we'll leave the column in place during rollback
    // A more complete rollback would involve:
    // 1. CREATE TABLE temp_table with original schema
    // 2. INSERT INTO temp_table SELECT (original columns) FROM transcription_sessions
    // 3. DROP TABLE transcription_sessions
    // 4. ALTER TABLE temp_table RENAME TO transcription_sessions
  },
};
