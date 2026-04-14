import { Button, Text } from '@fluentui/react-components';
import { FolderOpen20Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { useLLMStore } from '../model/llm.store';

import styles from './StorageOverview.module.css';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export const StorageOverview: React.FC = () => {
  const { t } = useTranslation();
  const diskUsage = useLLMStore((state) => state.diskUsage);
  const openModelsDirectory = useLLMStore((state) => state.openModelsDirectory);

  if (!diskUsage) return null;

  return (
    <div className={styles.container}>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <Text className={styles.statValue}>{diskUsage.modelCount}</Text>
          <Text size={200}>
            {t('llm.storage.models', {
              defaultValue: diskUsage.modelCount === 1 ? 'model' : 'models',
            })}
          </Text>
        </div>
        <Text size={200} className={styles.separator}>
          &middot;
        </Text>
        <div className={styles.stat}>
          <Text className={styles.statValue}>{formatBytes(diskUsage.totalBytes)}</Text>
          <Text size={200}>{t('llm.storage.used', { defaultValue: 'used' })}</Text>
        </div>
      </div>

      <div className={styles.pathRow}>
        <Text size={200} className={styles.pathLabel}>
          {t('llm.storage.directory', { defaultValue: 'Directory:' })}
        </Text>
        <Button
          size="small"
          appearance="subtle"
          icon={<FolderOpen20Regular />}
          onClick={() => openModelsDirectory()}
          className={styles.folderButton}
          title={diskUsage.modelsDir}
        />
        <Text size={200} className={styles.pathValue} title={diskUsage.modelsDir}>
          {diskUsage.modelsDir}
        </Text>
      </div>

      <Text size={200} className={styles.hint}>
        {t('llm.storage.hint', {
          defaultValue: 'Place .gguf model files in this directory to use them.',
        })}
      </Text>
    </div>
  );
};
