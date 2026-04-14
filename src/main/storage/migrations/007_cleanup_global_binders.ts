import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 007: Cleanup global binders
 * Remove legacy global binders (user_profile_id IS NULL) only when safe:
 *  - No notes reference them
 */
export const migration007: Migration = {
  version: 7,
  description: 'Remove legacy global binders with no referenced notes',

  up: (db: DatabaseInstance) => {
    try {
      const result = db
        .prepare(
          `
        DELETE FROM binders
        WHERE user_profile_id IS NULL
          AND id NOT IN (SELECT DISTINCT binder_id FROM notes)
      `
        )
        .run();
      if (result.changes > 0) {
        logger.info('Migration 007: Removed %d legacy global binders', result.changes);
      }
    } catch (e) {
      logger.warn('Migration 007: Cleanup failed: %s', e instanceof Error ? e.message : String(e));
    }
  },

  down: () => {
    // No-op: cannot restore removed rows
  },
};
