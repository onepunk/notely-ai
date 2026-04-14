import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 010: Clean up legacy binders for existing installations
 *
 * This migration addresses the core issue that caused "General" and "Private"
 * binders to appear on Windows installations:
 *
 * 1. Migration 007 was supposed to delete global binders (user_profile_id IS NULL)
 *    but only if they had no notes
 * 2. Migration 008 added binder_type column with default 'USER'
 * 3. On Windows: notes existed in global binders → 007 preserved them → 008 marked as USER
 * 4. This made legacy global binders visible as user binders
 *
 * This migration specifically targets and removes these problematic legacy binders
 * that should never have been preserved.
 */
export const migration010: Migration = {
  version: 10,
  description: 'Clean up legacy global binders that were misclassified as user binders',

  up: (db: DatabaseInstance) => {
    try {
      logger.info('Migration 010: Cleaning up legacy global binders...');

      // First, let's see what we're dealing with
      interface LegacyBinder {
        id: string;
        name: string;
        user_profile_id: string | null;
        binder_type: string;
      }
      const legacyBinders = db
        .prepare(
          `SELECT id, name, user_profile_id, binder_type
           FROM binders
           WHERE user_profile_id IS NULL
           AND binder_type = 'USER'
           AND name IN ('General', 'Private', 'Meetings', 'Notes')`
        )
        .all() as LegacyBinder[];

      if (legacyBinders.length === 0) {
        logger.info('Migration 010: No legacy binders found to clean up');
        return;
      }

      logger.info(
        'Migration 010: Found %d legacy binders to clean up: %s',
        legacyBinders.length,
        legacyBinders.map((b: { name: string }) => b.name).join(', ')
      );

      // Check if any of these binders still have notes
      const bindersWithNotes = [];
      for (const binder of legacyBinders) {
        const noteCount = db
          .prepare('SELECT COUNT(*) as count FROM notes WHERE binder_id = ? AND deleted = 0')
          .get(binder.id) as { count: number };

        if (noteCount.count > 0) {
          bindersWithNotes.push({ ...binder, noteCount: noteCount.count });
        }
      }

      if (bindersWithNotes.length > 0) {
        logger.warn(
          'Migration 010: Found %d legacy binders with notes, will not delete: %s',
          bindersWithNotes.length,
          bindersWithNotes
            .map((b: { name: string; noteCount: number }) => `${b.name}(${b.noteCount} notes)`)
            .join(', ')
        );

        // For binders with notes, we need to decide what to do:
        // Option 1: Assign them to the default user (recommended)
        // Option 2: Leave them as-is but log warning

        // Let's assign them to the default user (user_profile_id = 1)
        for (const binder of bindersWithNotes) {
          logger.info('Migration 010: Reassigning binder "%s" to default user', binder.name);
          db.prepare('UPDATE binders SET user_profile_id = 1 WHERE id = ?').run(binder.id);
        }
      }

      // Delete legacy binders that have no notes
      const emptyLegacyBinders = legacyBinders.filter(
        (binder: { id: string }) =>
          !bindersWithNotes.some((b: { id: string }) => b.id === binder.id)
      );

      if (emptyLegacyBinders.length > 0) {
        const result = db
          .prepare(
            `DELETE FROM binders 
             WHERE user_profile_id IS NULL 
             AND binder_type = 'USER' 
             AND id NOT IN (SELECT DISTINCT binder_id FROM notes WHERE deleted = 0)
             AND name IN ('General', 'Private', 'Meetings', 'Notes')`
          )
          .run();

        logger.info('Migration 010: Deleted %d empty legacy binders', result.changes);
      }

      // Final verification - ensure no global binders remain with USER type
      const remainingBadBinders = db
        .prepare(
          `SELECT COUNT(*) as count FROM binders 
           WHERE user_profile_id IS NULL AND binder_type = 'USER'`
        )
        .get() as { count: number };

      if (remainingBadBinders.count > 0) {
        logger.warn(
          'Migration 010: %d binders with NULL user_profile_id and USER type still remain',
          remainingBadBinders.count
        );
      } else {
        logger.info('Migration 010: All legacy global binders have been cleaned up');
      }
    } catch (error) {
      logger.error(
        'Migration 010 failed: %s',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  },

  down: (_db: DatabaseInstance) => {
    // This migration is largely irreversible since we're cleaning up data
    // that shouldn't have existed in the first place. However, we can log
    // what would need to be done for a theoretical rollback.

    logger.warn('Migration 010 rollback: Cannot restore deleted legacy binders');
    logger.warn(
      'If rollback is needed, binders would need to be recreated with user_profile_id = NULL'
    );

    // We don't throw an error because this is acceptable for this type of cleanup migration
  },
};
