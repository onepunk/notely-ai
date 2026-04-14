import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 023: Add transcription_segments table
 *
 * Creates a new table to store individual transcription segments with timestamps.
 * This enables:
 * - Precise timestamp tracking for each word/phrase
 * - User edit tracking at the segment level
 * - Jumping to exact timestamps in audio playback
 * - Segment-level refinements with history
 */

const createTableSql = `
  CREATE TABLE IF NOT EXISTS transcription_segments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    text TEXT NOT NULL,
    start_time_seconds REAL NOT NULL,
    end_time_seconds REAL NOT NULL,
    sequence_order INTEGER NOT NULL,
    user_edited INTEGER NOT NULL DEFAULT 0,
    original_text TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    -- Sync metadata (required for sync consistency)
    sync_version INTEGER NOT NULL DEFAULT 1,
    sync_checksum TEXT,
    server_updated_at INTEGER,
    -- Ensure segment_id is unique per session
    UNIQUE(session_id, segment_id),
    FOREIGN KEY (session_id) REFERENCES transcription_sessions(id) ON DELETE CASCADE
  );
`;

const createIndexesSql = `
  CREATE INDEX IF NOT EXISTS idx_transcription_segments_session
    ON transcription_segments(session_id);
  CREATE INDEX IF NOT EXISTS idx_transcription_segments_sequence
    ON transcription_segments(session_id, sequence_order);
  CREATE INDEX IF NOT EXISTS idx_transcription_segments_time
    ON transcription_segments(start_time_seconds, end_time_seconds);
  CREATE INDEX IF NOT EXISTS idx_transcription_segments_sync_version
    ON transcription_segments(sync_version, server_updated_at);
  CREATE INDEX IF NOT EXISTS idx_transcription_segments_deleted
    ON transcription_segments(deleted) WHERE deleted = 0;
`;

export const migration023: Migration = {
  version: 23,
  description: 'Add transcription_segments table for storing segment timestamps and user edits',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 023: Creating transcription_segments table');

    // Create the segments table
    db.exec(createTableSql);
    logger.info('Migration 023: transcription_segments table created');

    // Create indexes for efficient querying
    db.exec(createIndexesSql);
    logger.info('Migration 023: Indexes created for transcription_segments');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 023: Rolling back transcription_segments table');

    // Drop indexes first (they are automatically dropped with the table, but explicit is better)
    db.exec(`
      DROP INDEX IF EXISTS idx_transcription_segments_session;
      DROP INDEX IF EXISTS idx_transcription_segments_sequence;
      DROP INDEX IF EXISTS idx_transcription_segments_time;
      DROP INDEX IF EXISTS idx_transcription_segments_sync_version;
      DROP INDEX IF EXISTS idx_transcription_segments_deleted;
    `);

    // Drop the table
    db.exec('DROP TABLE IF EXISTS transcription_segments;');

    logger.info('Migration 023: transcription_segments table dropped');
  },
};
