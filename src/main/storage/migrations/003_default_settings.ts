import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { Migration } from './MigrationRunner';

/**
 * Migration 003: Default Settings
 * Seeds default settings keys if missing (devtools setting removed)
 */
export const migration003: Migration = {
  version: 3,
  description: 'Seed default settings keys (devtools setting removed)',

  up: (db: DatabaseInstance) => {
    db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run('app.locale', 'en');
  },

  down: (db: DatabaseInstance) => {
    // Remove the default setting
    db.prepare('DELETE FROM settings WHERE key = ?').run('app.locale');
  },
};
