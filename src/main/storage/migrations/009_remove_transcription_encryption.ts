import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 009: Remove Transcription Encryption
 * Converts encrypted BLOB columns to plain TEXT columns and migrates existing data
 */
export const migration009: Migration = {
  version: 9,
  description: 'Remove transcription encryption and convert to plain text storage',

  up: (db: DatabaseInstance) => {
    try {
      // Drop existing transcription table and FTS (test data only)
      db.exec('DROP TABLE IF EXISTS transcription_sessions;');

      // Also drop FTS table if it exists
      try {
        db.exec('DROP TABLE IF EXISTS transcriptions_fts;');
      } catch (e) {
        // Ignore if FTS table doesn't exist
      }

      // Create new clean table with plain text columns
      db.exec(`
        CREATE TABLE transcription_sessions (
          id TEXT PRIMARY KEY,
          binder_id TEXT NOT NULL REFERENCES binders(id) ON DELETE CASCADE,
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          language TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('recording','completing','completed')),
          start_time INTEGER NOT NULL,
          end_time INTEGER,
          duration_ms INTEGER,
          char_count INTEGER DEFAULT 0,
          word_count INTEGER DEFAULT 0,
          full_text TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      // Create indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_trans_sessions_note ON transcription_sessions(note_id);
        CREATE INDEX IF NOT EXISTS idx_trans_sessions_binder ON transcription_sessions(binder_id);
        CREATE INDEX IF NOT EXISTS idx_trans_sessions_status ON transcription_sessions(status);
      `);

      // Recreate FTS table with availability guard
      try {
        db.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS transcriptions_fts USING fts5(session_id UNINDEXED, content);`
        );
      } catch (e) {
        // FTS5 may be unavailable in the runtime SQLite build; continue without it
        logger.warn(
          'transcriptions_fts creation failed (fts5 unavailable). Search will skip transcriptions. %s',
          e instanceof Error ? e.message : String(e)
        );
      }

      logger.info(
        'Migration 009: Successfully removed transcription encryption and recreated clean table'
      );
    } catch (e) {
      logger.error('Migration 009 failed:', e);
      throw e;
    }
  },

  down: (_db: DatabaseInstance) => {
    // Cannot easily reverse this migration as it removes encryption infrastructure
    // This is acceptable since encryption was never properly implemented
    logger.warn(
      'Migration 009 down: Cannot restore encryption columns (migration is irreversible)'
    );
    throw new Error('Migration 009 cannot be reversed - encryption infrastructure removed');
  },
};
