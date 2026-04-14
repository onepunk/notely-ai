/**
 * Migration 036: Seed Transcription Default Model
 *
 * Unifies on `transcription.defaultModel` as the single source of truth
 * for the default Whisper model. Migrates the legacy `transcription.model_name`
 * key so existing user choices are preserved.
 */

import type { Migration } from './MigrationRunner';

export const migration036: Migration = {
  version: 36,
  description: 'Seed transcription default model and migrate legacy key',

  up: (db) => {
    // Migrate legacy transcription.model_name -> transcription.defaultModel
    const legacy = db
      .prepare("SELECT value FROM settings WHERE key = 'transcription.model_name'")
      .get() as { value: string } | undefined;

    if (legacy) {
      // User had a custom model - preserve it as the new defaultModel (if not already set)
      db.prepare(
        "INSERT OR IGNORE INTO settings(key, value) VALUES('transcription.defaultModel', ?)"
      ).run(legacy.value);
      db.prepare("DELETE FROM settings WHERE key = 'transcription.model_name'").run();
    }

    // Seed factory default (INSERT OR IGNORE won't overwrite existing user choice or migrated value)
    db.prepare(
      "INSERT OR IGNORE INTO settings(key, value) VALUES('transcription.defaultModel', 'small')"
    ).run();
  },

  down: (db) => {
    db.prepare("DELETE FROM settings WHERE key = 'transcription.defaultModel'").run();
  },
};
