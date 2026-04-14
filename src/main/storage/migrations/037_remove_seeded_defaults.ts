/**
 * Migration 037: Remove Seeded Default Settings
 *
 * Standardises on the code-defaults pattern: application defaults live as
 * constants in src/common/config.ts and the database stores ONLY explicit
 * user overrides. This migration deletes rows that were seeded with factory
 * defaults by earlier migrations (035, 036) and runAllSeeds().
 *
 * Strategy: DELETE … WHERE key = ? AND value = ?
 *   - If the value matches the known seed default → row is deleted (the code
 *     constant now takes over).
 *   - If the user customised the value → the WHERE clause won't match and the
 *     row is preserved.
 *   - Edge case: user explicitly set a value equal to the default → row is
 *     deleted, but the code constant produces the same value, so behaviour is
 *     identical.
 */

import type { Migration } from './MigrationRunner';

const SEEDED_DEFAULTS: [string, string][] = [
  ['llm.temperatureExtract', '0.3'],
  ['llm.temperatureRefine', '0.5'],
  ['llm.topP', '0.9'],
  ['llm.maxTokens', '900'],
  ['llm.contextWindow', '4096'],
  ['llm.nGpuLayers', '-1'],
  ['transcription.defaultModel', 'small'],
  ['app.locale', 'en'],
  ['sync.batch_size', '250'],
  ['sync.auto_sync_interval', '300000'],
];

export const migration037: Migration = {
  version: 37,
  description: 'Remove seeded default settings (code-defaults pattern)',

  up: (db) => {
    const del = db.prepare('DELETE FROM settings WHERE key = ? AND value = ?');
    for (const [key, value] of SEEDED_DEFAULTS) {
      del.run(key, value);
    }
  },

  down: (db) => {
    // Re-seed the defaults that were removed
    const insert = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)');
    for (const [key, value] of SEEDED_DEFAULTS) {
      insert.run(key, value);
    }
  },
};
