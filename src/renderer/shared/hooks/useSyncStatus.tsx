/**
 * Phase 3: Dedicated Sync Status Hook
 *
 * Provides clean separation between auth status and sync status.
 * Tracks actual sync operations and health, not just auth connectivity.
 *
 * Features:
 * - Tracks sync state (Ready/Syncing/Synced/Error/Disabled)
 * - Monitors last sync timestamp
 * - Captures sync errors with actionable messages
 * - Listens to sync events (start, complete, error)
 * - Provides retry information when sync fails
 * - Independent from auth status (auth is only a prerequisite)
 */

import * as React from 'react';

import { formatErrorForDisplay } from '@shared/error';

/**
 * Sync-specific status states
 * These reflect the actual state of sync operations, not auth
 */
export type SyncState = 'disabled' | 'ready' | 'syncing' | 'synced' | 'error';

/**
 * Sync status information
 */
export interface SyncStatus {
  // Current state of sync
  state: SyncState;

  // Last successful sync timestamp
  lastSyncTime: number | null;

  // Current error if in error state
  error: string | null;

  // User-friendly error message
  errorMessage: string | null;

  // Retry information
  retryInfo: {
    isRetrying: boolean;
    attemptCount: number;
    maxAttempts: number;
    nextRetryAt: number | null;
  } | null;

  // Whether sync is enabled in settings
  isEnabled: boolean;

  // Whether prerequisites are met (auth, config)
  canSync: boolean;

  // Health metrics (optional)
  health?: {
    successRate: number;
    avgDuration: number;
    lastSuccess: boolean | null;
  };
}

/**
 * Sync status context value
 */
interface SyncStatusContextValue {
  status: SyncStatus;
  loading: boolean;
  refreshStatus: () => Promise<void>;
  triggerSync: () => Promise<void>;
}

// Create context
const SyncStatusContext = React.createContext<SyncStatusContextValue | null>(null);

/**
 * Sync Status Provider
 *
 * Wraps components that need sync status information.
 * Manages sync state and listens to sync events.
 */
