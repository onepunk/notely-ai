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
import { Stop20Regular, ArrowClockwise20Regular, Brain20Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import type { ModelCatalogEntry } from '../../../../preload/index';
import { CustomModelImport } from '../../llm/components/CustomModelImport';
import { HuggingFaceTokenSection } from '../../llm/components/HuggingFaceTokenSection';
import { ModelCard } from '../../llm/components/ModelCard';
import { ModelDownloadProgress } from '../../llm/components/ModelDownloadProgress';
import { useGPUInfo, formatVRAM } from '../../llm/hooks/useGPUInfo';
import { useLLMStatus } from '../../llm/hooks/useLLMStatus';
import { useAllDownloads } from '../../llm/hooks/useModelDownload';
import { useLLMStore } from '../../llm/model/llm.store';
import { SettingsSection, SettingsTabLayout } from '../../settings/components/SettingsTabLayout';

import styles from './AIFeatures.module.css';
import { DownloadedModelsList } from './DownloadedModelsList';
import { TranscriptionModelManagement } from './TranscriptionModelManagement';

type SubTab = 'llm' | 'transcription';

export const ModelManagementTab: React.FC = () => {
  const { t } = useTranslation();

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

  const [subTab, setSubTab] = React.useState<SubTab>('llm');
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<string[] | null>(null);
  const [switchConfirmModelId, setSwitchConfirmModelId] = React.useState<string | null>(null);

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

    const customIds = new Set(custom.map((m) => m.id));
    downloadedModels.forEach((dm) => {
      if (dm.catalogEntry?.isCustom && !customIds.has(dm.id) && dm.catalogEntry) {
        custom.push(dm.catalogEntry);
      }
    });

    return { groups, customModels: custom };
  }, [availableModels, downloadedModels]);

  const { groups: modelGroups, customModels } = vramGroups;

  const downloadedModelIds = React.useMemo(
    () => new Set(downloadedModels.map((m) => m.id)),
    [downloadedModels]
  );

  // Get loaded model ID — prefer store's loadedModelId (set synchronously on load),
  // fall back to loadedModelInfo.id (set by event listener)
  const storeLoadedModelId = useLLMStore((state) => state.loadedModelId);
  const loadedModelId = modelLoaded ? (storeLoadedModelId ?? loadedModelInfo?.id ?? null) : null;

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

  const handleDelete = React.useCallback(
    async (modelIds: string[]) => {
      for (const modelId of modelIds) {
        try {
          const model = availableModels.find((m) => m.id === modelId);
          if (model?.isCustom) {
            await removeCustomModel(modelId);
          } else {
            await deleteModel(modelId);
          }
        } catch (error) {
          console.error('Failed to delete model:', error);
        }
      }
      setShowDeleteConfirm(null);
    },
    [deleteModel, removeCustomModel, availableModels]
  );

  const doLoadModel = React.useCallback(
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

  const handleLoadModel = React.useCallback(
    (modelId: string) => {
      if (modelLoaded && loadedModelId && loadedModelId !== modelId) {
        setSwitchConfirmModelId(modelId);
        return;
      }
      void doLoadModel(modelId);
    },
    [modelLoaded, loadedModelId, doLoadModel]
  );

  const handleRefresh = React.useCallback(async () => {
    await refreshModels();
    await refresh();
  }, [refreshModels, refresh]);

  return (
    <SettingsTabLayout
      title={t('llm.model_management.title', { defaultValue: 'Model Management' })}
      description={t('llm.model_management.description', {
        defaultValue: 'Download, load, and manage AI models.',
      })}
      actions={
        subTab === 'llm' ? (
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowClockwise20Regular />}
            onClick={() => handleRefresh()}
          >
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
        ) : undefined
      }
    >
      {/* Sub-tabs: LLM / Transcription */}
      <div className={styles.subTabs}>
        <button
          className={`${styles.subTab} ${subTab === 'llm' ? styles.subTabActive : ''}`}
          onClick={() => setSubTab('llm')}
        >
          LLM
        </button>
        <button
          className={`${styles.subTab} ${subTab === 'transcription' ? styles.subTabActive : ''}`}
          onClick={() => setSubTab('transcription')}
        >
          Transcription
        </button>
      </div>

      {subTab === 'transcription' && <TranscriptionModelManagement />}

      {/* 1. Currently Loaded Model */}
      {subTab === 'llm' && isSupported && (
        <SettingsSection
          title={t('llm.settings.current_model', { defaultValue: 'Currently Loaded Model' })}
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

      {/* 2. HuggingFace Account */}
      {subTab === 'llm' && isSupported && (
        <SettingsSection
          title={t('llm.settings.huggingface', { defaultValue: 'HuggingFace Account' })}
          description={t('llm.settings.huggingface_desc', {
            defaultValue: 'Some models require a HuggingFace account to download.',
          })}
        >
          <HuggingFaceTokenSection />
        </SettingsSection>
      )}

      {/* 3. Download from HuggingFace */}
      {subTab === 'llm' && isSupported && (
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

      {/* 4. Model Library */}
      {subTab === 'llm' && isSupported && (
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

          {/* Downloaded Models */}
          <DownloadedModelsList
            downloadedModels={downloadedModels}
            defaultModelId={defaultModelId}
            loadedModelId={loadedModelId}
            isLoadingModel={isLoadingModel}
            onLoad={handleLoadModel}
            onUnload={unloadModel}
            onDelete={(ids) => setShowDeleteConfirm(ids)}
          />

          {/* Custom Models */}
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
                    onDelete={(id) => setShowDeleteConfirm([id])}
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
                  <Text weight="semibold">
                    <span className={styles.tierLabelGreen}>{group.label}</span>
                  </Text>
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
                      onDelete={(id) => setShowDeleteConfirm([id])}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </SettingsSection>
      )}

      {/* Delete Confirmation Dialog (LLM) */}
      {subTab === 'llm' && (
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
                  {showDeleteConfirm && showDeleteConfirm.length > 1
                    ? t('llm.settings.delete_confirm_multiple', {
                        defaultValue: `This will remove ${showDeleteConfirm.length} model files from your device. You can download them again later.`,
                        count: showDeleteConfirm.length,
                      })
                    : t('llm.settings.delete_confirm', {
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
      )}

      {/* Switch Model Confirmation Dialog */}
      {subTab === 'llm' && (
        <Dialog
          open={switchConfirmModelId !== null}
          onOpenChange={(_, data) => !data.open && setSwitchConfirmModelId(null)}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>
                {t('llm.settings.switch_title', { defaultValue: 'Switch Model?' })}
              </DialogTitle>
              <DialogContent>
                <Text>
                  Loading a new model will unload{' '}
                  <Text weight="semibold">{loadedModelInfo?.name ?? loadedModelId}</Text>. Do you
                  want to continue?
                </Text>
              </DialogContent>
              <DialogActions>
                <Button appearance="secondary" onClick={() => setSwitchConfirmModelId(null)}>
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    if (switchConfirmModelId) {
                      void doLoadModel(switchConfirmModelId);
                    }
                    setSwitchConfirmModelId(null);
                  }}
                >
                  {t('common.continue', { defaultValue: 'Continue' })}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </SettingsTabLayout>
  );
};
