import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 018: Calendar events cache
 * Adds tables for storing calendar events locally along with range sync metadata.
 */
export const migration018: Migration = {
  version: 18,
  description: 'Create calendar events cache tables',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 018: Creating calendar events cache tables');

    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        account_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        provider TEXT,
        calendar_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        location TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        is_all_day INTEGER NOT NULL DEFAULT 0,
        is_cancelled INTEGER NOT NULL DEFAULT 0,
        last_modified INTEGER,
        raw_payload TEXT NOT NULL,
        synced_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, event_id)
      );

      CREATE INDEX IF NOT EXISTS idx_calendar_events_account_time
        ON calendar_events(account_id, start_time, end_time);

      CREATE INDEX IF NOT EXISTS idx_calendar_events_synced
        ON calendar_events(account_id, synced_at);

      CREATE TABLE IF NOT EXISTS calendar_event_sync_ranges (
        account_id TEXT NOT NULL,
        range_start INTEGER NOT NULL,
        range_end INTEGER NOT NULL,
        synced_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, range_start, range_end)
      );
    `);

    logger.info('Migration 018: Calendar events cache tables created successfully');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 018: Dropping calendar events cache tables');

    db.exec(`
      DROP TABLE IF EXISTS calendar_event_sync_ranges;
      DROP INDEX IF EXISTS idx_calendar_events_synced;
      DROP INDEX IF EXISTS idx_calendar_events_account_time;
      DROP TABLE IF EXISTS calendar_events;
    `);

    logger.info('Migration 018: Calendar events cache tables dropped');
  },
};
