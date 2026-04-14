/**
 * Custom hook for handling sync completion events consistently across components.
 * This provides a unified way to listen for sync completions from SyncLifecycleManager
 * and refresh UI data when sync operations complete.
 */

import { useEffect } from 'react';

interface SyncEventOptions {
  onSyncComplete?: () => void;
  onSyncError?: (error: unknown) => void;
  onSyncStart?: () => void;
}

export function useSyncEvents(options: SyncEventOptions) {
  const { onSyncComplete, onSyncError, onSyncStart } = options;

  useEffect(() => {
    const cleanupFunctions: (() => void)[] = [];

    // Listen for sync completion from SyncLifecycleManager
    if (typeof window.api?.onSyncComplete === 'function' && onSyncComplete) {
      const unsubscribeSyncComplete = window.api.onSyncComplete((data: unknown) => {
        console.log('[useSyncEvents] Sync completed:', data);
        onSyncComplete();
      });
      cleanupFunctions.push(unsubscribeSyncComplete);
    }

    // Listen for sync start from SyncLifecycleManager
    if (typeof window.api?.onSyncStart === 'function' && onSyncStart) {
      const unsubscribeSyncStart = window.api.onSyncStart((data: unknown) => {
        console.log('[useSyncEvents] Sync started:', data);
        onSyncStart();
      });
      cleanupFunctions.push(unsubscribeSyncStart);
    }

    // Listen for sync errors from SyncLifecycleManager
    if (typeof window.api?.onSyncError === 'function' && onSyncError) {
      const unsubscribeSyncError = window.api.onSyncError((data: unknown) => {
        console.log('[useSyncEvents] Sync error:', data);
        onSyncError(data);
      });
      cleanupFunctions.push(unsubscribeSyncError);
    }

    // Listen for notes:changed custom events (emitted after sync operations)
    const handleNotesChanged = () => {
      console.log('[useSyncEvents] Notes changed event detected');
      if (onSyncComplete) onSyncComplete();
    };

    window.addEventListener('notes:changed', handleNotesChanged);
    cleanupFunctions.push(() => window.removeEventListener('notes:changed', handleNotesChanged));

    // Return cleanup function
    return () => {
      cleanupFunctions.forEach((cleanup) => {
        try {
          cleanup();
        } catch (error) {
          console.warn('[useSyncEvents] Error during cleanup:', error);
        }
      });
    };
  }, [onSyncComplete, onSyncError, onSyncStart]);
}

/**
 * Simplified hook that only listens for sync completion and refreshes data
 */
export function useSyncRefresh(refreshCallback: () => void) {
  return useSyncEvents({
    onSyncComplete: refreshCallback,
  });
}
