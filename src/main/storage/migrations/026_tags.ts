import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 026: Add tags and note_tags tables for tag management
 *
 * Creates:
 * - tags: Main tags table with name, color, sort order, and sync metadata
 * - note_tags: Junction table for many-to-many relationship between notes and tags
 *
 * The note_tags table has its own id for sync tracking as a separate entity.
 */
export const migration026: Migration = {
  version: 26,
  description: 'Add tags and note_tags tables for tag management',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 026: Creating tags tables');

    db.exec(`
      -- Tags table
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        user_profile_id TEXT NOT NULL DEFAULT '1',
        name TEXT NOT NULL,
        color TEXT,
        sort_index INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        sync_version INTEGER NOT NULL DEFAULT 1,
        sync_checksum TEXT,
        server_updated_at INTEGER,
        UNIQUE(user_profile_id, name COLLATE NOCASE)
      );

      -- Junction table for many-to-many relationship
      -- Note: Has its own id for sync tracking as separate entity
      CREATE TABLE IF NOT EXISTS note_tags (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        user_profile_id TEXT NOT NULL DEFAULT '1',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        sync_version INTEGER NOT NULL DEFAULT 1,
        sync_checksum TEXT,
        server_updated_at INTEGER,
        UNIQUE(note_id, tag_id),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      -- Performance indexes for tags
      CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_profile_id, deleted);
      CREATE INDEX IF NOT EXISTS idx_tags_sort ON tags(deleted, sort_index, name);
      CREATE INDEX IF NOT EXISTS idx_tags_sync ON tags(sync_version, server_updated_at);
      CREATE INDEX IF NOT EXISTS idx_tags_updated ON tags(updated_at);

      -- Performance indexes for note_tags
      CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id, deleted);
      CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id, deleted);
      CREATE INDEX IF NOT EXISTS idx_note_tags_sync ON note_tags(sync_version, server_updated_at);
      CREATE INDEX IF NOT EXISTS idx_note_tags_updated ON note_tags(updated_at);
    `);

    logger.info('Migration 026: Tags tables created successfully');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 026: Rolling back tags tables');

    db.exec(`
      DROP INDEX IF EXISTS idx_note_tags_updated;
      DROP INDEX IF EXISTS idx_note_tags_sync;
      DROP INDEX IF EXISTS idx_note_tags_tag;
      DROP INDEX IF EXISTS idx_note_tags_note;
      DROP INDEX IF EXISTS idx_tags_updated;
      DROP INDEX IF EXISTS idx_tags_sync;
      DROP INDEX IF EXISTS idx_tags_sort;
      DROP INDEX IF EXISTS idx_tags_user;
      DROP TABLE IF EXISTS note_tags;
      DROP TABLE IF EXISTS tags;
    `);

    logger.info('Migration 026: Tags tables rollback completed');
  },
};
