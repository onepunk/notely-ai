import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 005: Sync Metadata
 * Adds sync metadata to existing tables and creates sync configuration tables
 */
export const migration005: Migration = {
  version: 5,
  description: 'Add sync metadata and create sync configuration tables',

  up: (db: DatabaseInstance) => {
    // Add sync metadata to existing tables
    db.exec(`
      -- Add sync metadata to binders
      ALTER TABLE binders ADD COLUMN sync_version INTEGER DEFAULT 1;
      ALTER TABLE binders ADD COLUMN sync_checksum TEXT;
      ALTER TABLE binders ADD COLUMN server_updated_at INTEGER;

      -- Add sync metadata to notes
      ALTER TABLE notes ADD COLUMN sync_version INTEGER DEFAULT 1;
      ALTER TABLE notes ADD COLUMN sync_checksum TEXT;
      ALTER TABLE notes ADD COLUMN server_updated_at INTEGER;

      -- Add sync metadata to note_revisions
      ALTER TABLE note_revisions ADD COLUMN sync_version INTEGER DEFAULT 1;
      ALTER TABLE note_revisions ADD COLUMN server_updated_at INTEGER;

      -- Add sync metadata to transcription_sessions
      ALTER TABLE transcription_sessions ADD COLUMN sync_version INTEGER DEFAULT 1;
      ALTER TABLE transcription_sessions ADD COLUMN sync_checksum TEXT;
      ALTER TABLE transcription_sessions ADD COLUMN server_updated_at INTEGER;

      -- Create sync configuration table
      CREATE TABLE IF NOT EXISTS sync_config (
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

      -- Create sync log table for tracking sync operations
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL CHECK (operation IN ('push','pull','link','restore','sync')),
        status TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
        entity_type TEXT,
        entity_count INTEGER DEFAULT 0,
        error_message TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        session_id TEXT
      );

      -- Create indexes for sync performance
      CREATE INDEX IF NOT EXISTS idx_binders_sync_version ON binders(sync_version, server_updated_at);
      CREATE INDEX IF NOT EXISTS idx_notes_sync_version ON notes(sync_version, server_updated_at);
      CREATE INDEX IF NOT EXISTS idx_revisions_sync_version ON note_revisions(sync_version, server_updated_at);
      CREATE INDEX IF NOT EXISTS idx_transcriptions_sync_version ON transcription_sessions(sync_version, server_updated_at);
      CREATE INDEX IF NOT EXISTS idx_sync_log_operation ON sync_log(operation, started_at DESC);
    `);

    // Initialize default sync config row
    const now = Date.now();

    // Import DEFAULT_API_URL from config
    // Note: This will be resolved through proper dependency injection in the service layer
    const defaultApiUrl = 'https://api.yourdomain.com'; // DEFAULT_API_URL placeholder (dev)

    db.prepare(
      `
      INSERT OR IGNORE INTO sync_config (
        id, server_url, sync_enabled, created_at, updated_at
      ) VALUES (1, ?, 0, ?, ?)
    `
    ).run(defaultApiUrl, now, now);

    // Note: Default sync settings are seeded by seeds/defaultSettings.ts
  },

  down: (db: DatabaseInstance) => {
    // Drop sync tables
    db.exec(`
      DROP TABLE IF EXISTS sync_log;
      DROP TABLE IF EXISTS sync_config;
    `);

    // Drop sync indices
    db.exec(`
      DROP INDEX IF EXISTS idx_sync_log_operation;
      DROP INDEX IF EXISTS idx_transcriptions_sync_version;
      DROP INDEX IF EXISTS idx_revisions_sync_version;
      DROP INDEX IF EXISTS idx_notes_sync_version;
      DROP INDEX IF EXISTS idx_binders_sync_version;
    `);

    // Remove sync columns (SQLite doesn't support DROP COLUMN directly)
    // This would require recreating tables, so we'll leave the columns
    // In a real rollback scenario, you might want to recreate tables without sync columns
    logger.warn('Sync metadata columns remain in tables (SQLite DROP COLUMN limitation)');
  },
};
