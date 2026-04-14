import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 029: Cursor-Based Sync Schema
 *
 * Implements Phase 3 of the SYNC_JOPLIN implementation plan.
 * This migration adds the client-side schema required for cursor-based sync
 * with the sync_items queue approach.
 *
 * Changes:
 * 1. Creates sync_items table for per-entity sync queue (replaces Merkle approach)
 * 2. Adds cursor column to sync_config for delta pull tracking
 * 3. Adds conflict metadata fields to notes table
 * 4. Adds original_text and user_edited to transcription_sessions
 * 5. Creates audio_recordings local-only metadata table
 * 6. Adds is_conflicts marker to binders table
 *
 * References:
 * - SYNC_JOPLIN.md#L204 (Client data model)
 * - SYNC_JOPLIN.md#L224 (Sync queue semantics)
 * - SYNC_JOPLIN.md#L243 (Local cursor storage)
 * - SYNC_JOPLIN.md#L214 (Conflict metadata)
 * - SYNC_JOPLIN.md#L69 (Transcriptions)
 * - SYNC_JOPLIN.md#L249 (Audio local-only)
 */
export const migration029: Migration = {
  version: 29,
  description: 'Add cursor-based sync schema (sync_items, cursor, conflict fields)',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 029: Creating cursor-based sync schema...');

    // 1. Create sync_items table (per-entity sync queue)
    // Reference: SYNC_JOPLIN.md#L224
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_items (
        entity_type TEXT NOT NULL CHECK (entity_type IN ('binders', 'notes', 'transcriptions', 'summaries', 'tags', 'note_tags')),
        entity_id TEXT NOT NULL,
        sync_time INTEGER NOT NULL DEFAULT 0,
        pending_mutation_id TEXT,
        sync_disabled INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );

      -- Index for finding items that need to be pushed (sync_time = 0)
      CREATE INDEX IF NOT EXISTS idx_sync_items_pending
        ON sync_items(sync_time) WHERE sync_time = 0;

      -- Index for finding items by entity type
      CREATE INDEX IF NOT EXISTS idx_sync_items_type
        ON sync_items(entity_type, sync_time);

      -- Index for cleanup of old successful syncs
      CREATE INDEX IF NOT EXISTS idx_sync_items_updated
        ON sync_items(updated_at);
    `);
    logger.info('Migration 029: sync_items table created');

    // 2. Add cursor column to sync_config
    // Reference: SYNC_JOPLIN.md#L243
    db.exec(`
      ALTER TABLE sync_config ADD COLUMN cursor INTEGER NOT NULL DEFAULT 0;
    `);
    logger.info('Migration 029: cursor column added to sync_config');

    // 3. Add conflict metadata fields to notes table
    // Reference: SYNC_JOPLIN.md#L214, SYNC_JOPLIN_PHASE0_SPEC.md Section 5
    db.exec(`
      ALTER TABLE notes ADD COLUMN is_conflict INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE notes ADD COLUMN conflict_of_id TEXT;
      ALTER TABLE notes ADD COLUMN conflict_created_at INTEGER;

      -- Index for finding conflict copies
      CREATE INDEX IF NOT EXISTS idx_notes_conflicts
        ON notes(is_conflict) WHERE is_conflict = 1;

      -- Index for finding conflicts of a specific note
      CREATE INDEX IF NOT EXISTS idx_notes_conflict_of
        ON notes(conflict_of_id) WHERE conflict_of_id IS NOT NULL;
    `);
    logger.info('Migration 029: conflict fields added to notes');

    // 4. Add original_text and user_edited to transcription_sessions
    // Reference: SYNC_JOPLIN.md#L69
    // Preserves immutable original while allowing edits to full_text
    db.exec(`
      ALTER TABLE transcription_sessions ADD COLUMN original_text TEXT;
      ALTER TABLE transcription_sessions ADD COLUMN user_edited INTEGER NOT NULL DEFAULT 0;

      -- Index for finding edited transcriptions
      CREATE INDEX IF NOT EXISTS idx_transcription_sessions_edited
        ON transcription_sessions(user_edited) WHERE user_edited = 1;
    `);
    logger.info('Migration 029: original_text and user_edited added to transcription_sessions');

    // 5. Create audio_recordings local-only metadata table
    // Reference: SYNC_JOPLIN.md#L249
    // This table is NOT synced - audio files remain device-local
    db.exec(`
      CREATE TABLE IF NOT EXISTS audio_recordings (
        id TEXT PRIMARY KEY,
        transcription_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size_bytes INTEGER,
        duration_ms INTEGER,
        mime_type TEXT DEFAULT 'audio/webm',
        created_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (transcription_id) REFERENCES transcription_sessions(id) ON DELETE CASCADE
      );

      -- Index for finding recordings by transcription
      CREATE INDEX IF NOT EXISTS idx_audio_recordings_transcription
        ON audio_recordings(transcription_id);

      -- Index for cleanup of deleted recordings
      CREATE INDEX IF NOT EXISTS idx_audio_recordings_deleted
        ON audio_recordings(deleted) WHERE deleted = 0;
    `);
    logger.info('Migration 029: audio_recordings table created');

    // 6. Add is_conflicts marker to binders table
    // Reference: SYNC_JOPLIN.md#L145, SYNC_JOPLIN_PHASE0_SPEC.md Section 6
    db.exec(`
      ALTER TABLE binders ADD COLUMN is_conflicts INTEGER NOT NULL DEFAULT 0;

      -- Unique partial index: only one conflicts binder per user
      CREATE UNIQUE INDEX IF NOT EXISTS idx_binders_conflicts_unique
        ON binders(user_profile_id) WHERE is_conflicts = 1 AND deleted = 0;
    `);
    logger.info('Migration 029: is_conflicts marker added to binders');

    logger.info('Migration 029: Cursor-based sync schema created successfully');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 029: Rolling back cursor-based sync schema...');

    // Drop indexes
    db.exec(`
      DROP INDEX IF EXISTS idx_binders_conflicts_unique;
      DROP INDEX IF EXISTS idx_audio_recordings_deleted;
      DROP INDEX IF EXISTS idx_audio_recordings_transcription;
      DROP INDEX IF EXISTS idx_transcription_sessions_edited;
      DROP INDEX IF EXISTS idx_notes_conflict_of;
      DROP INDEX IF EXISTS idx_notes_conflicts;
      DROP INDEX IF EXISTS idx_sync_items_updated;
      DROP INDEX IF EXISTS idx_sync_items_type;
      DROP INDEX IF EXISTS idx_sync_items_pending;
    `);

    // Drop tables
    db.exec(`
      DROP TABLE IF EXISTS audio_recordings;
      DROP TABLE IF EXISTS sync_items;
    `);

    // Note: SQLite doesn't support DROP COLUMN directly
    // The added columns (cursor, is_conflict, conflict_of_id, conflict_created_at,
    // original_text, user_edited, is_conflicts) will remain in the tables
    // In a production rollback, you would need to recreate the tables
    logger.warn(
      'Migration 029 rollback: Added columns remain in tables (SQLite DROP COLUMN limitation). ' +
        'Tables sync_items and audio_recordings dropped.'
    );
  },
};
