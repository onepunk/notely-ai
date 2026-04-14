import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 006: Encryption Version
 * Adds encryption_version to transcription_sessions to support versioned decryption.
 */
export const migration006: Migration = {
  version: 6,
  description: 'Add encryption_version to transcription_sessions',

  up: (db: DatabaseInstance) => {
    try {
      db.exec(`
        ALTER TABLE transcription_sessions 
        ADD COLUMN encryption_version INTEGER NOT NULL DEFAULT 1;
      `);
    } catch (e) {
      // Column may already exist if migration reapplied
      logger.warn(
        'Migration 006: encryption_version add failed or exists: %s',
        e instanceof Error ? e.message : String(e)
      );
    }
  },

  down: () => {
    // SQLite cannot DROP COLUMN; document limitation.
    logger.warn('Migration 006 down: cannot remove encryption_version column (SQLite limitation).');
  },
};
