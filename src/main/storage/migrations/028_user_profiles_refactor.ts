import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 028: Refactor user management for multi-user support
 *
 * This migration:
 * 1. Creates a new `user_profiles` table (plural) to support multiple users
 * 2. Migrates existing user data from `settings.current_user_id` and `user_profile`
 * 3. Links the server user ID (from auth) to local profile ID
 * 4. Drops the old `user_profile` table (singular, hardcoded id=1)
 *
 * The user_profiles table becomes the single source of truth for user identity:
 * - `id`: Local UUID used in all entity tables (binders, notes, tags, etc.)
 * - `server_user_id`: Maps to the server's auth user ID for sync
 * - `is_active`: Only one user can be active at a time
 */
export const migration028: Migration = {
  version: 28,
  description: 'Refactor user management for multi-user support',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 028: Starting user profiles refactor');

    // Step 1: Create new user_profiles table
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id TEXT PRIMARY KEY,
        server_user_id TEXT UNIQUE,
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        avatar_path TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_user_profiles_server_user_id ON user_profiles(server_user_id);
      CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active ON user_profiles(is_active);
    `);

    // Step 2: Migrate existing user data
    // Get current_user_id from settings (the local UUID we've been using)
    const currentUserIdRow = db
      .prepare("SELECT value FROM settings WHERE key = 'current_user_id'")
      .get() as { value: string } | undefined;

    // Get server user ID from settings (auth.userId)
    const serverUserIdRow = db
      .prepare("SELECT value FROM settings WHERE key = 'auth.userId'")
      .get() as { value: string } | undefined;

    // Get existing profile data from old user_profile table
    const oldProfile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get() as
      | {
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          avatar_path: string | null;
          updated_at: number;
        }
      | undefined;

    const now = Date.now();

    if (currentUserIdRow?.value) {
      const localUserId = currentUserIdRow.value;
      const serverUserId = serverUserIdRow?.value || null;

      // Check if this user already exists (in case migration runs twice)
      const existingUser = db
        .prepare('SELECT id FROM user_profiles WHERE id = ?')
        .get(localUserId) as { id: string } | undefined;

      if (!existingUser) {
        // Insert the existing user into user_profiles
        const insertStmt = db.prepare(`
          INSERT INTO user_profiles (
            id, server_user_id, email, first_name, last_name, avatar_path,
            is_active, created_at, updated_at, last_login_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        insertStmt.run(
          localUserId,
          serverUserId,
          oldProfile?.email || null,
          oldProfile?.first_name || null,
          oldProfile?.last_name || null,
          oldProfile?.avatar_path || null,
          1, // is_active = true (this is the current user)
          oldProfile?.updated_at || now,
          now,
          serverUserId ? now : null // last_login_at only if we have server connection
        );

        logger.info('Migration 028: Migrated existing user to user_profiles', {
          localUserId,
          serverUserId: serverUserId ? serverUserId.substring(0, 8) + '...' : 'none',
        });
      }
    }

    // Step 3: Remove current_user_id from settings (now managed via user_profiles.is_active)
    // We keep it for now for backwards compatibility during rollout
    // db.prepare("DELETE FROM settings WHERE key = 'current_user_id'").run();

    // Step 4: Drop old user_profile table (singular)
    // Keep for backwards compatibility during rollout, just rename it
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_profile'")
      .get();
    if (tableExists) {
      db.exec('ALTER TABLE user_profile RENAME TO user_profile_deprecated');
      logger.info('Migration 028: Renamed user_profile to user_profile_deprecated');
    }

    logger.info('Migration 028: User profiles refactor completed');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 028: Rolling back user profiles refactor');

    // Restore old user_profile table if it was renamed
    const deprecatedTableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='user_profile_deprecated'"
      )
      .get();
    if (deprecatedTableExists) {
      db.exec('ALTER TABLE user_profile_deprecated RENAME TO user_profile');
    }

    // Drop new user_profiles table
    db.exec(`
      DROP INDEX IF EXISTS idx_user_profiles_is_active;
      DROP INDEX IF EXISTS idx_user_profiles_server_user_id;
      DROP TABLE IF EXISTS user_profiles;
    `);

    logger.info('Migration 028: Rollback completed');
  },
};
