import {
  Button,
  Spinner,
  Text,
  Badge,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@fluentui/react-components';
import {
  Stop20Regular,
  ArrowClockwise20Regular,
  ArrowReset20Regular,
  Brain20Regular,
} from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import type { ModelCatalogEntry } from '../../../../preload/index';
import { useFeature } from '../../../shared/components/FeatureGate';
import { LicenseActivationFlow } from '../../license/components/LicenseActivationFlow';
import { CustomModelImport } from '../../llm/components/CustomModelImport';
import { GPUInfoPanel } from '../../llm/components/GPUInfoPanel';
import { HuggingFaceTokenSection } from '../../llm/components/HuggingFaceTokenSection';
import { ModelCard } from '../../llm/components/ModelCard';
import { ModelDownloadProgress } from '../../llm/components/ModelDownloadProgress';
import { PromptEditor } from '../../llm/components/PromptEditor';
import { StorageOverview } from '../../llm/components/StorageOverview';
import { useGPUInfo, formatVRAM } from '../../llm/hooks/useGPUInfo';
import { useLLMStatus } from '../../llm/hooks/useLLMStatus';
import { useAllDownloads } from '../../llm/hooks/useModelDownload';
import { useLLMStore } from '../../llm/model/llm.store';

import styles from './AIModelSettings.module.css';
import { SettingsSection, SettingsTabLayout } from './SettingsTabLayout';

// Feature flag for local AI - must be present in license to access this panel
const LOCAL_AI_FEATURE = 'local-ai';

/**
 * License-gated AI Model settings panel.
 * Users must have a valid 'local-ai' feature in their license to access this panel.
 */
export const AIModelSettings: React.FC = () => {
  const { t } = useTranslation();

  // License check - must have 'local-ai' feature to access this panel
  const hasLocalAIFeature = useFeature(LOCAL_AI_FEATURE);

  // All hooks must be called before any conditional returns
  const {
    modelLoaded,
    loadedModelInfo,
    isLoadingModel,
    loadingModelId,
    serverStatus,
    defaultModelId,
    lastError,
    loadModel,
    unloadModel,
    startServer,
    refresh,
    isInitialized,
  } = useLLMStatus();

  const { isSupported, recommendedModelId } = useGPUInfo();
  const { hasActiveDownloads, downloads } = useAllDownloads();

  const availableModels = useLLMStore((state) => state.availableModels);
  const downloadedModels = useLLMStore((state) => state.downloadedModels);
  const hasHuggingFaceToken = useLLMStore((state) => state.hasHuggingFaceToken);
  const catalogHealth = useLLMStore((state) => state.catalogHealth);
  const initialize = useLLMStore((state) => state.initialize);
  const setDefaultModel = useLLMStore((state) => state.setDefaultModel);
  const downloadModel = useLLMStore((state) => state.downloadModel);
  const deleteModel = useLLMStore((state) => state.deleteModel);
  const removeCustomModel = useLLMStore((state) => state.removeCustomModel);
  const refreshModels = useLLMStore((state) => state.refreshModels);
  const resetToDefaults = useLLMStore((state) => state.resetToDefaults);

  // Local state
  const [showPromptEditor, setShowPromptEditor] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<string | null>(null);

  // Initialize store
  React.useEffect(() => {
    if (!isInitialized) {
      void initialize();
    }
  }, [isInitialized, initialize]);

  // Separate catalog models by VRAM range and custom models
  const vramGroups = React.useMemo(() => {
    const groups: { label: string; key: string; models: ModelCatalogEntry[] }[] = [
      { label: 'Under 4 GB', key: 'under4', models: [] },
      { label: '4 \u2013 8 GB', key: '4to8', models: [] },
      { label: '8 \u2013 12 GB', key: '8to12', models: [] },
      { label: '12+ GB', key: '12plus', models: [] },
    ];
    const custom: ModelCatalogEntry[] = [];

    availableModels.forEach((model) => {
      if (model.isCustom) {
        custom.push(model);
        return;
      }
      const vramMB = model.vramRequired;
      if (vramMB < 4096) {
        groups[0].models.push(model);
      } else if (vramMB < 8192) {
        groups[1].models.push(model);
      } else if (vramMB < 12288) {
        groups[2].models.push(model);
      } else {
        groups[3].models.push(model);
      }
    });

    // Also add any downloaded custom models that aren't yet in availableModels
    const customIds = new Set(custom.map((m) => m.id));
    downloadedModels.forEach((dm) => {
      if (dm.catalogEntry?.isCustom && !customIds.has(dm.id) && dm.catalogEntry) {
        custom.push(dm.catalogEntry);
      }
    });

    return { groups, customModels: custom };
  }, [availableModels, downloadedModels]);

  const { groups: modelGroups, customModels } = vramGroups;

  // Get downloaded model IDs
  const downloadedModelIds = React.useMemo(
    () => new Set(downloadedModels.map((m) => m.id)),
    [downloadedModels]
  );

  // Handle model download
  const handleDownload = React.useCallback(
    async (modelId: string) => {
      try {
        await downloadModel(modelId);
      } catch (error) {
        console.error('Failed to start download:', error);
      }
    },
    [downloadModel]
  );

  // Handle model deletion
  const handleDelete = React.useCallback(
    async (modelId: string) => {
      try {
        // Check if this is a custom model
        const model = availableModels.find((m) => m.id === modelId);
        if (model?.isCustom) {
          await removeCustomModel(modelId);
        } else {
          await deleteModel(modelId);
        }
        setShowDeleteConfirm(null);
      } catch (error) {
        console.error('Failed to delete model:', error);
      }
    },
    [deleteModel, removeCustomModel, availableModels]
  );

  // Handle loading a model
  const handleLoadModel = React.useCallback(
    async (modelId: string) => {
      try {
        if (serverStatus === 'stopped' || serverStatus === 'error') {
          await startServer();
        }
        await loadModel(modelId);
      } catch (error) {
        console.error('Failed to load model:', error);
      }
    },
    [serverStatus, startServer, loadModel]
  );

  // Handle refresh (includes directory re-scan)
  const handleRefresh = React.useCallback(async () => {
    await refreshModels();
    await refresh();
  }, [refreshModels, refresh]);

  // Handle reset (restore all settings to built-in defaults)
  const handleReset = React.useCallback(async () => {
    await resetToDefaults();
  }, [resetToDefaults]);

  // State for license activation flow (used when feature not enabled)
  const [showActivationFlow, setShowActivationFlow] = React.useState(false);

  // Show license required message if feature not enabled
  if (!hasLocalAIFeature) {
    return (
      <SettingsTabLayout
        title={t('llm.settings.title', { defaultValue: 'AI Model' })}
        description={t('llm.settings.description', {
          defaultValue: 'Configure local AI models for generating meeting summaries.',
        })}
      >
        <SettingsSection
          title={t('llm.license.required_title', { defaultValue: 'License Required' })}
          description={t('llm.license.required_desc', {
            defaultValue: 'Access to local AI models requires a valid license.',
          })}
        >
          <div className={styles.licenseRequired}>
            <div>
              <Text weight="semibold">
                {t('llm.license.activate_title', { defaultValue: 'Activate Your License' })}
              </Text>
              <Text size={200} className={styles.licenseText}>
                {t('llm.license.activate_desc', {
                  defaultValue:
                    'To unlock full local AI capabilities, please activate your Notely AI license.',
                })}
              </Text>
              <div className={styles.licenseButtons}>
                <Button appearance="primary" onClick={() => setShowActivationFlow(true)}>
                  {t('settings.activation.activate', { defaultValue: 'Activate' })}
                </Button>
                <Button
                  appearance="secondary"
                  onClick={() => window.api.window.openExternal('https://yourdomain.com/ai/purchase')}
                >
                  {t('settings.activation.purchase', { defaultValue: 'Purchase' })}
                </Button>
              </div>
            </div>
          </div>
        </SettingsSection>

        <LicenseActivationFlow open={showActivationFlow} onOpenChange={setShowActivationFlow} />
      </SettingsTabLayout>
    );
  }

  return (
    <SettingsTabLayout
      title={t('llm.settings.title', { defaultValue: 'AI Model' })}
      description={t('llm.settings.description', {
        defaultValue: 'Configure local AI models for generating meeting summaries.',
      })}
      actions={
        <>
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowReset20Regular />}
            onClick={() => handleReset()}
          >
            {t('common.reset', { defaultValue: 'Reset' })}
          </Button>
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowClockwise20Regular />}
            onClick={() => handleRefresh()}
          >
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </>
      }
    >
      {/* 1. Storage Overview */}
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

      {/* 2. GPU Information */}
      <SettingsSection
        title={t('llm.settings.gpu', { defaultValue: 'GPU Information' })}
        description={t('llm.settings.gpu_desc', {
          defaultValue: 'Your GPU determines which AI models can run efficiently.',
        })}
      >
        <GPUInfoPanel />
      </SettingsSection>

      {/* 3. Current Model Status */}
      {isSupported && (
        <SettingsSection
          title={t('llm.settings.current_model', { defaultValue: 'Current Model' })}
          description={t('llm.settings.current_model_desc', {
            defaultValue: 'The AI model currently loaded in memory.',
          })}
          action={
            modelLoaded && (
              <Button
                size="small"
                appearance="subtle"
                icon={<Stop20Regular />}
                onClick={() => unloadModel()}
                disabled={isLoadingModel}
              >
                {t('llm.settings.unload', { defaultValue: 'Unload' })}
              </Button>
            )
          }
        >
          {modelLoaded && loadedModelInfo ? (
            <div className={styles.currentModel}>
              <div className={styles.currentModelInfo}>
                <Brain20Regular className={styles.currentModelIcon} />
                <div>
                  <Text weight="semibold">{loadedModelInfo.name}</Text>
                  <Text size={200} className={styles.currentModelStats}>
                    {loadedModelInfo.size} • {formatVRAM(loadedModelInfo.vramRequired)} VRAM
                  </Text>
                </div>
              </div>
              <Badge appearance="filled" color="success">
                {t('llm.settings.ready', { defaultValue: 'Ready' })}
              </Badge>
            </div>
          ) : isLoadingModel ? (
            <div className={styles.loadingState}>
              <Spinner size="small" />
              <Text>{t('llm.settings.loading_model', { defaultValue: 'Loading model...' })}</Text>
            </div>
          ) : (
            <Text className={styles.noModel}>
              {t('llm.settings.no_model', {
                defaultValue: 'No model loaded. Select a model below to load it.',
              })}
            </Text>
          )}

          {lastError && (
            <Text size={200} className={styles.errorText}>
              {lastError}
            </Text>
          )}
        </SettingsSection>
      )}

      {/* 4. HuggingFace Account (elevated from bottom) */}
      {isSupported && (
        <SettingsSection
          title={t('llm.settings.huggingface', { defaultValue: 'HuggingFace Account' })}
          description={t('llm.settings.huggingface_desc', {
            defaultValue:
              'Some models require a HuggingFace account to download. Configure your token before browsing models.',
          })}
        >
          <HuggingFaceTokenSection />
        </SettingsSection>
      )}

      {/* 5. Download from HuggingFace */}
      {isSupported && (
        <SettingsSection
          title={t('llm.settings.custom_import', {
            defaultValue: 'Download from HuggingFace',
          })}
          description={t('llm.settings.custom_import_desc', {
            defaultValue: 'Paste a HuggingFace URL to download a custom GGUF model.',
          })}
        >
          <CustomModelImport />
        </SettingsSection>
      )}

      {/* 6. Model Library */}
      {isSupported && (
        <SettingsSection
          title={t('llm.settings.model_library', { defaultValue: 'Model Library' })}
          description={t('llm.settings.model_library_desc', {
            defaultValue: 'Browse and manage models grouped by VRAM requirements.',
          })}
        >
          {/* Active Downloads */}
          {hasActiveDownloads && (
            <div className={styles.activeDownloads}>
              <Text weight="semibold" size={200}>
                {t('llm.settings.downloading', { defaultValue: 'Downloading' })}
              </Text>
              {downloads.map((d) => (
                <ModelDownloadProgress key={d.modelId} modelId={d.modelId} />
              ))}
            </div>
          )}

          {/* Custom Models Subsection */}
          {customModels.length > 0 && (
            <div className={styles.tierSection}>
              <div className={styles.tierHeader}>
                <Text weight="semibold">
                  {t('llm.settings.custom_models', { defaultValue: 'Custom Models' })}
                </Text>
              </div>
              <div className={styles.modelList}>
                {customModels.map((model) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    downloadedModelIds={downloadedModelIds}
                    loadedModelInfo={loadedModelInfo}
                    loadingModelId={loadingModelId}
                    defaultModelId={defaultModelId}
                    isLoadingModel={isLoadingModel}
                    hasHuggingFaceToken={hasHuggingFaceToken}
                    catalogHealth={catalogHealth}
                    onLoad={handleLoadModel}
                    onUnload={unloadModel}
                    onDownload={handleDownload}
                    onSetDefault={setDefaultModel}
                    onDelete={(id) => setShowDeleteConfirm(id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Catalog Models by VRAM Range */}
          {modelGroups.map((group) => {
            if (group.models.length === 0) return null;

            return (
              <div key={group.key} className={styles.tierSection}>
                <div className={styles.tierHeader}>
                  <Text weight="semibold">{group.label}</Text>
                </div>
                <div className={styles.modelList}>
                  {group.models.map((model) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      downloadedModelIds={downloadedModelIds}
                      loadedModelInfo={loadedModelInfo}
                      loadingModelId={loadingModelId}
                      defaultModelId={defaultModelId}
                      isLoadingModel={isLoadingModel}
                      hasHuggingFaceToken={hasHuggingFaceToken}
                      catalogHealth={catalogHealth}
                      isRecommended={model.id === recommendedModelId}
                      onLoad={handleLoadModel}
                      onUnload={unloadModel}
                      onDownload={handleDownload}
                      onSetDefault={setDefaultModel}
                      onDelete={(id) => setShowDeleteConfirm(id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </SettingsSection>
      )}

      {/* 7. Prompt Customization */}
      {isSupported && (
        <SettingsSection
          title={t('llm.settings.prompts', { defaultValue: 'Prompt Customization' })}
          description={t('llm.settings.prompts_desc', {
            defaultValue: 'Customize how the AI processes and summarizes your transcripts.',
          })}
        >
          <Button onClick={() => setShowPromptEditor(true)}>
            {t('llm.settings.edit_prompts', { defaultValue: 'Edit Prompts' })}
          </Button>
        </SettingsSection>
      )}

      {/* Prompt Editor Dialog */}
      <Dialog open={showPromptEditor} onOpenChange={(_, data) => setShowPromptEditor(data.open)}>
        <DialogSurface className={styles.promptEditorDialog}>
          <DialogBody>
            <PromptEditor onClose={() => setShowPromptEditor(false)} />
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={showDeleteConfirm !== null}
        onOpenChange={(_, data) => !data.open && setShowDeleteConfirm(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {t('llm.settings.delete_title', { defaultValue: 'Delete Model?' })}
            </DialogTitle>
            <DialogContent>
              <Text>
                {t('llm.settings.delete_confirm', {
                  defaultValue:
                    'This will remove the model file from your device. You can download it again later.',
                })}
              </Text>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setShowDeleteConfirm(null)}>
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                appearance="primary"
                onClick={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
              >
                {t('common.delete', { defaultValue: 'Delete' })}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </SettingsTabLayout>
  );
};
