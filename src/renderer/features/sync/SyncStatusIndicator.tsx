/**
 * Sync Status Indicator
 * Provides sync status visibility for cursor-based sync system
 */

import {
  Button,
  Spinner,
  Tooltip,
  Text,
  Badge,
  Dialog,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogSurface,
  Table,
  TableBody,
  TableCell,
  TableRow,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
} from '@fluentui/react-components';
import {
  CloudSync24Regular,
  CloudError24Regular,
  CloudOff24Regular,
  CloudCheckmark24Filled,
  Warning24Regular,
  Checkmark24Filled,
  ArrowSync24Regular,
  DismissCircle24Regular,
} from '@fluentui/react-icons';
import * as React from 'react';

import { formatErrorForDisplay } from '@shared/error';

import { useAuthStore } from '../../shared/hooks/useAuthStore';
import { useSyncStatus } from '../../shared/hooks/useSyncStatus';

interface SyncStatus {
  isConfigured: boolean;
  isLinked: boolean;
  isEnabled: boolean;
  lastSync: number | null;
  hasValidToken: boolean;
  cursor?: number;

  conflicts?: {
    count: number;
    recent: Array<{
      id: string;
      entityType: 'binder' | 'note' | 'transcription';
      entityId: string;
      conflictType: string;
      resolvedAt: number;
      resolution: string;
    }>;
  };

  retryState?: {
    isRetrying: boolean;
    attemptCount: number;
    maxAttempts: number;
    nextRetryAt: number | null;
    lastError: string | null;
  };
}

interface SyncStatusIndicatorProps {
  className?: string;
  onClick?: () => void;
  showDetailedStatus?: boolean;
}

export const useSyncStatusState = () => {
  const { status: syncStatus, loading, refreshStatus } = useSyncStatus();
  const { authStatus } = useAuthStore();

  const status = React.useMemo<SyncStatus | null>(() => {
    if (!authStatus || loading) return null;

    return {
      isConfigured: authStatus.isConfigured,
      isLinked: authStatus.isLinked,
      isEnabled: syncStatus.isEnabled,
      lastSync: syncStatus.lastSyncTime,
      hasValidToken: authStatus.hasValidAccessToken,
    };
  }, [authStatus, syncStatus, loading]);

  return {
    status,
    syncing: syncStatus.state === 'syncing',
    error: syncStatus.error,
    refreshStatus,
  };
};

