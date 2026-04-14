import { Text, Badge } from '@fluentui/react-components';
import { Checkmark16Filled, Warning16Filled, Dismiss16Filled } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { useGPUInfo, formatVRAM } from '../hooks/useGPUInfo';

import styles from './GPUInfoPanel.module.css';

interface GPUInfoPanelProps {
  compact?: boolean;
}

/**
 * Panel that displays GPU information and capabilities.
 */
export const GPUInfoPanel: React.FC<GPUInfoPanelProps> = ({ compact = false }) => {
  const { t } = useTranslation();
  const {
    gpuInfo,
    gpuName,
    vendor,
    vramMB,
    vramBudgetGB,
    isSupported,
    notSupportedReason,
    backends,
    performanceOK,
    warnings,
    isLoading,
  } = useGPUInfo();

  if (isLoading) {
    return (
      <div className={styles.container}>
        <Text size={200} className={styles.loading}>
          {t('llm.gpu.detecting', { defaultValue: 'Detecting GPU...' })}
        </Text>
      </div>
    );
  }

  const StatusIcon = isSupported
    ? performanceOK
      ? Checkmark16Filled
      : Warning16Filled
    : Dismiss16Filled;

  const statusColor = isSupported ? (performanceOK ? 'success' : 'warning') : 'danger';

  const statusText = isSupported
    ? performanceOK
      ? t('llm.gpu.compatible', { defaultValue: 'Compatible' })
      : t('llm.gpu.limited', { defaultValue: 'Limited' })
    : t('llm.gpu.not_supported', { defaultValue: 'Not Supported' });

  if (compact) {
    return (
      <div className={styles.compact}>
        <div className={styles.compactHeader}>
          <StatusIcon className={styles[statusColor]} />
          <Text weight="semibold" size={200}>
            {gpuName}
          </Text>
        </div>
        <Text size={100} className={styles.compactStats}>
          {formatVRAM(vramMB)} VRAM {'\u2022'} {vramBudgetGB} GB budget
        </Text>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <Text weight="semibold" className={styles.gpuName}>
            {gpuName}
          </Text>
          <Badge
            appearance="filled"
            color={statusColor}
            icon={<StatusIcon />}
            className={styles.badge}
          >
            {statusText}
          </Badge>
        </div>
      </div>

      {!isSupported && (
        <div className={styles.errorBox}>
          <Dismiss16Filled className={styles.danger} />
          <Text size={200}>{notSupportedReason}</Text>
        </div>
      )}

      <div className={styles.stats}>
        <div className={styles.statRow}>
          <Text size={200} className={styles.statLabel}>
            {t('llm.gpu.vendor', { defaultValue: 'Vendor' })}
          </Text>
          <Text size={200} className={styles.statValue}>
            {vendor.charAt(0).toUpperCase() + vendor.slice(1)}
          </Text>
        </div>
        <div className={styles.statRow}>
          <Text size={200} className={styles.statLabel}>
            {t('llm.gpu.vram', { defaultValue: 'VRAM' })}
          </Text>
          <Text size={200} className={styles.statValue}>
            {formatVRAM(vramMB)}
          </Text>
        </div>
        {isSupported && backends.length > 0 && (
          <div className={styles.statRow}>
            <Text size={200} className={styles.statLabel}>
              {t('llm.gpu.backend', { defaultValue: 'Compute Backend' })}
            </Text>
            <Text size={200} className={styles.statValue}>
              {backends.map((b) => b.toUpperCase()).join(', ')}
            </Text>
          </div>
        )}
        {isSupported && gpuInfo?.driverVersion && (
          <div className={styles.statRow}>
            <Text size={200} className={styles.statLabel}>
              {t('llm.gpu.driver', { defaultValue: 'Driver Version' })}
            </Text>
            <Text size={200} className={styles.statValue}>
              {gpuInfo.driverVersion}
            </Text>
          </div>
        )}
        {isSupported && gpuInfo?.computeCapability && (
          <div className={styles.statRow}>
            <Text size={200} className={styles.statLabel}>
              {t('llm.gpu.compute', { defaultValue: 'Compute Capability' })}
            </Text>
            <Text size={200} className={styles.statValue}>
              {gpuInfo.computeCapability}
            </Text>
          </div>
        )}
        {isSupported && gpuInfo?.cudaVersion && (
          <div className={styles.statRow}>
            <Text size={200} className={styles.statLabel}>
              {t('llm.gpu.cuda', { defaultValue: 'CUDA Version' })}
            </Text>
            <Text size={200} className={styles.statValue}>
              {gpuInfo.cudaVersion}
            </Text>
          </div>
        )}
        {isSupported && gpuInfo?.metalVersion && (
          <div className={styles.statRow}>
            <Text size={200} className={styles.statLabel}>
              {t('llm.gpu.metal', { defaultValue: 'Metal Version' })}
            </Text>
            <Text size={200} className={styles.statValue}>
              {gpuInfo.metalVersion}
            </Text>
          </div>
        )}
        {isSupported && gpuInfo?.isDiscrete !== undefined && (
          <div className={styles.statRow}>
            <Text size={200} className={styles.statLabel}>
              {t('llm.gpu.type', { defaultValue: 'Type' })}
            </Text>
            <Text size={200} className={styles.statValue}>
              {gpuInfo.isDiscrete ? 'Discrete' : 'Integrated'}
            </Text>
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <div className={styles.warnings}>
          {warnings.map((warning, index) => (
            <div key={index} className={styles.warning}>
              <Warning16Filled className={styles.warningIcon} />
              <Text size={200}>{warning}</Text>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
