import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { Migration } from './MigrationRunner';

/**
 * Migration 008: Add Binder Type Column
 * Adds binder_type column to support system vs user binder distinction
 * Based on o3's recommendations for enhanced multi-device sync security
 */
export const migration008: Migration = {
  version: 8,
  description: 'Add binder_type column for system/user binder distinction',

  up: (db: DatabaseInstance) => {
    // Add binder_type column with default 'USER' for existing binders
    db.exec(`
      ALTER TABLE binders 
      ADD COLUMN binder_type TEXT NOT NULL DEFAULT 'USER'
      CHECK (binder_type IN ('USER', 'SYSTEM'));
    `);

    // Create index on binder_type for performance
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_binders_type 
      ON binders(binder_type);
    `);

    // Create composite index for efficient user binder filtering
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_binders_user_type 
      ON binders(user_profile_id, binder_type);
    `);

    console.log('Migration 008: Added binder_type column with indices');
  },

  down: (db: DatabaseInstance) => {
    // Remove indices first
    db.exec(`DROP INDEX IF EXISTS idx_binders_type;`);
    db.exec(`DROP INDEX IF EXISTS idx_binders_user_type;`);

    // Note: SQLite doesn't support DROP COLUMN directly
    // In a real rollback scenario, we would need to recreate the table
    console.log('Migration 008 rollback: Removed binder_type indices');
    console.log('WARNING: SQLite does not support DROP COLUMN. Manual table recreation required.');
  },
};
