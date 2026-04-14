import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { GPUInfoPanel } from '../../llm/components/GPUInfoPanel';
import { StorageOverview } from '../../llm/components/StorageOverview';
import { useGPUInfo } from '../../llm/hooks/useGPUInfo';
import { SettingsSection, SettingsTabLayout } from '../../settings/components/SettingsTabLayout';

import styles from './SystemTab.module.css';

export const SystemTab: React.FC = () => {
  const { t } = useTranslation();
  const { isSupported } = useGPUInfo();

  return (
    <SettingsTabLayout
      title={t('llm.system.title', { defaultValue: 'System' })}
      description={t('llm.system.description', {
        defaultValue: 'GPU capabilities and storage information for local AI.',
      })}
    >
      <div className={styles.cardGrid}>
        <SettingsSection
          title={t('llm.settings.gpu', { defaultValue: 'GPU Information' })}
          description={t('llm.settings.gpu_desc', {
            defaultValue: 'Your GPU determines which AI models can run efficiently.',
          })}
        >
          <GPUInfoPanel />
        </SettingsSection>

        {isSupported && (
          <SettingsSection
            title={t('llm.settings.storage', { defaultValue: 'Storage Overview' })}
            description={t('llm.settings.storage_desc', {
              defaultValue: 'Disk space used by downloaded AI models.',
            })}
          >
            <StorageOverview />
          </SettingsSection>
        )}
      </div>
    </SettingsTabLayout>
  );
};