export const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({
  className,
  onClick,
  showDetailedStatus = true,
}) => {
  const {
    status,
    syncing: syncingFromHook,
    error: errorFromHook,
    refreshStatus,
  } = useSyncStatusState();
  const [syncing, setSyncing] = React.useState(syncingFromHook);
  const [error, setError] = React.useState<string | null>(errorFromHook);
  const [showDetails, setShowDetails] = React.useState(false);
  const [showConflicts, setShowConflicts] = React.useState(false);
  const [dismissedConflicts, setDismissedConflicts] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    setSyncing(syncingFromHook);
  }, [syncingFromHook]);

  React.useEffect(() => {
    setError(errorFromHook);
  }, [errorFromHook]);

  const getStatusInfo = () => {
    const unacknowledgedConflicts =
      status?.conflicts?.recent?.filter((c) => !dismissedConflicts.has(c.id)) || [];

    if (error) {
      return {
        icon: React.createElement(CloudError24Regular),
        color: '#d13438' as const,
        tooltip: 'Sync Error: ' + error,
        label: 'Error',
        badge: status?.retryState?.isRetrying ? 'Retrying' : null,
      };
    }

    if (!status) {
      return {
        icon: React.createElement(Spinner, { size: 'tiny' }),
        color: '#666' as const,
        tooltip: 'Loading sync status...',
        label: 'Loading',
        badge: null,
      };
    }

    if (status.retryState?.isRetrying) {
      const nextRetry = status.retryState.nextRetryAt;
      const retryIn = nextRetry ? Math.max(0, nextRetry - Date.now()) : 0;
      const retryInSec = Math.ceil(retryIn / 1000);

      return {
        icon: React.createElement(ArrowSync24Regular),
        color: '#ca5010' as const,
        tooltip: `Retrying sync in ${retryInSec}s (attempt ${status.retryState.attemptCount}/${status.retryState.maxAttempts})`,
        label: `Retry ${retryInSec}s`,
        badge: null,
      };
    }

    if (syncing) {
      return {
        icon: React.createElement(Spinner, { size: 'tiny' }),
        color: '#0078d4' as const,
        tooltip: 'Syncing...',
        label: 'Syncing',
        badge: null,
      };
    }

    if (!status.isConfigured) {
      return {
        icon: React.createElement(CloudOff24Regular),
        color: '#666' as const,
        tooltip: 'Sync not configured',
        label: 'Not configured',
        badge: null,
      };
    }

    if (!status.isLinked) {
      return {
        icon: React.createElement(CloudOff24Regular),
        color: '#ca5010' as const,
        tooltip: 'Account not linked',
        label: 'Not linked',
        badge: null,
      };
    }

    if (!status.hasValidToken) {
      return {
        icon: React.createElement(CloudError24Regular),
        color: '#d13438' as const,
        tooltip: 'Authentication expired',
        label: 'Auth expired',
        badge: null,
      };
    }

    if (!status.isEnabled) {
      return {
        icon: React.createElement(CloudOff24Regular),
        color: '#666' as const,
        tooltip: 'Sync disabled',
        label: 'Disabled',
        badge: null,
      };
    }

    if (unacknowledgedConflicts.length > 0) {
      return {
        icon: React.createElement(Warning24Regular),
        color: '#ff8c00' as const,
        tooltip: `${unacknowledgedConflicts.length} conflict(s) resolved - click to review`,
        label: 'Conflicts',
        badge: unacknowledgedConflicts.length.toString(),
      };
    }

    const lastSync = status.lastSync;
    const timeSinceSync = lastSync ? Date.now() - lastSync : null;
    const syncAge = timeSinceSync ? Math.floor(timeSinceSync / 1000 / 60) : null;

    let tooltipText = 'Sync ready';
    let syncStatus = 'ready';
    let color: '#107c10' | '#ca5010' = '#107c10';

    if (syncAge !== null) {
      if (syncAge < 1) {
        tooltipText = 'Synced just now';
        syncStatus = 'synced';
      } else if (syncAge < 60) {
        tooltipText = `Synced ${syncAge}m ago`;
        syncStatus = syncAge < 5 ? 'synced' : 'ready';
      } else if (syncAge < 24 * 60) {
        tooltipText = `Synced ${Math.floor(syncAge / 60)}h ago`;
        syncStatus = 'ready';
      } else {
        tooltipText = `Synced ${Math.floor(syncAge / 60 / 24)}d ago`;
        syncStatus = 'stale';
        color = '#ca5010';
      }
    } else {
      tooltipText = 'Sync ready (never synced)';
    }

    const icon =
      syncStatus === 'synced'
        ? React.createElement(CloudCheckmark24Filled)
        : React.createElement(CloudSync24Regular);

    return {
      icon,
      color,
      tooltip: tooltipText,
      label: syncStatus === 'synced' ? 'Synced' : syncStatus === 'stale' ? 'Stale' : 'Ready',
      badge: null,
    };
  };

  const handleClick = async () => {
    if (onClick) {
      onClick();
      return;
    }

    const unacknowledgedConflicts =
      status?.conflicts?.recent?.filter((c) => !dismissedConflicts.has(c.id)) || [];

    if (unacknowledgedConflicts.length > 0) {
      setShowConflicts(true);
      return;
    }

    if (showDetailedStatus) {
      setShowDetails(true);
      return;
    }

    if (!status?.isLinked || !status?.hasValidToken || !status?.isEnabled) {
      return;
    }

    setSyncing(true);
    try {
      const syncResult = await window.api.sync.push();

      if (syncResult && !syncResult.success) {
        const syncError = syncResult.error || '';
        if (syncError === 'SYNC_IN_PROGRESS') {
          setError('Sync already in progress (E2001)');
        } else if (syncError) {
          setError(formatErrorForDisplay(syncError, 'E2001'));
        }
        setTimeout(() => setError(null), 5000);
      }

      await refreshStatus();
    } catch (err) {
      setError(formatErrorForDisplay(err, 'E2001', { action: 'manualSync' }));
      setTimeout(() => setError(null), 5000);
    } finally {
      setSyncing(false);
    }
  };

  const dismissAllConflicts = () => {
    const conflictIds = status?.conflicts?.recent?.map((c) => c.id) || [];
    setDismissedConflicts((prev) => new Set([...prev, ...conflictIds]));
    setShowConflicts(false);
  };

  const statusInfo = getStatusInfo();

  return (
    <>
      <Tooltip content={statusInfo.tooltip} relationship="label">
        <Button
          appearance="subtle"
          size="small"
          icon={statusInfo.icon}
          onClick={handleClick}
          disabled={syncing}
          className={className}
          style={{
            color: statusInfo.color,
            minWidth: 'auto',
            padding: '6px',
            position: 'relative',
          }}
          aria-label={`Sync status: ${statusInfo.label}. Click to ${onClick ? 'open sync settings' : showDetailedStatus ? 'view details' : 'sync now'}`}
        >
          {statusInfo.badge && (
            <Badge
              appearance="filled"
              color={
                statusInfo.color === '#d13438'
                  ? 'danger'
                  : statusInfo.color === '#ca5010'
                    ? 'warning'
                    : statusInfo.color === '#ff8c00'
                      ? 'important'
                      : 'brand'
              }
              size="small"
              style={{
                position: 'absolute',
                top: '-2px',
                right: '-2px',
                fontSize: '10px',
                minWidth: 'auto',
                height: '16px',
                lineHeight: '16px',
                padding: '0 4px',
              }}
            >
              {statusInfo.badge}
            </Badge>
          )}
          <Text
            size={200}
            style={{
              color: statusInfo.color,
              display: 'none',
            }}
            className="sync-status-label"
          >
            {statusInfo.label}
          </Text>
        </Button>
      </Tooltip>

      {showDetailedStatus && (
        <Dialog open={showDetails} onOpenChange={(_, data) => setShowDetails(data.open)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Sync Status Details</DialogTitle>
              <DialogContent>
                {status && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell>
                            <strong>Status</strong>
                          </TableCell>
                          <TableCell>{statusInfo.label}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>
                            <strong>Last Sync</strong>
                          </TableCell>
                          <TableCell>
                            {status.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never'}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>
                            <strong>Configured</strong>
                          </TableCell>
                          <TableCell>{status.isConfigured ? 'Yes' : 'No'}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>
                            <strong>Linked</strong>
                          </TableCell>
                          <TableCell>{status.isLinked ? 'Yes' : 'No'}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>
                            <strong>Enabled</strong>
                          </TableCell>
                          <TableCell>{status.isEnabled ? 'Yes' : 'No'}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>

                    {status.retryState && status.retryState.isRetrying && (
                      <MessageBar intent="warning">
                        <MessageBarBody>
                          <MessageBarTitle>Retrying Sync</MessageBarTitle>
                          Attempt {status.retryState.attemptCount} of{' '}
                          {status.retryState.maxAttempts}
                          {status.retryState.lastError && (
                            <div>Error: {status.retryState.lastError}</div>
                          )}
                        </MessageBarBody>
                      </MessageBar>
                    )}
                  </div>
                )}
              </DialogContent>
              <DialogActions>
                <Button appearance="secondary" onClick={() => setShowDetails(false)}>
                  Close
                </Button>
                {status?.conflicts?.recent && status.conflicts.recent.length > 0 && (
                  <Button
                    appearance="primary"
                    icon={<Warning24Regular />}
                    onClick={() => {
                      setShowDetails(false);
                      setShowConflicts(true);
                    }}
                  >
                    View Conflicts ({status.conflicts.recent.length})
                  </Button>
                )}
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}

      <Dialog open={showConflicts} onOpenChange={(_, data) => setShowConflicts(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Resolved Conflicts</DialogTitle>
            <DialogContent>
              {status?.conflicts?.recent && status.conflicts.recent.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <MessageBar intent="info">
                    <MessageBarBody>
                      <MessageBarTitle>Conflicts Automatically Resolved</MessageBarTitle>
                      These conflicts were automatically resolved using server-wins policy. Conflict
                      copies were created for any local changes that could not be merged.
                    </MessageBarBody>
                  </MessageBar>

                  <Table>
                    <TableBody>
                      {status.conflicts.recent.map((conflict) => (
                        <TableRow key={conflict.id}>
                          <TableCell>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Checkmark24Filled style={{ color: '#107c10', flexShrink: 0 }} />
                              <div>
                                <div style={{ fontWeight: 'semibold' }}>
                                  {conflict.entityType} conflict
                                </div>
                                <div style={{ fontSize: '12px', color: '#666' }}>
                                  {conflict.conflictType} •{' '}
                                  {new Date(conflict.resolvedAt).toLocaleString()}
                                </div>
                                <div style={{ fontSize: '12px', color: '#666' }}>
                                  Resolution: {conflict.resolution}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <Text>No recent conflicts</Text>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setShowConflicts(false)}>
                Close
              </Button>
              <Button
                appearance="primary"
                icon={<DismissCircle24Regular />}
                onClick={dismissAllConflicts}
              >
                Mark All as Reviewed
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
};
