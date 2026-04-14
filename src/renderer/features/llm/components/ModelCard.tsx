import { Button, Badge, Spinner, Text } from '@fluentui/react-components';
import {
  ArrowDownload20Regular,
  Delete20Regular,
  Play20Regular,
  Stop20Regular,
  LockClosed16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import type { ModelCatalogEntry } from '../../../../preload/index';
import {
  formatVRAM,
  useModelCompatibility,
  useGPUInfo,
  getVramBarColor,
} from '../hooks/useGPUInfo';
import { useModelDownload } from '../hooks/useModelDownload';

import styles from './ModelCard.module.css';
import { ModelDownloadProgress } from './ModelDownloadProgress';

export interface ModelCardProps {
  model: ModelCatalogEntry;
  downloadedModelIds: Set<string>;
  loadedModelInfo: { id: string; name: string; size: string; vramRequired: number } | null;
  loadingModelId: string | null;
  defaultModelId: string | null;
  isLoadingModel: boolean;
  hasHuggingFaceToken: boolean;
  catalogHealth?: Record<string, boolean>;
  isRecommended?: boolean;
  onLoad: (modelId: string) => void;
  onUnload: () => void;
  onDownload: (modelId: string) => void;
  onSetDefault: (modelId: string) => void;
  onDelete: (modelId: string) => void;
}

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  downloadedModelIds,
  loadedModelInfo,
  loadingModelId,
  defaultModelId,
  isLoadingModel,
  hasHuggingFaceToken,
  catalogHealth,
  isRecommended = false,
  onLoad,
  onUnload,
  onDownload,
  onSetDefault,
  onDelete,
}) => {
  const { t } = useTranslation();
  const { isCompatible, reason, vramUsagePercent } = useModelCompatibility(model);
  const { vramMB } = useGPUInfo();
  const { isDownloading, progress } = useModelDownload(model.id);
  const isDownloaded = downloadedModelIds.has(model.id);
  const isLoaded = loadedModelInfo?.id === model.id;
  const isLoading = loadingModelId === model.id;
  const isDefault = defaultModelId === model.id;
  const isCustom = model.isCustom === true;
  const isHealthy = catalogHealth ? catalogHealth[model.id] !== false : true;
  const i18nKey = `llm.models.${model.id.replace(/\./g, '_')}`;

  return (
    <div className={`${styles.modelCard} ${!isCompatible && !isCustom ? styles.incompatible : ''}`}>
      <div className={styles.modelHeader}>
        {isDownloaded && (
          <Button
            className={styles.deleteButton}
            appearance="subtle"
            icon={<Delete20Regular />}
            onClick={() => onDelete(model.id)}
            disabled={isLoaded}
          />
        )}
        <div className={styles.modelInfo}>
          <div className={styles.modelName}>
            {model.requiresAuth && <LockClosed16Regular className={styles.lockIcon} />}
            <Text weight="semibold">{model.name}</Text>
            {isLoaded && (
              <Badge appearance="filled" color="success" size="small">
                {t('llm.settings.loaded', { defaultValue: 'Loaded' })}
              </Badge>
            )}
            {isDefault && !isLoaded && (
              <Badge appearance="outline" size="small">
                {t('llm.settings.default', { defaultValue: 'Default' })}
              </Badge>
            )}
            {isDownloaded && !isLoaded && !isDefault && (
              <Badge appearance="outline" color="success" size="small">
                {t('llm.settings.downloaded', { defaultValue: 'Downloaded' })}
              </Badge>
            )}
            {isCustom && (
              <Badge
                appearance="tint"
                color="informative"
                size="small"
                className={styles.customBadge}
              >
                {t('llm.settings.custom', { defaultValue: 'Custom' })}
              </Badge>
            )}
            {isRecommended && (
              <Badge
                appearance="filled"
                color="success"
                size="small"
                className={styles.recommendedBadge}
              >
                {t('llm.settings.recommended', { defaultValue: 'Recommended for your GPU' })}
              </Badge>
            )}
          </div>
          <Text size={200} className={styles.modelDescription}>
            {isCustom ? model.description : t(i18nKey)}
          </Text>
        </div>
      </div>

      <div className={styles.modelStats}>
        <div className={styles.modelStat}>
          <Text size={100} className={styles.statLabel}>
            Size
          </Text>
          <Text size={200}>{model.size}</Text>
        </div>
        <div className={styles.modelStat}>
          <Text size={100} className={styles.statLabel}>
            Quality
          </Text>
          <Text size={200} className={styles.quality}>
            {model.quality.charAt(0).toUpperCase() + model.quality.slice(1)}
          </Text>
        </div>
      </div>

      {model.vramRequired > 0 && vramMB > 0 && (
        <div className={styles.vramBarContainer}>
          <div className={styles.vramBarTopRow}>
            <Text size={100} className={styles.systemVramValue}>
              {formatVRAM(vramMB)}
            </Text>
          </div>
          <div className={styles.vramBar}>
            <div
              className={`${styles.vramBarFill} ${styles[`vramBar_${getVramBarColor(vramUsagePercent)}`]}`}
              style={{ width: `${Math.min(vramUsagePercent, 100)}%` }}
            />
            <div className={styles.vramBarMark} style={{ left: '25%' }}>
              <span className={styles.vramBarMarkLabel}>25%</span>
            </div>
            <div className={styles.vramBarMark} style={{ left: '50%' }}>
              <span className={styles.vramBarMarkLabel}>50%</span>
            </div>
            <div className={styles.vramBarMark} style={{ left: '75%' }}>
              <span className={styles.vramBarMarkLabel}>75%</span>
            </div>
          </div>
          <div className={styles.vramBarBottomRow}>
            <Text size={100} className={styles.vramBarLabel}>
              {formatVRAM(model.vramRequired)} ({vramUsagePercent}%)
            </Text>
            <Text size={100} className={styles.systemVramLabel}>
              System VRAM
            </Text>
          </div>
        </div>
      )}

      {!isCompatible && !isCustom && (
        <Text size={100} className={styles.compatWarning}>
          {reason}
        </Text>
      )}

      {!isHealthy && !isCustom && (
        <div className={styles.healthWarning}>
          <Warning16Regular className={styles.healthWarningIcon} />
          <Text size={100}>
            {t('llm.settings.health_warning', {
              defaultValue: 'Download source may be unavailable',
            })}
          </Text>
        </div>
      )}

      {isDownloading && progress && (
        <ModelDownloadProgress modelId={model.id} modelName={model.name} />
      )}

      <div className={styles.modelActions}>
        {isDownloaded ? (
          <>
            {!isDefault && isDownloaded && (
              <Button appearance="subtle" onClick={() => onSetDefault(model.id)}>
                {t('llm.settings.set_default', { defaultValue: 'Set Default' })}
              </Button>
            )}
            {isLoaded ? (
              <Button
                appearance="subtle"
                icon={<Stop20Regular />}
                onClick={() => onUnload()}
                disabled={isLoadingModel}
              >
                {t('llm.settings.unload', { defaultValue: 'Unload' })}
              </Button>
            ) : (
              <Button
                appearance="primary"
                icon={isLoading ? <Spinner size="tiny" /> : <Play20Regular />}
                onClick={() => onLoad(model.id)}
                disabled={isLoadingModel || (!isCustom && !isCompatible)}
              >
                {isLoading
                  ? t('llm.settings.loading', { defaultValue: 'Loading...' })
                  : t('llm.settings.load', { defaultValue: 'Load' })}
              </Button>
            )}
          </>
        ) : (
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowDownload20Regular />}
            onClick={() => onDownload(model.id)}
            disabled={
              isDownloading ||
              (!isCustom && !isCompatible) ||
              (model.requiresAuth && !hasHuggingFaceToken)
            }
          >
            {model.requiresAuth && !hasHuggingFaceToken
              ? t('llm.settings.requires_auth', { defaultValue: 'Requires HF Token' })
              : t('llm.settings.download', { defaultValue: 'Download' })}
          </Button>
        )}
      </div>
    </div>
  );
};
