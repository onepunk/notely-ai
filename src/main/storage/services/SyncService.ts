/**
 * SyncService - Minimal sync configuration management for cursor-based sync
 *
 * This service provides access to sync_config table for storing:
 * - cursor: The current sync cursor position
 * - lastPushAt: Timestamp of last successful push
 * - lastPullAt: Timestamp of last successful pull
 *
 * NOTE: Auth fields are NOT stored here - use AuthService for auth-related data.
 * NOTE: Merkle-based sync has been removed - this is cursor-based sync only.
 */

import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { TransactionManager } from '../core/TransactionManager';
import { IDatabaseManager } from '../interfaces/IDatabaseManager';
import { ISyncService } from '../interfaces/ISyncService';
import type {
  SyncConfig,
  UpdateSyncConfigInput,
  SyncOperation,
  SyncStatus,
  SyncLogOptions,
} from '../types/sync';

interface SyncConfigRow {
  id: number;
  last_push_at: number | null;
  last_pull_at: number | null;
  created_at: number;
  updated_at: number;
  cursor: number;
}

/**
 * SyncService - Sync configuration management
 */
export class SyncService implements ISyncService {
  constructor(
    private databaseManager: IDatabaseManager,
    private transactionManager: TransactionManager
  ) {
    // Database will be accessed lazily when needed
  }

  private get db(): DatabaseInstance {
    return this.databaseManager.getDatabase();
  }

  /**
   * Get sync configuration
   */
  async getConfig(): Promise<SyncConfig | null> {
    const row = this.db.prepare('SELECT * FROM sync_config WHERE id = 1').get() as
      | SyncConfigRow
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      lastPushAt: row.last_push_at,
      lastPullAt: row.last_pull_at,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Update sync configuration
   */
  async setConfig(updates: UpdateSyncConfigInput): Promise<void> {
    await this.transactionManager.execute(() => {
      const now = Date.now();
      const setParts: string[] = ['updated_at = ?'];
      const values: (number | null)[] = [now];

      if (updates.lastPushAt !== undefined) {
        setParts.push('last_push_at = ?');
        values.push(updates.lastPushAt);
      }

      if (updates.lastPullAt !== undefined) {
        setParts.push('last_pull_at = ?');
        values.push(updates.lastPullAt);
      }

      // Only update if we have something to update beyond updated_at
      if (setParts.length > 1) {
        const sql = `UPDATE sync_config SET ${setParts.join(', ')} WHERE id = 1`;
        this.db.prepare(sql).run(...values);
      }
    });
  }

  /**
   * Get the current sync cursor value
   */
  async getCursor(): Promise<number> {
    const row = this.db.prepare('SELECT cursor FROM sync_config WHERE id = 1').get() as
      | { cursor: number }
      | undefined;

    return row?.cursor ?? 0;
  }

  /**
   * Update the sync cursor value
   */
  async setCursor(cursor: number): Promise<void> {
    await this.transactionManager.execute(() => {
      const now = Date.now();
      this.db
        .prepare('UPDATE sync_config SET cursor = ?, updated_at = ? WHERE id = 1')
        .run(cursor, now);
    });
  }

  /**
   * Log a sync operation start
   * @returns The log entry ID
   */
  async logOperation(operation: SyncOperation, status: SyncStatus): Promise<number> {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO sync_log (operation, status, started_at, entity_count)
         VALUES (?, ?, ?, 0)`
      )
      .run(operation, status, now);

    return Number(result.lastInsertRowid);
  }

  /**
   * Update a sync operation log entry status
   */
  async updateLogStatus(
    logId: number,
    status: SyncStatus,
    options?: SyncLogOptions
  ): Promise<void> {
    await this.transactionManager.execute(() => {
      const now = Date.now();
      const setParts: string[] = ['status = ?', 'completed_at = ?'];
      const values: (string | number | null)[] = [status, now];

      if (options?.entityType !== undefined) {
        setParts.push('entity_type = ?');
        values.push(options.entityType);
      }

      if (options?.entityCount !== undefined) {
        setParts.push('entity_count = ?');
        values.push(options.entityCount);
      }

      if (options?.errorMessage !== undefined) {
        setParts.push('error_message = ?');
        values.push(options.errorMessage);
      }

      if (options?.sessionId !== undefined) {
        setParts.push('session_id = ?');
        values.push(options.sessionId);
      }

      values.push(logId);
      const sql = `UPDATE sync_log SET ${setParts.join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...values);
    });
  }
}