export const SyncStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = React.useState<SyncStatus>({
    state: 'disabled',
    lastSyncTime: null,
    error: null,
    errorMessage: null,
    retryInfo: null,
    isEnabled: false,
    canSync: false,
  });
  const [loading, setLoading] = React.useState(true);
  const syncingRef = React.useRef(false);

  /**
   * Fetch sync status from main process
   */
  const fetchSyncStatus = React.useCallback(async (): Promise<SyncStatus> => {
    try {
      // Get sync-specific status
      const syncStatus = await window.api.sync.getStatus();
      const syncEnabled = await window.api.settings.get('syncEnabled');

      // Get last sync timestamp from status (queries sync_log table for actual successful syncs)
      const status = await window.api.sync.getStatus();
      const lastSyncTimestamp = status?.lastSync ?? null;

      // Get health metrics if available
      let health = undefined;
      try {
        const healthMetrics = await window.api.sync.getHealthMetrics();
        if (healthMetrics && typeof healthMetrics === 'object' && 'successRate' in healthMetrics) {
          health = {
            successRate: healthMetrics.successRate || 0,
            avgDuration: healthMetrics.averageDuration || 0,
            lastSuccess: healthMetrics.lastSyncSuccess ?? null,
          };
        }
      } catch {
        // Health metrics are optional
      }

      // Determine if sync can be performed
      const canSync =
        syncStatus.isConfigured &&
        syncStatus.isLinked &&
        syncStatus.hasValidToken &&
        syncEnabled === 'true';

      // Determine current sync state
      let state: SyncState = 'disabled';
      let errorMessage: string | null = null;

      if (!syncEnabled || syncEnabled === 'false') {
        state = 'disabled';
      } else if (!canSync) {
        // Prerequisites not met - use error codes for diagnosability
        state = 'error';
        if (!syncStatus.isConfigured) {
          errorMessage = 'CONFIG_MISSING';
        } else if (!syncStatus.isLinked) {
          errorMessage = 'ACCOUNT_NOT_LINKED';
        } else if (!syncStatus.hasValidToken) {
          errorMessage = 'AUTH_EXPIRED';
        }
      } else if (syncingRef.current) {
        state = 'syncing';
      } else if (lastSyncTimestamp) {
        const lastSync =
          typeof lastSyncTimestamp === 'string'
            ? parseInt(lastSyncTimestamp, 10)
            : lastSyncTimestamp;

        // Consider "synced" if synced within last 5 minutes
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        state = lastSync > fiveMinutesAgo ? 'synced' : 'ready';
      } else {
        state = 'ready';
      }

      const lastSync = lastSyncTimestamp
        ? typeof lastSyncTimestamp === 'string'
          ? parseInt(lastSyncTimestamp, 10)
          : lastSyncTimestamp
        : null;

      return {
        state,
        lastSyncTime: lastSync,
        error: null,
        errorMessage,
        retryInfo: null,
        isEnabled: syncEnabled === 'true',
        canSync,
        health,
      };
    } catch (err) {
      console.error('[SyncStatus] Failed to fetch sync status:', err);

      return {
        state: 'error',
        lastSyncTime: null,
        error: err instanceof Error ? err.message : 'Failed to load sync status',
        errorMessage: 'Unable to load sync status. Please try again.',
        retryInfo: null,
        isEnabled: false,
        canSync: false,
      };
    }
  }, []);

  /**
   * Refresh sync status
   */
  const refreshStatus = React.useCallback(async () => {
    setLoading(true);
    try {
      const newStatus = await fetchSyncStatus();
      setStatus(newStatus);
    } catch (err) {
      console.error('[SyncStatus] Failed to refresh status:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchSyncStatus]);

  /**
   * Trigger a manual sync
   */
  const triggerSync = React.useCallback(async () => {
    if (!status.canSync || syncingRef.current) {
      return;
    }

    syncingRef.current = true;
    setStatus((prev) => ({ ...prev, state: 'syncing', error: null, errorMessage: null }));

    try {
      // Call push() which internally does both push and pull
      // This prevents race conditions from parallel push/pull calls
      const syncResult = await window.api.sync.push();

      // Handle sync errors
      if (syncResult && !syncResult.success) {
        const syncError = syncResult.error || '';
        if (syncError === 'SYNC_IN_PROGRESS') {
          throw new Error('Sync already in progress');
        } else if (syncError) {
          throw new Error(`Sync failed: ${syncError}`);
        }
      }

      // Sync succeeded - refresh status to get updated timestamp
      await refreshStatus();
    } catch (err) {
      const errorMessage = formatErrorForDisplay(err, 'E2001');
      setStatus((prev) => ({
        ...prev,
        state: 'error',
        error: errorMessage,
        errorMessage: errorMessage,
      }));
    } finally {
      syncingRef.current = false;
    }
  }, [status.canSync, refreshStatus]);

  /**
   * Initial load on mount
   */
  React.useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  /**
   * Listen for sync events from SyncLifecycleManager state machine
   */
  React.useEffect(() => {
    const cleanupFunctions: (() => void)[] = [];

    // Sync events emitted by SyncHandlers/SyncLifecycleManager
    if (typeof window.api?.onSyncStart === 'function') {
      const unsub = window.api.onSyncStart(() => {
        syncingRef.current = true;
        setStatus((prev) => ({ ...prev, state: 'syncing', error: null, errorMessage: null }));
      });
      cleanupFunctions.push(unsub);
    }

    if (typeof window.api?.onSyncComplete === 'function') {
      const unsub = window.api.onSyncComplete(() => {
        syncingRef.current = false;
        void refreshStatus();
      });
      cleanupFunctions.push(unsub);
    }

    if (typeof window.api?.onSyncError === 'function') {
      const unsub = window.api.onSyncError((data: unknown) => {
        syncingRef.current = false;

        const errorData = data as {
          error?: string;
          willRetry?: boolean;
          attemptCount?: number;
          maxAttempts?: number;
          nextRetryAt?: number | null;
        };

        const errorMessage = formatErrorForDisplay(errorData.error, 'E2001');

        setStatus((prev) => ({
          ...prev,
          state: 'error',
          error: errorMessage,
          errorMessage: errorMessage,
          retryInfo: errorData.willRetry
            ? {
                isRetrying: true,
                attemptCount: errorData.attemptCount || 0,
                maxAttempts: errorData.maxAttempts || 3,
                nextRetryAt: errorData.nextRetryAt || null,
              }
            : null,
        }));
      });
      cleanupFunctions.push(unsub);
    }

    return () => {
      cleanupFunctions.forEach((cleanup) => {
        try {
          cleanup();
        } catch (err) {
          console.warn('[SyncStatus] Error during cleanup:', err);
        }
      });
    };
  }, [refreshStatus]);

  /**
   * Periodic refresh to keep status fresh
   * Runs every 30 seconds to update state (e.g., "synced" -> "ready")
   */
  React.useEffect(() => {
    const interval = setInterval(() => {
      void refreshStatus();
    }, 30 * 1000);

    return () => {
      clearInterval(interval);
    };
  }, [refreshStatus]);

  const contextValue: SyncStatusContextValue = {
    status,
    loading,
    refreshStatus,
    triggerSync,
  };

  return <SyncStatusContext.Provider value={contextValue}>{children}</SyncStatusContext.Provider>;
};

/**
 * Hook to access sync status
 *
 * @throws Error if used outside SyncStatusProvider
 *
 * @example
 * ```tsx
 * const { status, loading, refreshStatus, triggerSync } = useSyncStatus();
 *
 * if (loading) return <Spinner />;
 * if (status.state === 'error') return <Error message={status.errorMessage} />;
 * if (status.state === 'disabled') return <EnableSyncPrompt />;
 *
 * return <div>Last sync: {new Date(status.lastSyncTime).toLocaleString()}</div>;
 * ```
 */
export const useSyncStatus = (): SyncStatusContextValue => {
  const context = React.useContext(SyncStatusContext);

  if (!context) {
    throw new Error('useSyncStatus must be used within SyncStatusProvider');
  }

  return context;
};

/**
 * Hook to get just the sync state (lighter than full context)
 *
 * @example
 * ```tsx
 * const state = useSyncState();
 * const isReady = state === 'ready';
 * ```
 */
export const useSyncState = (): SyncState => {
  const { status } = useSyncStatus();
  return status.state;
};

/**
 * Hook to check if sync is currently active
 *
 * @example
 * ```tsx
 * const isSyncing = useIsSyncing();
 * if (isSyncing) return <Spinner />;
 * ```
 */
export const useIsSyncing = (): boolean => {
  const { status } = useSyncStatus();
  return status.state === 'syncing';
};

/**
 * Hook to get sync error information
 *
 * @example
 * ```tsx
 * const error = useSyncError();
 * if (error) return <ErrorBanner message={error.message} retry={error.retryInfo} />;
 * ```
 */
export const useSyncError = (): { message: string; retryInfo: SyncStatus['retryInfo'] } | null => {
  const { status } = useSyncStatus();

  if (status.state !== 'error' || !status.errorMessage) {
    return null;
  }

  return {
    message: status.errorMessage,
    retryInfo: status.retryInfo,
  };
};
