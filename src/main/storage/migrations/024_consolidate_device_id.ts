import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { logger } from '../../logger';

import { Migration } from './MigrationRunner';

/**
 * Migration 024: Consolidate device_id storage
 *
 * Standardizes device identification across the app by consolidating multiple
 * device identifier storage locations into a single `sync.device_id` key.
 *
 * Previously there were multiple identifiers:
 * - `device.id` - Used by AuthValidationService for session validation
 * - `sync.v2.node_id` - Used by HLC engine for sync operations
 * - `auth.desktopUserUuid` - (deprecated) Used for account linking
 *
 * After this migration, `sync.device_id` is the SINGLE SOURCE OF TRUTH.
 *
 * Priority for migration:
 * 1. If `device.id` exists, use it (most likely to have been sent to server)
 * 2. Else if `sync.v2.node_id` exists, use it
 * 3. Else if `auth.desktopUserUuid` exists, use it
 * 4. No new ID is generated - that happens lazily when needed
 */

export const migration024: Migration = {
  version: 24,
  description: 'Consolidate device identifiers into single sync.device_id',

  up: (db: DatabaseInstance) => {
    logger.info('Migration 024: Consolidating device identifiers');

    // Get all potential device identifiers
    const getSettingValue = (key: string): string | null => {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    };

    const deviceId = getSettingValue('device.id');
    const nodeId = getSettingValue('sync.v2.node_id');
    const desktopUserUuid = getSettingValue('auth.desktopUserUuid');

    logger.info('Migration 024: Found existing identifiers', {
      hasDeviceId: !!deviceId,
      hasNodeId: !!nodeId,
      hasDesktopUserUuid: !!desktopUserUuid,
    });

    // Determine which value to use (priority: device.id > sync.v2.node_id > auth.desktopUserUuid)
    const consolidatedId = deviceId ?? nodeId ?? desktopUserUuid;

    if (consolidatedId) {
      // Insert or update sync.device_id with the consolidated value
      db.prepare(
        `
        INSERT OR REPLACE INTO settings (key, value)
        VALUES ('sync.device_id', ?)
      `
      ).run(consolidatedId);

      logger.info('Migration 024: Created sync.device_id', {
        source: deviceId ? 'device.id' : nodeId ? 'sync.v2.node_id' : 'auth.desktopUserUuid',
        id: consolidatedId.substring(0, 8) + '...',
      });
    } else {
      logger.info('Migration 024: No existing device identifier found, will be created on demand');
    }

    // Remove old keys (cleanup)
    const deleteStmt = db.prepare('DELETE FROM settings WHERE key = ?');

    if (deviceId) {
      deleteStmt.run('device.id');
      logger.info('Migration 024: Removed deprecated device.id');
    }

    if (nodeId) {
      deleteStmt.run('sync.v2.node_id');
      logger.info('Migration 024: Removed deprecated sync.v2.node_id');
    }

    if (desktopUserUuid) {
      deleteStmt.run('auth.desktopUserUuid');
      logger.info('Migration 024: Removed deprecated auth.desktopUserUuid');
    }

    logger.info('Migration 024: Device identifier consolidation complete');
  },

  down: (db: DatabaseInstance) => {
    logger.info('Migration 024: Rolling back device identifier consolidation');

    // Get the consolidated device_id
    const row = db.prepare("SELECT value FROM settings WHERE key = 'sync.device_id'").get() as
      | { value: string }
      | undefined;
    const consolidatedId = row?.value;

    if (consolidatedId) {
      // Restore to the original locations (we can't know which one was the source,
      // so we restore to all legacy locations for safety)
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value)
        VALUES (?, ?)
      `);

      insertStmt.run('device.id', consolidatedId);
      insertStmt.run('sync.v2.node_id', consolidatedId);

      logger.info('Migration 024: Restored legacy device identifiers');

      // Remove the consolidated key
      db.prepare("DELETE FROM settings WHERE key = 'sync.device_id'").run();
      logger.info('Migration 024: Removed sync.device_id');
    }

    logger.info('Migration 024: Rollback complete');
  },
};
