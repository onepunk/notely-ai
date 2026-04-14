/**
 * Migration 035: Seed LLM Factory Defaults
 *
 * Seeds the pipeline's hardcoded generation parameters as settings so that
 * the UI and summary-generation pipeline share a single source of truth.
 *
 * Also replaces the old single `llm.temperature` key with the two
 * pipeline-specific keys: `llm.temperatureExtract` and `llm.temperatureRefine`.
 */

import type { Migration } from './MigrationRunner';

export const migration035: Migration = {
  version: 35,
  description: 'Seed LLM generation parameter defaults and replace llm.temperature',

  up: (db) => {
    const insert = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)');

    insert.run('llm.temperatureExtract', '0.3');
    insert.run('llm.temperatureRefine', '0.5');
    insert.run('llm.topP', '0.9');
    insert.run('llm.maxTokens', '900');
    insert.run('llm.contextWindow', '4096');
    insert.run('llm.nGpuLayers', '-1');

    // Remove the old single-temperature key (superseded by the two new keys)
    db.prepare("DELETE FROM settings WHERE key = 'llm.temperature'").run();
  },

  down: (db) => {
    db.prepare("DELETE FROM settings WHERE key = 'llm.temperatureExtract'").run();
    db.prepare("DELETE FROM settings WHERE key = 'llm.temperatureRefine'").run();
    // Restore the old key with a reasonable default
    db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES('llm.temperature', '0.1')").run();
  },
};
