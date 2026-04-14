import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 027: Add tags_hash and note_tags_hash columns to local_merkle_state
 *
 * These columns enable Merkle tree sync for tags and note_tags collections.
 * They store the computed hash of all tags/note_tags for efficient diff detection.
 */
export const migration027: Migration = {
  version: 27,
  description: 'Add tags_hash and note_tags_hash to local_merkle_state',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 027: Adding tags hash columns to merkle state');

    // Check if columns already exist (idempotent)
    const columns = db.prepare('PRAGMA table_info(local_merkle_state)').all() as Array<{
      name: string;
    }>;
    const columnNames = columns.map((c) => c.name);

    if (!columnNames.includes('tags_hash')) {
      db.exec(`ALTER TABLE local_merkle_state ADD COLUMN tags_hash TEXT DEFAULT '';`);
      logger.info('Migration 027: Added tags_hash column');
    } else {
      logger.info('Migration 027: tags_hash column already exists');
    }

    if (!columnNames.includes('note_tags_hash')) {
      db.exec(`ALTER TABLE local_merkle_state ADD COLUMN note_tags_hash TEXT DEFAULT '';`);
      logger.info('Migration 027: Added note_tags_hash column');
    } else {
      logger.info('Migration 027: note_tags_hash column already exists');
    }

    logger.info('Migration 027: Tags hash columns added successfully');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 027: Cannot drop columns in SQLite - recreating table');

    // SQLite doesn't support DROP COLUMN directly prior to version 3.35.0
    // We need to recreate the table without these columns

    // Get current columns
    const columns = db.prepare('PRAGMA table_info(local_merkle_state)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;

    // Filter out the columns we're removing
    const columnsToKeep = columns.filter(
      (c) => c.name !== 'tags_hash' && c.name !== 'note_tags_hash'
    );

    if (columnsToKeep.length === columns.length) {
      logger.info('Migration 027: Columns already removed, skipping rollback');
      return;
    }

    const columnNames = columnsToKeep.map((c) => c.name).join(', ');

    // Build the column definitions for the new table
    const columnDefs = columnsToKeep
      .map((c) => {
        let def = `${c.name} ${c.type}`;
        if (c.name === 'user_id') {
          def += ' PRIMARY KEY';
        }
        if (c.notnull) {
          def += ' NOT NULL';
        }
        if (c.dflt_value !== null) {
          def += ` DEFAULT ${c.dflt_value}`;
        }
        return def;
      })
      .join(', ');

    db.exec(`
      -- Create new table without tags_hash and note_tags_hash
      CREATE TABLE local_merkle_state_new (${columnDefs});

      -- Copy data from old table
      INSERT INTO local_merkle_state_new (${columnNames})
      SELECT ${columnNames} FROM local_merkle_state;

      -- Drop old table
      DROP TABLE local_merkle_state;

      -- Rename new table
      ALTER TABLE local_merkle_state_new RENAME TO local_merkle_state;

      -- Recreate index
      CREATE INDEX IF NOT EXISTS idx_local_merkle_state_dirty
        ON local_merkle_state(dirty, last_updated);
    `);

    logger.info('Migration 027: Rollback completed - tags hash columns removed');
  },
};
