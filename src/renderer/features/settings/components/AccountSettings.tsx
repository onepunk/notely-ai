import {
  Button,
  Dropdown,
  Field,
  MessageBar,
  Option,
  Spinner,
  Text,
} from '@fluentui/react-components';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_API_URL, isNotelyService } from '../../../../common/config';
import { useAuthStore } from '../../../shared/hooks/useAuthStore';
import { useSettingsStore } from '../../../shared/state/settings.store';
import { EntityCounts, MergeSyncPrompt } from '../../sync/MergeSyncPrompt';

import styles from './AccountSettings.module.css';
import { SettingsCard, SettingsSection, SettingsTabLayout } from './SettingsTabLayout';

const LANGUAGE_KEY = 'app.locale';
const LAST_SYNCED_SERVER_KEY = 'sync.lastSyncedServerUrl';

/**
 * Normalizes a server URL for comparison.
 * Strips trailing slashes and converts hostname to lowercase.
 */
const normalizeServerUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    // Normalize: lowercase hostname, remove trailing slash, keep port if present
    let normalized = `${parsed.protocol}//${parsed.hostname.toLowerCase()}`;
    if (parsed.port) {
      normalized += `:${parsed.port}`;
    }
    // Add pathname without trailing slash (unless it's just "/")
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (pathname && pathname !== '/') {
      normalized += pathname;
    }
    return normalized;
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
};

/**
 * Formats the server URL for display.
 * Returns "Notely Cloud" for official service, or the hostname:port for custom servers.
 */
const formatServerDisplay = (url: string, t: (key: string) => string): string => {
  if (isNotelyService(url)) {
    return t('settings.account.notely_cloud');
  }
  try {
    const parsed = new URL(url);
    // Include port if non-standard (not 443 or 80)
    if (parsed.port && parsed.port !== '443' && parsed.port !== '80') {
      return `${parsed.hostname}:${parsed.port}`;
    }
    return parsed.hostname;
  } catch {
    return t('settings.account.custom_server');
  }
};

const LANGUAGE_OPTIONS = [
  { value: 'en', labelKey: 'settings.profile.languages.english' },
  { value: 'es', labelKey: 'settings.profile.languages.spanish' },
  { value: 'fr', labelKey: 'settings.profile.languages.french' },
  { value: 'de', labelKey: 'settings.profile.languages.german' },
  { value: 'zh', labelKey: 'settings.profile.languages.chinese' },
] as const;

type ProfileResponse = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type SyncProvider = 'notely' | 'custom';

type InlineMessage = {
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
};

