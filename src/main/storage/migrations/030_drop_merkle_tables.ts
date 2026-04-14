import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 030: Drop Merkle Sync Tables
 *
 * Removes all Merkle-based sync infrastructure tables now that
 * cursor-based sync has been fully adopted.
 *
 * Tables being dropped:
 * - local_merkle_state: Stored per-user Merkle tree root hashes
 * - local_entity_hashes: Cached entity content/state hashes
 * - local_merkle_nodes: Intermediate Merkle tree nodes
 * - sync_engine_config: Merkle sync engine configuration
 * - sync_operations: Merkle sync operation log
 */
export const migration030: Migration = {
  version: 30,
  description: 'Drop Merkle sync tables (replaced by cursor-based sync)',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 030: Dropping Merkle sync tables');

    // Drop triggers first
    db.exec(`
      DROP TRIGGER IF EXISTS update_local_entity_hashes_timestamp;
      DROP TRIGGER IF EXISTS update_local_merkle_state_timestamp;
    `);

    // Drop indexes
    db.exec(`
      DROP INDEX IF EXISTS idx_local_merkle_state_dirty;
      DROP INDEX IF EXISTS idx_sync_operations_status_started;
      DROP INDEX IF EXISTS idx_local_merkle_nodes_collection_level;
      DROP INDEX IF EXISTS idx_local_entity_hashes_modified;
      DROP INDEX IF EXISTS idx_local_entity_hashes_type_timestamp;
    `);

    // Drop tables
    db.exec(`
      DROP TABLE IF EXISTS sync_operations;
      DROP TABLE IF EXISTS sync_engine_config;
      DROP TABLE IF EXISTS local_merkle_nodes;
      DROP TABLE IF EXISTS local_entity_hashes;
      DROP TABLE IF EXISTS local_merkle_state;
    `);

    logger.info('Migration 030: Merkle sync tables dropped successfully');
  },

  down: (_db: DatabaseInstance) => {
    // Intentionally not recreating Merkle tables as they are obsolete
    logger.info('Migration 030: Rollback skipped - Merkle tables are obsolete');
  },
};
