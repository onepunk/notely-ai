/**
 * Activation Settings
 *
 * License activation UI for Notely AI standalone desktop client.
 * Supports na- license activation with email binding and offline grace periods.
 */

import { Button, MessageBar, Spinner, Text } from '@fluentui/react-components';
import { Key20Regular, Mail20Regular, Warning20Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { useLicense } from '../../../shared/hooks/useLicense';
import { LicenseActivationFlow } from '../../license/components/LicenseActivationFlow';

import styles from './ActivationSettings.module.css';
import { SettingsSection, SettingsTabLayout } from './SettingsTabLayout';

interface ActivationDetails {
  activationId: string;
  email: string;
  activatedAt: string;
  offlineGraceDeadline: string | null;
  nextRequiredValidation: string | null;
}

export const ActivationSettings: React.FC = () => {
  const { t } = useTranslation();
  const { license, loading: licenseLoading, refresh: refreshLicense } = useLicense();

  const [activationDetails, setActivationDetails] = React.useState<ActivationDetails | null>(null);
  const [isActivated, setIsActivated] = React.useState(false);
  const [loadingDetails, setLoadingDetails] = React.useState(true);
  const [showActivationFlow, setShowActivationFlow] = React.useState(false);
  const [deactivating, setDeactivating] = React.useState(false);
  const [message, setMessage] = React.useState<{
    type: 'success' | 'error' | 'info' | 'warning';
    text: string;
  } | null>(null);

  // Load activation details on mount
  const loadActivationDetails = React.useCallback(async () => {
    try {
      setLoadingDetails(true);
      // Check if activated first
      if (window.api?.license?.isActivated) {
        const activated = await window.api.license.isActivated();
        setIsActivated(activated);

        if (activated && window.api?.license?.getActivationDetails) {
          const details = await window.api.license.getActivationDetails();
          setActivationDetails(details);
        } else {
          setActivationDetails(null);
        }
      }
    } catch (err) {
      console.error('Failed to load activation details:', err);
      setIsActivated(false);
      setActivationDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  React.useEffect(() => {
    void loadActivationDetails();
  }, [loadActivationDetails]);

  // Refresh both license and activation details
  const handleRefresh = async () => {
    setMessage(null);
    await Promise.all([refreshLicense(), loadActivationDetails()]);
    setMessage({ type: 'info', text: t('settings.activation.status_refreshed') });
    setTimeout(() => setMessage(null), 3000);
  };

  // Handle activation flow completion
  const handleActivationComplete = async () => {
    await Promise.all([refreshLicense(), loadActivationDetails()]);
    setMessage({ type: 'success', text: t('settings.activation.activation_success') });
  };

  // Handle deactivation
  const handleDeactivate = async () => {
    if (!window.api?.license?.deactivate) {
      setMessage({ type: 'error', text: 'Deactivation not available' });
      return;
    }

    setDeactivating(true);
    setMessage(null);

    try {
      const success = await window.api.license.deactivate();
      if (success) {
        await Promise.all([refreshLicense(), loadActivationDetails()]);
        setMessage({ type: 'info', text: t('settings.activation.deactivation_success') });
      } else {
        setMessage({
          type: 'error',
          text: t('settings.activation.deactivation_failed'),
        });
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : t('settings.activation.deactivation_failed'),
      });
    } finally {
      setDeactivating(false);
    }
  };

  // Format date for display
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { dateStyle: 'long' });
  };

  const isExpired = license.status === 'expired';

  return (
    <SettingsTabLayout
      title={t('settings.activation.title')}
      description={t('settings.activation.description')}
    >
      {message && (
        <MessageBar intent={message.type} className={styles.messageBar}>
          {message.text}
        </MessageBar>
      )}

      {/* Activation Status Section */}
      <SettingsSection
        title={t('settings.activation.status_title')}
        description={t('settings.activation.status_description')}
      >
        {loadingDetails || licenseLoading ? (
          <div className={styles.loadingRow}>
            <Spinner size="small" />
            <Text>{t('settings.activation.loading')}</Text>
          </div>
        ) : isActivated ? (
          <div className={styles.statusCard}>
            <div className={styles.detailsGrid}>
              <div className={styles.detailRow}>
                <Mail20Regular className={styles.detailIcon} />
                <div className={styles.detailContent}>
                  <Text size={200} className={styles.detailLabel}>
                    {t('settings.activation.email_label')}
                  </Text>
                  <Text>{activationDetails?.email || '—'}</Text>
                </div>
              </div>

              <div className={styles.detailRow}>
                <Key20Regular className={styles.detailIcon} />
                <div className={styles.detailContent}>
                  <Text size={200} className={styles.detailLabel}>
                    {t('settings.activation.activated_on')}
                  </Text>
                  <Text>{formatDate(activationDetails?.activatedAt ?? null)}</Text>
                </div>
              </div>

              {license.expiresAt && (
                <div className={styles.detailRow}>
                  <Warning20Regular className={styles.detailIcon} />
                  <div className={styles.detailContent}>
                    <Text size={200} className={styles.detailLabel}>
                      {t('settings.activation.license_expires')}
                    </Text>
                    <Text>
                      {formatDate(license.expiresAt)}
                      {license.daysRemaining !== null && license.daysRemaining > 0 && (
                        <span className={styles.daysRemaining}>
                          {' '}
                          ({license.daysRemaining} {t('settings.activation.days_remaining')})
                        </span>
                      )}
                    </Text>
                  </div>
                </div>
              )}
            </div>

            {/* Features - always show "All" for notely-ai tier (single license unlocks everything) */}
            {license.status === 'active' && (
              <div className={styles.featuresSection}>
                <Text size={200} className={styles.sectionLabel}>
                  {t('settings.activation.features_label')}
                </Text>
                <div className={styles.featureList}>
                  <span className={styles.featureTag}>
                    {t('settings.activation.all_features', { defaultValue: 'All' })}
                  </span>
                </div>
              </div>
            )}

            <div className={styles.actionRow}>
              <Button appearance="secondary" onClick={handleRefresh} disabled={loadingDetails}>
                {t('settings.activation.refresh_status')}
              </Button>
              <Button
                appearance="secondary"
                onClick={handleDeactivate}
                disabled={deactivating}
                className={styles.deactivateButton}
              >
                {deactivating
                  ? t('settings.activation.deactivating')
                  : t('settings.activation.deactivate')}
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.notActivatedCard}>
            <Text weight="semibold" className={styles.statusTitle}>
              {isExpired
                ? t('settings.activation.status_expired')
                : t('settings.activation.status_not_activated')}
            </Text>
            <Text size={200} className={styles.statusSubtitle}>
              {isExpired
                ? t('settings.activation.expired_description')
                : t('settings.activation.not_activated_description')}
            </Text>

            <div className={styles.buttonRow}>
              <Button
                appearance="primary"
                onClick={() => setShowActivationFlow(true)}
                className={styles.activateButton}
              >
                {t('settings.activation.activate')}
              </Button>
              <Button
                appearance="secondary"
                onClick={() => window.api.window.openExternal('https://yourdomain.com/ai/purchase')}
              >
                {t('settings.activation.purchase')}
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>

      {/* Activation Flow Dialog */}
      <LicenseActivationFlow
        open={showActivationFlow}
        onOpenChange={setShowActivationFlow}
        onActivationComplete={handleActivationComplete}
      />
    </SettingsTabLayout>
  );
};
