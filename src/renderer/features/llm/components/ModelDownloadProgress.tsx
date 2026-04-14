import { Button, ProgressBar, Text } from '@fluentui/react-components';
import { Dismiss16Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import {
  useAllDownloads as useAllDownloadsHook,
  useModelDownload,
} from '../hooks/useModelDownload';

import styles from './ModelDownloadProgress.module.css';

interface ModelDownloadProgressProps {
  modelId: string;
  modelName?: string;
  onCancel?: () => void;
}

/**
 * Component that shows download progress for a model.
 */
export const ModelDownloadProgress: React.FC<ModelDownloadProgressProps> = ({
  modelId,
  modelName,
  onCancel,
}) => {
  const { t } = useTranslation();
  const { isDownloading, progress, error, percentage, speed, eta, cancel } =
    useModelDownload(modelId);

  const handleCancel = React.useCallback(() => {
    cancel();
    onCancel?.();
  }, [cancel, onCancel]);

  if (!isDownloading && !error) {
    return null;
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatETA = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  };

  return (
    <div className={`${styles.container} ${error ? styles.hasError : ''}`}>
      <div className={styles.header}>
        <div className={styles.info}>
          <Text weight="semibold" size={200}>
            {modelName ?? modelId}
          </Text>
          {error ? (
            <Text size={100} className={styles.errorText}>
              {error}
            </Text>
          ) : (
            <Text size={100} className={styles.stats}>
              {progress
                ? `${formatBytes(progress.bytesDownloaded)} / ${formatBytes(progress.totalBytes)}`
                : t('llm.download.starting', { defaultValue: 'Starting...' })}
              {speed > 0 && ` \u2022 ${formatSpeed(speed)}`}
              {eta > 0 && ` \u2022 ${formatETA(eta)} remaining`}
            </Text>
          )}
        </div>
        <Button
          appearance="subtle"
          size="small"
          icon={<Dismiss16Regular />}
          onClick={handleCancel}
          className={styles.cancelButton}
          title={t('common.cancel')}
        />
      </div>

      {isDownloading && (
        <ProgressBar value={percentage / 100} className={styles.progress} shape="rounded" />
      )}
    </div>
  );
};

/**
 * Shows all active downloads in a list.
 */
export const ActiveDownloadsList: React.FC = () => {
  const { t } = useTranslation();
  const { downloads, hasActiveDownloads } = useAllDownloadsHook();

  if (!hasActiveDownloads) {
    return null;
  }

  return (
    <div className={styles.list}>
      <Text weight="semibold" size={200} className={styles.listTitle}>
        {t('llm.download.active', { defaultValue: 'Active Downloads' })}
      </Text>
      {downloads.map((download) => (
        <ModelDownloadProgress key={download.modelId} modelId={download.modelId} />
      ))}
    </div>
  );
};
