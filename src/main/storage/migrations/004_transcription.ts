import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 004: Transcription Sessions
 * Creates transcription sessions table and FTS (with FTS5 availability guard)
 */
export const migration004: Migration = {
  version: 4,
  description: 'Create transcription sessions and FTS tables',

  up: (db: DatabaseInstance) => {
    // Create transcription_sessions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS transcription_sessions (
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
        full_text_cipher BLOB NOT NULL,
        full_text_nonce BLOB NOT NULL,
        full_text_tag BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_trans_sessions_note ON transcription_sessions(note_id);
      CREATE INDEX IF NOT EXISTS idx_trans_sessions_binder ON transcription_sessions(binder_id);
      CREATE INDEX IF NOT EXISTS idx_trans_sessions_status ON transcription_sessions(status);
    `);

    // Create FTS table with availability guard
    try {
      db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS transcriptions_fts USING fts5(session_id UNINDEXED, content);`
      );
    } catch (e) {
      // FTS5 may be unavailable in the runtime SQLite build; continue without it
      logger.warn(
        'transcriptions_fts creation failed (fts5 unavailable). Search union will skip transcriptions. %s',
        e instanceof Error ? e.message : String(e)
      );
    }
  },

  down: (db: DatabaseInstance) => {
    // Drop FTS table first
    try {
      db.exec('DROP TABLE IF EXISTS transcriptions_fts;');
    } catch (e) {
      // Ignore errors if FTS table doesn't exist
    }

    // Drop indices
    db.exec(`
      DROP INDEX IF EXISTS idx_trans_sessions_status;
      DROP INDEX IF EXISTS idx_trans_sessions_binder;
      DROP INDEX IF EXISTS idx_trans_sessions_note;
    `);

    // Drop transcription_sessions table
    db.exec('DROP TABLE IF EXISTS transcription_sessions;');
  },
};
