import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { Migration } from './MigrationRunner';

/**
 * Migration 002: User Profile
 * Ensures single-row user_profile exists
 */
export const migration002: Migration = {
  version: 2,
  description: 'Ensure single-row user_profile exists',

  up: (db: DatabaseInstance) => {
    const now = Date.now();
    db.prepare(
      'INSERT OR IGNORE INTO user_profile(id, first_name, last_name, email, avatar_path, updated_at) VALUES (1, NULL, NULL, NULL, NULL, ?)'
    ).run(now);
  },

  down: (db: DatabaseInstance) => {
    // Remove the default user profile row
    db.prepare('DELETE FROM user_profile WHERE id = 1').run();
  },
};
