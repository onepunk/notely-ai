import { Button, Field, MessageBar, Spinner, Switch, Text } from '@fluentui/react-components';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { isNotelyService } from '../../../../common/config';
import { useAuthStore } from '../../../shared/hooks/useAuthStore';
import { useSyncStatus } from '../../../shared/hooks/useSyncStatus';

import styles from './ServerSettings.module.css';
import { SettingsInlineActions, SettingsSection, SettingsTabLayout } from './SettingsTabLayout';

interface SyncSettings {
  enabled: boolean;
  serverUrl?: string;
  lastSync?: number;
}

export const ServerSettings: React.FC = () => {
  const { t } = useTranslation();

  // Use shared auth store for authentication status
  const { authStatus, profile, refreshAuth } = useAuthStore();
  const userEmail = profile?.email ?? null;

  // Use sync status hook for sync-specific state
  const { status: syncStatus, refreshStatus: refreshSyncStatus } = useSyncStatus();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [settings, setSettings] = React.useState<SyncSettings>({
    enabled: false,
  });
  const [tempSettings, setTempSettings] = React.useState<SyncSettings>({
    enabled: false,
  });
  const [_message, setMessage] = React.useState<{
    type: 'success' | 'error' | 'warning' | 'info';
    text: string;
  } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);

  // Load settings from database
  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        // Load from settings storage
        const serverUrl = await window.api.settings.get('auth.serverUrl');
        const syncEnabled = await window.api.settings.get('syncEnabled');
        const lastSyncTimestamp = await window.api.settings.get('lastSyncTimestamp');

        const loadedSettings: SyncSettings = {
          enabled: Boolean(syncEnabled),
          serverUrl: serverUrl || undefined,
          lastSync: lastSyncTimestamp ? Number(lastSyncTimestamp) : undefined,
        };

        setSettings(loadedSettings);
        setTempSettings(loadedSettings);

        // Don't show auto-message on load - message bar removed from Remote Sync card
        setMessage(null);
      } catch (error) {
        console.error('Failed to load sync settings:', error);
        setMessage({ type: 'error', text: t('sync.loading_config') });
      } finally {
        setLoading(false);
      }
    };

    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus?.isAuthenticated, userEmail, t]);

  // Listen for auth completion to update UI
  // Note: SyncLifecycleManager handles starting sync via the 'authenticated' event
  React.useEffect(() => {
    const offAuth =
      typeof window.api?.onAuthCompleted === 'function'
        ? window.api.onAuthCompleted(async (p) => {
            if (p.success) {
              // Show success message - sync will be triggered automatically by SyncLifecycleManager
              setMessage({
                type: 'success',
                text: t('sync.signin_success_sync_active'),
              });

              // Refresh settings view from storage
              Promise.all([
                window.api.settings.get('auth.serverUrl'),
                window.api.settings.get('syncEnabled'),
                window.api.settings.get('lastSyncTimestamp'),
              ])
                .then(([serverUrl, syncEnabled, lastSyncTimestamp]) => {
                  const updated: SyncSettings = {
                    enabled: Boolean(syncEnabled),
                    serverUrl: serverUrl || undefined,
                    lastSync: lastSyncTimestamp ? Number(lastSyncTimestamp) : undefined,
                  };
                  setSettings(updated);
                  setTempSettings(updated);
                  setHasUnsavedChanges(false);
                })
                .catch(() => {});

              // Refresh auth store to pick up new status and profile
              await refreshAuth();
            } else {
              setMessage({ type: 'error', text: p.error || t('sync.auth_failed') });
            }
          })
        : () => {
            /* noop */
          };
    return () => {
      try {
        offAuth();
      } catch {
        /* ignore */
      }
    };
  }, [t, refreshAuth]);

  // Handle enable/disable toggle with immediate persistence (Phase 4)
  const handleToggleSync = async (enabled: boolean) => {
    // Check if user is authenticated before allowing Remote Sync to be enabled
    if (enabled) {
      // Phase 3: Use hasValidAccessToken instead of hasValidToken
      if (!authStatus?.hasValidAccessToken) {
        setMessage({
          type: 'warning',
          text: t('sync.sign_in_required'),
        });
        return;
      }
    }

    // Phase 4: Implement immediate persistence for toggle
    // Store the previous state for rollback on error
    const previousSettings = { ...settings };

    // Optimistically update UI immediately
    const newTempSettings = { ...tempSettings, enabled };

    // If disabling, clear everything
    if (!enabled) {
      newTempSettings.serverUrl = undefined;
    }

    setTempSettings(newTempSettings);
    setSaving(true);
    setMessage(null);

    try {
      // Phase 4: Persist immediately to storage
      await window.api.settings.set('syncEnabled', enabled ? 'true' : 'false');

      // If disabling, also handle server URL and logout
      if (!enabled) {
        // Clear server URL from settings
        const serverUrl = await window.api.settings.get('auth.serverUrl');
        if (serverUrl) {
          await window.api.settings.set('auth.serverUrl', '');
        }

        // Proactively log out of online sync when disabling
        try {
          await window.api.auth.logout();
          await refreshAuth(); // Refresh auth store after logout
          setMessage({ type: 'info', text: t('sync.online_sync_disabled_signedout') });
        } catch (logoutErr) {
          console.warn('[ServerSettings] Logout after disable failed:', logoutErr);
          setMessage({ type: 'info', text: t('sync.online_sync_disabled') });
        }
      } else {
        setMessage({ type: 'success', text: t('sync.remote_sync_enabled') });
      }

      // Update the persisted settings state to match
      setSettings({ ...newTempSettings });
      setHasUnsavedChanges(false);

      console.log('[ServerSettings] Sync toggle persisted:', { enabled });
    } catch (error) {
      // Phase 4: Rollback on error - revert toggle to previous state
      console.error('[ServerSettings] Failed to persist sync toggle:', error);

      // Revert UI to previous state
      setTempSettings({ ...previousSettings });
      setSettings({ ...previousSettings });

      setMessage({
        type: 'error',
        text: `Failed to ${enabled ? 'enable' : 'disable'} sync. Please try again.`,
      });
    } finally {
      setSaving(false);
    }
  };

  // Save settings
  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      // Save sync settings directly to settings storage
      // Auth/sync decoupling: sync config no longer stores auth tokens or server URL
      await window.api.settings.set('syncEnabled', tempSettings.enabled ? 'true' : 'false');

      // Server URL is managed by auth service, not sync config
      if (tempSettings.serverUrl) {
        await window.api.settings.set('auth.serverUrl', tempSettings.serverUrl);
      }

      setSettings({ ...tempSettings });
      setHasUnsavedChanges(false);
      setMessage({ type: 'success', text: t('sync.settings_saved') });
    } catch (error) {
      console.error('Failed to save sync settings:', error);
      setMessage({ type: 'error', text: t('sync.settings_failed') });
    } finally {
      setSaving(false);
    }
  };

  // Reset to last saved settings
  const handleReset = () => {
    setTempSettings({ ...settings });
    setHasUnsavedChanges(false);
    setMessage(null);
  };

  if (loading) {
    return (
      <div className={styles.loadingRow}>
        <Spinner size="small" />
        <Text>{t('sync.loading_settings')}</Text>
      </div>
    );
  }

  const showStatusSection = tempSettings.enabled && authStatus?.isAuthenticated;

  // Determine provider name based on server URL
  const getProviderName = () => {
    if (!tempSettings.serverUrl) return t('sync.status.not_configured');
    return isNotelyService(tempSettings.serverUrl)
      ? t('sync.provider_notely')
      : t('sync.provider_custom');
  };

  const headerActions =
    hasUnsavedChanges || saving ? (
      <SettingsInlineActions>
        <Button appearance="primary" size="small" onClick={handleSave} disabled={saving}>
          {saving ? <Spinner size="tiny" /> : t('sync.save')}
        </Button>
        <Button appearance="secondary" size="small" onClick={handleReset} disabled={saving}>
          {t('common.close')}
        </Button>
      </SettingsInlineActions>
    ) : undefined;

  return (
    <SettingsTabLayout
      title={t('common.server')}
      description={t('sync.settings_summary')}
      actions={headerActions}
    >
      <SettingsSection
        title={t('sync.section_headers.remote_sync')}
        description={t('sync.remote_sync_description')}
      >
        <div className={styles.switchField}>
          <Field label={t('sync.enable_remote_sync')}>
            <Switch
              checked={tempSettings.enabled}
              onChange={(_, data) => handleToggleSync(data.checked)}
            />
          </Field>
        </div>
        {/* Phase 3: Use hasValidAccessToken instead of hasValidToken */}
        {!authStatus?.hasValidAccessToken && (
          <MessageBar intent="info" layout="multiline" className={styles.messageBar}>
            {t('sync.sign_in_required')}
          </MessageBar>
        )}
      </SettingsSection>

      {showStatusSection && (
        <SettingsSection
          title={t('sync.section_headers.status')}
          description={t('sync.status_description')}
        >
          <div className={styles.statusStack}>
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>{t('sync.provider_label')}</span>
              <Text>{getProviderName()}</Text>
            </div>
            {userEmail && (
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>{t('sync.account_label')}</span>
                <Text>{userEmail}</Text>
              </div>
            )}
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>{t('sync.status_label')}</span>
              <Text
                className={
                  syncStatus.state === 'synced' || syncStatus.state === 'ready'
                    ? styles.statusConnected
                    : styles.statusDisconnected
                }
              >
                {syncStatus.state === 'disabled' && t('sync.status_disabled')}
                {syncStatus.state === 'ready' && t('sync.status_ready')}
                {syncStatus.state === 'syncing' && t('sync.status_syncing')}
                {syncStatus.state === 'synced' && t('sync.status_synced')}
                {syncStatus.state === 'error' && (
                  <>
                    {t('sync.status_error')}
                    {syncStatus.error && ` (${syncStatus.error})`}
                    {syncStatus.retryInfo?.isRetrying && (
                      <span style={{ marginLeft: '8px', fontSize: '12px', opacity: 0.8 }}>
                        - Retrying: {syncStatus.retryInfo.attemptCount}/
                        {syncStatus.retryInfo.maxAttempts}
                      </span>
                    )}
                  </>
                )}
              </Text>
            </div>
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>{t('sync.last_sync')}</span>
              <Text>
                {syncStatus.lastSyncTime
                  ? new Date(syncStatus.lastSyncTime).toLocaleString()
                  : t('sync.never')}
              </Text>
            </div>
            {syncStatus.health && (
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>{t('sync.success_rate')}</span>
                <Text>{(syncStatus.health.successRate * 100).toFixed(1)}%</Text>
              </div>
            )}
          </div>
          <div className={styles.manualSync}>
            <Button
              appearance="secondary"
              disabled={syncStatus.state === 'syncing' || !authStatus?.hasValidAccessToken}
              onClick={async () => {
                setMessage({ type: 'info', text: t('sync.status.syncing') });

                console.log('=== SYNC DEBUG: Manual sync initiated ===');

                try {
                  const preStatus = await window.api.sync.getStatus();
                  console.log('[SYNC DEBUG] Manual sync pre-status:', preStatus);

                  const serverUrl = await window.api.settings.get('auth.serverUrl');
                  const syncEnabled = await window.api.settings.get('syncEnabled');
                  console.log('[SYNC DEBUG] Manual sync config:', { serverUrl, syncEnabled });

                  console.log('[SYNC DEBUG] Manual sync: Calling push (single sync operation)...');
                  const startTime = Date.now();

                  // Fixed: Call push() only once (it internally calls performSync which does both push and pull)
                  const syncResult = await window.api.sync.push();

                  const endTime = Date.now();
                  console.log(
                    `[SYNC DEBUG] Manual sync operation completed in ${endTime - startTime}ms`
                  );
                  console.log(
                    '[SYNC DEBUG] Manual sync result:',
                    JSON.stringify(syncResult, null, 2)
                  );

                  // Phase 2: Check if sync operation succeeded
                  if (syncResult?.success === false) {
                    // Sync failed - show error message with details
                    const errorMsg = syncResult?.error || t('sync.sync_operation_failed');
                    const userMsg = syncResult?.message || errorMsg;

                    console.error('[SYNC DEBUG] Manual sync failed:', {
                      error: syncResult?.error,
                    });

                    setMessage({
                      type: 'error',
                      text: userMsg,
                    });

                    // Don't update timestamps or refresh auth on failure
                    return;
                  }

                  // Operation succeeded
                  const totalChanges = syncResult.processed || 0;
                  console.log('[SYNC DEBUG] Manual sync total changes:', totalChanges);

                  setMessage({
                    type: 'success',
                    text:
                      totalChanges > 0
                        ? t('sync.sync_complete', { count: totalChanges })
                        : t('sync.data_up_to_date'),
                  });

                  // Phase 3: Refresh both auth and sync status after sync
                  await Promise.all([refreshAuth(), refreshSyncStatus()]);
                  console.log('[SYNC DEBUG] Manual sync completed, auth and sync status refreshed');
                } catch (err) {
                  console.error('=== SYNC DEBUG: Manual sync failed ===');
                  console.error('[SYNC DEBUG] Manual sync error details:', err);
                  console.error('[SYNC DEBUG] Manual sync error stack:', err?.stack);
                  setMessage({
                    type: 'error',
                    text: err?.message || t('sync.sync_failed_retry'),
                  });
                }

                console.log('=== SYNC DEBUG: Manual sync completed ===');
              }}
            >
              {syncStatus.state === 'syncing' ? (
                <>
                  <Spinner size="tiny" /> {t('sync.status.syncing')}
                </>
              ) : (
                t('sync.manual_sync')
              )}
            </Button>
          </div>
        </SettingsSection>
      )}
    </SettingsTabLayout>
  );
};
