/**
 * Migration 012: Add 'sync' operation to sync_log table constraint
 *
 * Fixes database constraint error where 'sync' operation was missing from
 * the CHECK constraint despite being a valid SyncOperation in TypeScript.
 *
 * This migration recreates the sync_log table with the updated constraint
 * to include 'sync' as a valid operation value.
 */

import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

export const migration012 = {
  version: 12,
  description: "Add 'sync' operation to sync_log table constraint",

  up: (db: DatabaseInstance) => {
    db.exec(`
      -- Create new sync_log table with updated constraint
      CREATE TABLE sync_log_new (
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

      -- Copy existing data
      INSERT INTO sync_log_new 
        (id, operation, status, entity_type, entity_count, error_message, started_at, completed_at, session_id)
      SELECT id, operation, status, entity_type, entity_count, error_message, started_at, completed_at, session_id
      FROM sync_log;

      -- Drop old table and rename new one
      DROP TABLE sync_log;
      ALTER TABLE sync_log_new RENAME TO sync_log;

      -- Recreate index
      CREATE INDEX IF NOT EXISTS idx_sync_log_operation ON sync_log(operation, started_at DESC);
    `);
  },

  down: (db: DatabaseInstance) => {
    db.exec(`
      -- Revert back to original constraint (removing 'sync')
      CREATE TABLE sync_log_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL CHECK (operation IN ('push','pull','link','restore')),
        status TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
        entity_type TEXT,
        entity_count INTEGER DEFAULT 0,
        error_message TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        session_id TEXT
      );

      -- Copy data back (excluding any 'sync' operations that would violate constraint)
      INSERT INTO sync_log_old 
        (id, operation, status, entity_type, entity_count, error_message, started_at, completed_at, session_id)
      SELECT id, operation, status, entity_type, entity_count, error_message, started_at, completed_at, session_id
      FROM sync_log
      WHERE operation IN ('push','pull','link','restore');

      -- Drop new table and rename old one back
      DROP TABLE sync_log;
      ALTER TABLE sync_log_old RENAME TO sync_log;

      -- Recreate index
      CREATE INDEX IF NOT EXISTS idx_sync_log_operation ON sync_log(operation, started_at DESC);
    `);
  },
};