export const AccountSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const localeFromStore = useSettingsStore((s) => s.values[LANGUAGE_KEY]);
  const setValue = useSettingsStore((s) => s.setValue);

  // Profile state
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [locale, setLocale] = React.useState<string>(
    localeFromStore ?? i18n.language ?? LANGUAGE_OPTIONS[0].value
  );
  const [initialLoad, setInitialLoad] = React.useState(true);
  const [savingLanguage, setSavingLanguage] = React.useState(false);
  const [languageDirty, setLanguageDirty] = React.useState(false);
  const [languageSuccess, setLanguageSuccess] = React.useState<string | null>(null);
  const [languageError, setLanguageError] = React.useState<string | null>(null);

  // Auth state
  const { authStatus, profile, refreshAuth } = useAuthStore();
  const isAuthenticated = authStatus?.isAuthenticated ?? false;
  const userEmail = profile?.email ?? null;

  const [accountProvider, setAccountProvider] = React.useState<SyncProvider>('notely');
  const [accountServerUrl, setAccountServerUrl] = React.useState<string>(DEFAULT_API_URL);
  const [authStarting, setAuthStarting] = React.useState(false);
  const [accountMessage, setAccountMessage] = React.useState<InlineMessage | null>(null);

  // Merge prompt state
  const [showMergePrompt, setShowMergePrompt] = React.useState(false);
  const [mergeLoading, setMergeLoading] = React.useState(false);
  const [localCounts, setLocalCounts] = React.useState<EntityCounts | null>(null);
  const [serverCounts, setServerCounts] = React.useState<EntityCounts | null>(null);

  const loadProfile = React.useCallback(async () => {
    try {
      const profileData: ProfileResponse | null = await window.api.user.getProfile();
      setFirstName(profileData?.first_name ?? '');
      setLastName(profileData?.last_name ?? '');
      setEmail(profileData?.email ?? '');
    } catch (err) {
      console.error('Failed to load profile', err);
    } finally {
      setInitialLoad(false);
    }
  }, []);

  React.useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  React.useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    if (typeof window.api?.onProfileChanged === 'function') {
      // Type assertion needed due to incorrect type definition in preload/index.ts
      unsubscribe = (window.api.onProfileChanged as (cb: () => void) => () => void)(() => {
        void loadProfile();
      });
    }

    return () => {
      try {
        unsubscribe?.();
      } catch {
        /* ignore */
      }
    };
  }, [loadProfile]);

  React.useEffect(() => {
    const nextLocale = localeFromStore ?? i18n.language ?? LANGUAGE_OPTIONS[0].value;
    setLocale(nextLocale);
  }, [localeFromStore, i18n.language]);

  // Initialize account provider from settings on mount
  React.useEffect(() => {
    const loadServerUrl = async () => {
      try {
        const serverUrl = await window.api.settings.get('auth.serverUrl');
        setAccountProvider(isNotelyService(serverUrl || '') ? 'notely' : 'custom');
        setAccountServerUrl(serverUrl || DEFAULT_API_URL);
      } catch (error) {
        console.error('Failed to load server URL:', error);
      }
    };
    void loadServerUrl();
  }, []);

  // Helper to check if user has an active license that allows sync
  const checkLicenseForSync = React.useCallback(async (): Promise<boolean> => {
    try {
      const license = await window.api.license.getCurrent();
      // Allow sync for active or expiring licenses
      return license?.status === 'active' || license?.status === 'expiring';
    } catch {
      return false;
    }
  }, []);

  // Helper to perform sync directly without showing the merge prompt
  const performDirectSync = React.useCallback(
    async (currentServerUrl: string) => {
      // Check license before attempting sync
      const canSync = await checkLicenseForSync();
      if (!canSync) {
        // User is unlicensed - don't attempt sync, just show success
        setAccountMessage({ type: 'success', text: t('settings.account.signin_success') });
        setTimeout(() => setAccountMessage(null), 5000);
        return;
      }

      setAccountMessage({ type: 'info', text: t('sync.sync_starting') });
      try {
        await window.api.sync.push();
        // Save the server URL after successful sync
        await window.api.settings.set(LAST_SYNCED_SERVER_KEY, currentServerUrl);
        setAccountMessage({ type: 'success', text: t('settings.account.signin_success') });
        setTimeout(() => setAccountMessage(null), 5000);
      } catch (error) {
        console.error('Sync failed:', error);
        setAccountMessage({
          type: 'warning',
          text: t('settings.account.signin_sync_failed'),
        });
        setTimeout(() => setAccountMessage(null), 8000);
      }
    },
    [checkLicenseForSync, t]
  );

  // Listen for auth:completed events
  React.useEffect(() => {
    const offAuth =
      typeof window.api?.onAuthCompleted === 'function'
        ? window.api.onAuthCompleted(async (p) => {
            if (p.success) {
              setAuthStarting(false);
              await refreshAuth();

              // Check if user has a license that allows sync
              const canSync = await checkLicenseForSync();
              if (!canSync) {
                // User is unlicensed - just show success, no sync needed
                setAccountMessage({ type: 'success', text: t('settings.account.signin_success') });
                setTimeout(() => setAccountMessage(null), 5000);
                return;
              }

              // Get the current server URL
              const currentServerUrl =
                (await window.api.settings.get('auth.serverUrl')) || DEFAULT_API_URL;

              // Check if this is a server change
              const lastSyncedServerUrl = await window.api.settings.get(LAST_SYNCED_SERVER_KEY);

              const isFirstSync = !lastSyncedServerUrl;
              const isSameServer =
                lastSyncedServerUrl &&
                normalizeServerUrl(lastSyncedServerUrl) === normalizeServerUrl(currentServerUrl);

              if (isFirstSync || isSameServer) {
                // First time sync or same server - skip prompt, sync directly
                await performDirectSync(currentServerUrl);
              } else {
                // Different server - show merge prompt with note counts
                setMergeLoading(true);
                setShowMergePrompt(true);

                try {
                  // Get local note count
                  const notes = await window.api.storage.listAllNotes();
                  const binders = await window.api.storage.listBinders();
                  setLocalCounts({
                    notes: notes?.length ?? 0,
                    binders: binders?.length ?? 0,
                    transcriptions: 0,
                    summaries: 0,
                    total: (notes?.length ?? 0) + (binders?.length ?? 0),
                  });

                  // Get server note count
                  const serverResult = await window.api.sync.getServerStats();
                  if (serverResult.success && serverResult.data) {
                    setServerCounts(serverResult.data as EntityCounts);
                  } else {
                    setServerCounts({
                      notes: 0,
                      binders: 0,
                      transcriptions: 0,
                      summaries: 0,
                      total: 0,
                    });
                  }
                } catch (error) {
                  console.error('Failed to fetch note counts:', error);
                  setLocalCounts({
                    notes: 0,
                    binders: 0,
                    transcriptions: 0,
                    summaries: 0,
                    total: 0,
                  });
                  setServerCounts({
                    notes: 0,
                    binders: 0,
                    transcriptions: 0,
                    summaries: 0,
                    total: 0,
                  });
                } finally {
                  setMergeLoading(false);
                }
              }
            } else {
              setAccountMessage({ type: 'error', text: p.error || t('sync.auth_failed') });
              setAuthStarting(false);
            }
          })
        : () => {};
    return () => {
      try {
        offAuth();
      } catch {
        /* ignore */
      }
    };
  }, [refreshAuth, performDirectSync, checkLicenseForSync, t]);

  // Handle merge confirmation
  const handleMergeConfirm = React.useCallback(async () => {
    setShowMergePrompt(false);

    // Check license before attempting sync
    const canSync = await checkLicenseForSync();
    if (!canSync) {
      // User is unlicensed - don't attempt sync, just show success
      setAccountMessage({ type: 'success', text: t('settings.account.signin_success') });
      setTimeout(() => setAccountMessage(null), 5000);
      return;
    }

    setAccountMessage({ type: 'info', text: t('sync.sync_starting') });

    try {
      // Trigger sync
      await window.api.sync.push();

      // Save the server URL after successful sync
      const currentServerUrl = (await window.api.settings.get('auth.serverUrl')) || DEFAULT_API_URL;
      await window.api.settings.set(LAST_SYNCED_SERVER_KEY, currentServerUrl);

      setAccountMessage({ type: 'success', text: t('settings.account.signin_success') });
      setTimeout(() => setAccountMessage(null), 5000);
    } catch (error) {
      console.error('Sync failed:', error);
      setAccountMessage({
        type: 'warning',
        text: t('settings.account.signin_sync_failed'),
      });
      setTimeout(() => setAccountMessage(null), 8000);
    }
  }, [checkLicenseForSync, t]);

  // Handle merge cancel (logout)
  const handleMergeCancel = React.useCallback(async () => {
    setShowMergePrompt(false);
    try {
      await window.api.auth.logout();
      await refreshAuth();
      setAccountMessage({ type: 'info', text: t('settings.account.signin_cancelled') });
      setTimeout(() => setAccountMessage(null), 5000);
    } catch {
      // Ignore logout errors
    }
  }, [refreshAuth, t]);

  const handleLanguageChange = React.useCallback(
    (newLocale: string) => {
      if (newLocale === locale) return;
      setLanguageSuccess(null);
      setLanguageError(null);
      setLanguageDirty(true);
      setLocale(newLocale);
    },
    [locale]
  );

  const handleSaveLanguage = React.useCallback(async () => {
    if (savingLanguage) return;
    setSavingLanguage(true);
    setLanguageError(null);
    setLanguageSuccess(null);

    try {
      await setValue(LANGUAGE_KEY, locale);
      await i18n.changeLanguage(locale);
      setLanguageSuccess(t('settings.profile.language_save_success'));
      setLanguageDirty(false);
    } catch (err) {
      console.error('Failed to save language preference', err);
      setLanguageError(t('settings.profile.language_save_error'));
    } finally {
      setSavingLanguage(false);
    }
  }, [i18n, locale, savingLanguage, setValue, t]);

  const handleProviderChange = (provider: SyncProvider) => {
    setAccountProvider(provider);
    setAccountServerUrl(provider === 'notely' ? DEFAULT_API_URL : '');
    setAccountMessage(null);
  };

  const handlePopupSignIn = async () => {
    setAccountMessage(null);

    const effectiveServerUrl =
      accountProvider === 'notely' ? DEFAULT_API_URL : accountServerUrl?.trim();

    if (!effectiveServerUrl) {
      setAccountMessage({ type: 'warning', text: t('settings.account.server_url_required') });
      return;
    }

    try {
      setAuthStarting(true);
      setAccountMessage({ type: 'info', text: t('settings.account.opening_signin') });
      await window.api.settings.set('auth.serverUrl', effectiveServerUrl);
      const opened = await window.api.auth.startWebLogin();
      setAuthStarting(false);

      if (!opened) {
        setAccountMessage({ type: 'error', text: t('settings.account.signin_window_failed') });
      } else {
        setAccountMessage({ type: 'info', text: t('settings.account.complete_signin_popup') });
      }
    } catch (error) {
      console.error('Opening sign-in window failed:', error);
      setAccountMessage({ type: 'error', text: t('settings.account.signin_window_error') });
      setAuthStarting(false);
    }
  };

  const handleLogout = async () => {
    try {
      const res = await window.api.auth.logout();
      if (!res.success) {
        setAccountMessage({ type: 'error', text: res.error || 'Sign out failed' });
        return;
      }
      setAccountMessage({ type: 'info', text: 'Signed out successfully.' });
      await refreshAuth();
      setTimeout(() => setAccountMessage(null), 5000);
    } catch {
      setAccountMessage({ type: 'error', text: 'Sign out failed' });
    }
  };

  const selectedLanguageLabel = React.useMemo(() => {
    const entry = LANGUAGE_OPTIONS.find((option) => option.value === locale);
    return entry ? t(entry.labelKey) : locale;
  }, [locale, t]);

  const displayName = React.useMemo(() => {
    const parts = [firstName, lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  }, [firstName, lastName]);

  return (
    <SettingsTabLayout
      title={t('settings.account.title')}
      description={t('settings.account.layout_description')}
    >
      {/* Sign-in Section */}
      <SettingsSection
        title={t('settings.account.signin_title')}
        description={t('settings.account.signin_description')}
      >
        {accountMessage && (
          <MessageBar intent={accountMessage.type} className={styles.messageBar}>
            {accountMessage.text}
          </MessageBar>
        )}

        {isAuthenticated ? (
          <div className={styles.authenticatedCard}>
            <div className={styles.userInfo}>
              <div className={styles.avatar}>
                {(displayName || userEmail || 'U').charAt(0).toUpperCase()}
              </div>
              <div className={styles.userDetails}>
                {displayName && (
                  <Text weight="semibold" className={styles.userName}>
                    {displayName}
                  </Text>
                )}
                {userEmail && <Text className={styles.userEmail}>{userEmail}</Text>}
                <Text size={200} className={styles.providerLabel}>
                  {formatServerDisplay(accountServerUrl, t)}
                </Text>
              </div>
            </div>
            <Button appearance="secondary" onClick={handleLogout}>
              {t('common.sign_out')}
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.providerSelector}>
              <button
                type="button"
                className={`${styles.providerOption} ${accountProvider === 'notely' ? styles.providerSelected : ''}`}
                onClick={() => handleProviderChange('notely')}
              >
                <span className={styles.providerName}>{t('settings.account.notely_cloud')}</span>
                <span className={styles.providerDesc}>
                  {t('settings.account.official_cloud_service')}
                </span>
              </button>
              <button
                type="button"
                className={`${styles.providerOption} ${accountProvider === 'custom' ? styles.providerSelected : ''}`}
                onClick={() => handleProviderChange('custom')}
              >
                <span className={styles.providerName}>{t('settings.account.custom_server')}</span>
                <span className={styles.providerDesc}>
                  {t('settings.account.self_hosted_instance')}
                </span>
              </button>
            </div>

            {accountProvider === 'custom' && (
              <Field label={t('settings.account.server_url')} className={styles.serverUrlField}>
                <input
                  type="text"
                  value={accountServerUrl}
                  onChange={(e) => setAccountServerUrl(e.target.value)}
                  placeholder={t('settings.account.server_url_placeholder')}
                  className={styles.serverUrlInput}
                />
              </Field>
            )}

            <Button
              appearance="primary"
              onClick={handlePopupSignIn}
              disabled={authStarting}
              className={styles.signInButton}
            >
              {authStarting ? (
                <span className={styles.buttonWithSpinner}>
                  <Spinner size="tiny" />
                  <span>{t('settings.account.signing_in')}</span>
                </span>
              ) : (
                t('common.sign_in')
              )}
            </Button>
          </>
        )}
      </SettingsSection>

      {/* Profile Information */}
      <SettingsSection
        title={t('settings.account.profile_title')}
        description={t('settings.account.profile_description')}
      >
        <SettingsCard
          title={t('settings.account.personal_info')}
          description={t('settings.account.personal_info_desc')}
        >
          {initialLoad ? (
            <div className={styles.loadingRow}>
              <Spinner size="small" />
              <Text>{t('settings.profile.loading')}</Text>
            </div>
          ) : (
            <div className={styles.profileGrid}>
              <div className={styles.profileField}>
                <Text size={200} className={styles.fieldLabel}>
                  {t('settings.profile.first_name')}
                </Text>
                <Text>{firstName || '—'}</Text>
              </div>
              <div className={styles.profileField}>
                <Text size={200} className={styles.fieldLabel}>
                  {t('settings.profile.last_name')}
                </Text>
                <Text>{lastName || '—'}</Text>
              </div>
              <div className={styles.profileField}>
                <Text size={200} className={styles.fieldLabel}>
                  {t('settings.profile.email')}
                </Text>
                <Text>{email || '—'}</Text>
              </div>
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      {/* Language Preference */}
      <SettingsSection
        title={t('settings.account.language_title')}
        description={t('settings.account.language_description')}
      >
        <div className={styles.languageRow}>
          <Dropdown
            selectedOptions={[locale]}
            value={selectedLanguageLabel}
            disabled={savingLanguage}
            onOptionSelect={(_, data) => {
              if (typeof data.optionValue === 'string') {
                handleLanguageChange(data.optionValue);
              }
            }}
            className={styles.languageDropdown}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <Option key={option.value} value={option.value} text={t(option.labelKey)}>
                {t(option.labelKey)}
              </Option>
            ))}
          </Dropdown>

          {languageDirty && (
            <Button
              appearance="primary"
              size="small"
              onClick={handleSaveLanguage}
              disabled={savingLanguage}
            >
              {savingLanguage ? t('common.saving') : t('common.save')}
            </Button>
          )}
        </div>

        {languageSuccess && (
          <Text size={200} className={styles.successText}>
            {languageSuccess}
          </Text>
        )}
        {languageError && (
          <Text size={200} className={styles.errorText}>
            {languageError}
          </Text>
        )}
      </SettingsSection>

      {/* Merge Sync Prompt Dialog */}
      <MergeSyncPrompt
        open={showMergePrompt}
        serverUrl={accountServerUrl}
        localCounts={localCounts}
        serverCounts={serverCounts}
        loading={mergeLoading}
        onConfirm={handleMergeConfirm}
        onCancel={handleMergeCancel}
      />
    </SettingsTabLayout>
  );
};
