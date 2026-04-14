import { Button, Checkbox, Text, Badge } from '@fluentui/react-components';
import { Delete20Regular, Play20Regular, Stop20Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import type { DownloadedModel } from '../../../../preload/index';

import styles from './AIFeatures.module.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface DownloadedModelsListProps {
  downloadedModels: DownloadedModel[];
  defaultModelId: string | null;
  loadedModelId: string | null;
  isLoadingModel: boolean;
  onLoad: (modelId: string) => void;
  onUnload: () => void;
  onDelete: (modelIds: string[]) => void;
}

export const DownloadedModelsList: React.FC<DownloadedModelsListProps> = ({
  downloadedModels,
  defaultModelId,
  loadedModelId,
  isLoadingModel,
  onLoad,
  onUnload,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  if (downloadedModels.length === 0) return null;

  // Sort: default model first, then by name
  const sorted = [...downloadedModels].sort((a, b) => {
    if (a.id === defaultModelId) return -1;
    if (b.id === defaultModelId) return 1;
    return (a.catalogEntry?.name ?? a.id).localeCompare(b.catalogEntry?.name ?? b.id);
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map((m) => m.id)));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size > 0) {
      onDelete(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  };

  return (
    <div className={styles.downloadedModelsSection}>
      <div className={styles.downloadedModelsHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Checkbox
            checked={
              selectedIds.size === sorted.length && sorted.length > 0
                ? true
                : selectedIds.size > 0
                  ? 'mixed'
                  : false
            }
            onChange={toggleAll}
          />
          <Text weight="semibold" size={200}>
            {t('llm.downloaded_models', { defaultValue: 'Currently Downloaded Models' })}
          </Text>
        </div>
        {selectedIds.size > 0 && (
          <Button
            size="small"
            appearance="subtle"
            icon={<Delete20Regular />}
            onClick={handleDeleteSelected}
          >
            {t('llm.delete_selected', {
              defaultValue: `Delete Selected (${selectedIds.size})`,
              count: selectedIds.size,
            })}
          </Button>
        )}
      </div>

      {sorted.map((model) => {
        const isDefault = model.id === defaultModelId;
        const isLoaded = model.id === loadedModelId;
        const name = model.catalogEntry?.name ?? model.id;

        return (
          <div
            key={model.id}
            className={`${styles.downloadedModelRow} ${isDefault ? styles.downloadedModelDefault : ''}`}
          >
            <Checkbox checked={selectedIds.has(model.id)} onChange={() => toggleSelect(model.id)} />
            <div className={styles.downloadedModelInfo}>
              <Text size={300} className={styles.downloadedModelName}>
                {name}
              </Text>
              <Text size={200} className={styles.downloadedModelSize}>
                {formatBytes(model.sizeBytes)}
              </Text>
              {isDefault && (
                <Badge appearance="outline" color="success" size="small">
                  Default
                </Badge>
              )}
              {isLoaded && (
                <Badge appearance="filled" color="success" size="small">
                  Loaded
                </Badge>
              )}
            </div>
            <div className={styles.downloadedModelActions}>
              {isLoaded ? (
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Stop20Regular />}
                  onClick={onUnload}
                  disabled={isLoadingModel}
                >
                  {t('llm.unload', { defaultValue: 'Unload' })}
                </Button>
              ) : (
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Play20Regular />}
                  onClick={() => onLoad(model.id)}
                  disabled={isLoadingModel}
                >
                  {t('llm.load', { defaultValue: 'Load' })}
                </Button>
              )}
              <Button
                size="small"
                appearance="subtle"
                icon={<Delete20Regular />}
                onClick={() => onDelete([model.id])}
                disabled={isLoaded}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
