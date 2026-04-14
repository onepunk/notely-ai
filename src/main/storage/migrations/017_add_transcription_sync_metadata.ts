import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { Migration } from './MigrationRunner';

/**
 * Migration 017: Add sync metadata columns to transcription_sessions
 * Aligns transcription_sessions with other syncable tables by adding
 * sync_version, sync_checksum, and server_updated_at columns.
 */
export const migration017: Migration = {
  version: 17,
  description: 'Add sync metadata columns to transcription_sessions',

  up: (db: DatabaseInstance) => {
    db.exec(`
      ALTER TABLE transcription_sessions
      ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 1;
    `);

    db.exec(`
      ALTER TABLE transcription_sessions
      ADD COLUMN sync_checksum TEXT;
    `);

    db.exec(`
      ALTER TABLE transcription_sessions
      ADD COLUMN server_updated_at INTEGER;
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transcription_sessions_server_updated
      ON transcription_sessions(server_updated_at);
    `);
  },

  down: (db: DatabaseInstance) => {
    db.exec(`
      DROP INDEX IF EXISTS idx_transcription_sessions_server_updated;
    `);
    // SQLite cannot drop columns without table recreation; leave columns in place on rollback.
  },
};
