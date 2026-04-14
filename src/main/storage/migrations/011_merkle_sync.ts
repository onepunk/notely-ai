import { randomUUID } from 'crypto';

import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 011: Merkle v2 Sync Tables
 * Creates local Merkle tree state tracking tables for v2 sync system
 */
export const migration011: Migration = {
  version: 11,
  description: 'Add Merkle v2 sync state tracking tables',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 011: Creating Merkle v2 sync tables...');

    db.exec(`
      -- Local Merkle state tracking per user
      CREATE TABLE IF NOT EXISTS local_merkle_state (
        user_id TEXT PRIMARY KEY,
        root_hash TEXT,
        binders_hash TEXT,
        notes_hash TEXT,
        transcriptions_hash TEXT,
        logical_timestamp INTEGER DEFAULT 0,
        last_server_sync INTEGER,
        dirty INTEGER DEFAULT 0,
        version_number INTEGER DEFAULT 1,
        last_updated INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        node_id TEXT -- Device identifier for HLC
      );

      -- Local entity hash cache for efficient diff computation
      CREATE TABLE IF NOT EXISTS local_entity_hashes (
        entity_type TEXT NOT NULL CHECK (entity_type IN ('binders','notes','transcriptions')),
        entity_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        deleted INTEGER DEFAULT 0,
        logical_timestamp INTEGER NOT NULL, -- HLC timestamp
        last_modified INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        
        PRIMARY KEY (entity_type, entity_id)
      );

      -- Optional: Cache of intermediate Merkle nodes for large datasets
      -- This table enables O(log n) incremental updates for very large collections
      CREATE TABLE IF NOT EXISTS local_merkle_nodes (
        collection TEXT NOT NULL CHECK (collection IN ('binders','notes','transcriptions')),
        level INTEGER NOT NULL,
        node_index INTEGER NOT NULL,
        node_hash TEXT NOT NULL,
        child_count INTEGER NOT NULL,
        range_start TEXT, -- First entity key in range
        range_end TEXT,   -- Last entity key in range
        last_updated INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        
        PRIMARY KEY (collection, level, node_index)
      );

      -- Sync v2 configuration and metadata (table name: sync_engine_config)
      CREATE TABLE IF NOT EXISTS sync_engine_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER DEFAULT 0,
        node_id TEXT, -- Persistent device node_id for HLC
        last_hlc_logical_ms INTEGER DEFAULT 0,
        last_hlc_counter INTEGER DEFAULT 0,
        memory_budget_mb INTEGER DEFAULT 50,
        cache_enabled INTEGER DEFAULT 1,
        performance_mode TEXT DEFAULT 'balanced' CHECK (performance_mode IN ('fast','balanced','memory')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      -- Sync v2 operation log for debugging and recovery (table name: sync_operations)
      CREATE TABLE IF NOT EXISTS sync_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('state','diff','merge','rebuild')),
        status TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
        old_root_hash TEXT,
        new_root_hash TEXT,
        entities_changed INTEGER DEFAULT 0,
        conflicts_resolved INTEGER DEFAULT 0,
        duration_ms INTEGER,
        error_message TEXT,
        started_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        completed_at INTEGER,
        metadata TEXT -- JSON metadata
      );

      -- Create performance indexes
      CREATE INDEX IF NOT EXISTS idx_local_entity_hashes_type_timestamp 
        ON local_entity_hashes(entity_type, logical_timestamp);
        
      CREATE INDEX IF NOT EXISTS idx_local_entity_hashes_modified 
        ON local_entity_hashes(last_modified);
        
      CREATE INDEX IF NOT EXISTS idx_local_merkle_nodes_collection_level 
        ON local_merkle_nodes(collection, level);
        
      CREATE INDEX IF NOT EXISTS idx_sync_operations_status_started
        ON sync_operations(status, started_at DESC);
        
      CREATE INDEX IF NOT EXISTS idx_local_merkle_state_dirty 
        ON local_merkle_state(dirty, last_updated);

      -- Create triggers for automatic timestamp updates
      CREATE TRIGGER IF NOT EXISTS update_local_merkle_state_timestamp
        AFTER UPDATE ON local_merkle_state
        FOR EACH ROW
        WHEN NEW.last_updated = OLD.last_updated
      BEGIN
        UPDATE local_merkle_state 
        SET last_updated = unixepoch() * 1000 
        WHERE user_id = NEW.user_id;
      END;

      CREATE TRIGGER IF NOT EXISTS update_local_entity_hashes_timestamp
        AFTER UPDATE ON local_entity_hashes
        FOR EACH ROW
        WHEN NEW.last_modified = OLD.last_modified
      BEGIN
        UPDATE local_entity_hashes 
        SET last_modified = unixepoch() * 1000 
        WHERE entity_type = NEW.entity_type AND entity_id = NEW.entity_id;
      END;
    `);

    // Initialize default sync v2 config row
    const now = Date.now();
    const nodeId = randomUUID();

    db.prepare(
      `
      INSERT OR IGNORE INTO sync_engine_config (
        id, enabled, node_id, created_at, updated_at
      ) VALUES (1, 0, ?, ?, ?)
    `
    ).run(nodeId, now, now);

    logger.info('Migration 011: Merkle v2 sync tables created successfully');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 011: Rolling back Merkle v2 sync tables...');

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

    logger.info('Migration 011: Merkle v2 sync tables rolled back successfully');
  },
};
