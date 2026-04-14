import { Button, Spinner, Text } from '@fluentui/react-components';
import {
  ArrowExportUp20Regular,
  ArrowSync20Regular,
  Checkmark20Regular,
} from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import type { UpdateInfo } from '../../../../preload/index';
import { useLicense } from '../../../shared/hooks/useLicense';

import styles from './AboutSettings.module.css';
import { SettingsSection, SettingsTabLayout } from './SettingsTabLayout';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error';
type DiagnosticsStatus = 'idle' | 'exporting' | 'success' | 'error';

export const AboutSettings: React.FC = () => {
  const { t } = useTranslation();
  const { license } = useLicense();
  const [appVersion, setAppVersion] = React.useState<string>(
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
  );
  const [updateStatus, setUpdateStatus] = React.useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = React.useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = React.useState<string | null>(null);

  const [diagStatus, setDiagStatus] = React.useState<DiagnosticsStatus>('idle');
  const [diagError, setDiagError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Fetch app version when component mounts
    const fetchVersion = async () => {
      try {
        if (typeof window.api?.getVersion === 'function') {
          console.log('About: Calling getVersion API');
          const version = await window.api.getVersion();
          console.log('About: Received version:', version);
          setAppVersion((prev) => version || prev);
        } else {
          console.warn('About: getVersion API not available');
          // Fallback to compile-time version if available
          setAppVersion((prev) =>
            typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : prev
          );
        }
      } catch (error) {
        console.warn('Failed to get app version:', error);
        // Preserve whatever version we have (likely compile-time)
      }
    };
    void fetchVersion();
  }, []);

  const handleCheckForUpdates = React.useCallback(async () => {
    setUpdateStatus('checking');
    setUpdateError(null);
    setUpdateInfo(null);

    try {
      // Force a fresh check by passing true
      const result = await window.api?.update?.check?.(true);

      if (result?.success && result.data) {
        setUpdateInfo(result.data);
        if (result.data.updateAvailable) {
          setUpdateStatus('available');
        } else {
          setUpdateStatus('up-to-date');
        }
      } else {
        setUpdateStatus('error');
        setUpdateError(result?.error || t('about.update_check_failed'));
      }
    } catch (error) {
      setUpdateStatus('error');
      setUpdateError(error instanceof Error ? error.message : t('about.update_check_failed'));
    }
  }, [t]);

  const handleDownloadUpdate = React.useCallback(async () => {
    try {
      await window.api?.update?.openDownload?.();
    } catch (error) {
      console.error('Failed to open download:', error);
    }
  }, []);

  const handleExportDiagnostics = React.useCallback(async () => {
    setDiagStatus('exporting');
    setDiagError(null);

    try {
      const result = await window.api?.diagnostics?.export?.();

      if (result?.success) {
        setDiagStatus('success');
      } else {
        // User cancelled the save dialog
        if (result?.error === 'Export cancelled') {
          setDiagStatus('idle');
          return;
        }
        setDiagStatus('error');
        setDiagError(result?.error || t('about.diagnostics_export_failed'));
      }
    } catch (error) {
      setDiagStatus('error');
      setDiagError(error instanceof Error ? error.message : t('about.diagnostics_export_failed'));
    }
  }, [t]);

  return (
    <SettingsTabLayout title={t('common.about')} description={t('about.description')}>
      <SettingsSection
        title={t('about.overview_title')}
        description={t('about.overview_description')}
      >
        <div className={styles.infoStack}>
          <span className={styles.name}>{t('about.app_name')}</span>
          <span className={styles.meta}>{t('about.version', { version: appVersion })}</span>
          <span className={styles.meta}>
            {license.status === 'active' ? 'Notely AI' : 'Unlicensed'}
          </span>
          <span className={styles.meta}>{t('about.website')}</span>
        </div>
      </SettingsSection>

      <div className={styles.twoColGrid}>
        <SettingsSection
          title={t('about.updates_title')}
          description={t('about.updates_description')}
        >
          <div className={styles.updateSection}>
            <Button
              appearance="secondary"
              size="small"
              icon={updateStatus === 'checking' ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
              onClick={handleCheckForUpdates}
              disabled={updateStatus === 'checking'}
            >
              {updateStatus === 'checking'
                ? t('about.checking_updates')
                : t('about.check_for_updates')}
            </Button>

            {updateStatus === 'up-to-date' && (
              <div className={styles.updateResult}>
                <Checkmark20Regular className={styles.successIcon} />
                <Text size={200} className={styles.successText}>
                  {t('about.up_to_date')}
                </Text>
              </div>
            )}

            {updateStatus === 'available' && updateInfo && (
              <div className={styles.updateAvailable}>
                <Text size={200} weight="semibold">
                  {t('about.update_available', { version: updateInfo.latestVersion })}
                </Text>
                {updateInfo.releaseNotes && (
                  <Text size={200} className={styles.releaseNotes}>
                    {updateInfo.releaseNotes}
                  </Text>
                )}
                <Button appearance="primary" size="small" onClick={handleDownloadUpdate}>
                  {t('about.download_update')}
                </Button>
              </div>
            )}

            {updateStatus === 'error' && updateError && (
              <Text size={200} className={styles.errorText}>
                {updateError}
              </Text>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title={t('about.diagnostics_title')}
          description={t('about.diagnostics_description')}
        >
          <div className={styles.updateSection}>
            <Button
              appearance="secondary"
              size="small"
              icon={
                diagStatus === 'exporting' ? <Spinner size="tiny" /> : <ArrowExportUp20Regular />
              }
              onClick={handleExportDiagnostics}
              disabled={diagStatus === 'exporting'}
            >
              {diagStatus === 'exporting'
                ? t('about.exporting_diagnostics')
                : t('about.export_diagnostics')}
            </Button>

            {diagStatus === 'success' && (
              <div className={styles.updateResult}>
                <Checkmark20Regular className={styles.successIcon} />
                <Text size={200} className={styles.successText}>
                  {t('about.diagnostics_exported')}
                </Text>
              </div>
            )}

            {diagStatus === 'error' && diagError && (
              <Text size={200} className={styles.errorText}>
                {diagError}
              </Text>
            )}
          </div>
        </SettingsSection>
      </div>
    </SettingsTabLayout>
  );
};
