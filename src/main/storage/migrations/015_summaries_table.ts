import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 015: AI Summaries
 * Creates summaries table for AI-generated transcript summaries with encryption support
 */
export const migration015: Migration = {
  version: 15,
  description: 'Create summaries table for AI-generated transcript summaries',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 015: Creating summaries table');

    // Create summaries table
    db.exec(`
      CREATE TABLE IF NOT EXISTS summaries (
        id TEXT PRIMARY KEY,
        transcription_id TEXT NOT NULL,
        summary_text TEXT,
        summary_text_encrypted TEXT,
        is_summary_encrypted INTEGER NOT NULL DEFAULT 0,
        summary_type TEXT NOT NULL DEFAULT 'full',
        processing_time_ms INTEGER,
        model_used TEXT,
        backend_type TEXT,
        pipeline_used INTEGER NOT NULL DEFAULT 0,
        sync_version INTEGER NOT NULL DEFAULT 1,
        checksum TEXT,
        deleted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        server_updated_at INTEGER,
        FOREIGN KEY (transcription_id) REFERENCES transcription_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_summaries_transcription ON summaries(transcription_id);
      CREATE INDEX IF NOT EXISTS idx_summaries_type ON summaries(summary_type);
      CREATE INDEX IF NOT EXISTS idx_summaries_created ON summaries(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_summaries_sync_version ON summaries(sync_version);
      CREATE INDEX IF NOT EXISTS idx_summaries_deleted ON summaries(deleted) WHERE deleted = 0;
    `);

    logger.info('Migration 015: Summaries table created successfully');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 015: Rolling back summaries table');

    // Drop indices first
    db.exec(`
      DROP INDEX IF EXISTS idx_summaries_deleted;
      DROP INDEX IF EXISTS idx_summaries_sync_version;
      DROP INDEX IF EXISTS idx_summaries_created;
      DROP INDEX IF EXISTS idx_summaries_type;
      DROP INDEX IF EXISTS idx_summaries_transcription;
    `);

    // Drop summaries table
    db.exec('DROP TABLE IF EXISTS summaries;');

    logger.info('Migration 015: Summaries table rollback completed');
  },
};
