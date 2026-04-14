import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Spinner,
  Text,
  Link,
} from '@fluentui/react-components';
import { Warning24Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useGPUInfo } from '../hooks/useGPUInfo';
import { useLLMStatus } from '../hooks/useLLMStatus';
import { useLLMStore } from '../model/llm.store';

import styles from './LoadModelModal.module.css';

interface LoadModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelLoaded?: () => void;
}

/**
 * Modal that appears when user tries to generate a summary without a model loaded.
 * Shows contextual actions based on whether models are downloaded.
 */
export const LoadModelModal: React.FC<LoadModelModalProps> = ({
  isOpen,
  onClose,
  onModelLoaded,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loadModel, isLoadingModel, serverStatus, startServer, lastError } = useLLMStatus();
  const { isSupported, notSupportedReason } = useGPUInfo();
  const downloadedModels = useLLMStore((state) => state.downloadedModels);
  const defaultModelId = useLLMStore((state) => state.defaultModelId);

  const hasDownloadedModels = downloadedModels.length > 0;
  const modelToLoad = defaultModelId ?? downloadedModels[0]?.id;
  const modelDisplayName =
    downloadedModels.find((m) => m.id === modelToLoad)?.catalogEntry?.name ?? modelToLoad;

  const handleGoToSettings = React.useCallback(() => {
    navigate('/ai-features/model-management');
    onClose();
  }, [navigate, onClose]);

  const handleLoad = React.useCallback(async () => {
    if (!modelToLoad) return;

    try {
      if (serverStatus === 'stopped' || serverStatus === 'error') {
        await startServer();
      }

      await loadModel(modelToLoad);
      onModelLoaded?.();
      onClose();
    } catch (error) {
      console.error('Failed to load model:', error);
    }
  }, [modelToLoad, serverStatus, startServer, loadModel, onModelLoaded, onClose]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle className={styles.title}>
            {t('llm.modal.title', { defaultValue: 'Enable AI Services' })}
          </DialogTitle>

          <DialogContent className={styles.content}>
            {!isSupported ? (
              <div className={styles.warning}>
                <Warning24Regular className={styles.warningIcon} />
                <div>
                  <Text weight="semibold">
                    {t('llm.modal.gpu_not_supported', { defaultValue: 'GPU Not Supported' })}
                  </Text>
                  <Text size={200} className={styles.warningText}>
                    {notSupportedReason}
                  </Text>
                </div>
              </div>
            ) : !hasDownloadedModels ? (
              <>
                <Text className={styles.description}>
                  {t('llm.modal.must_load', {
                    defaultValue: 'You must load a model in order to generate a summary.',
                  })}
                </Text>
                <Text className={styles.description}>
                  {t('llm.modal.download_prompt', {
                    defaultValue: 'Would you like to download one now?',
                  })}
                </Text>
              </>
            ) : (
              <>
                <Text className={styles.description}>
                  {t('llm.modal.must_load', {
                    defaultValue: 'You must load a model in order to generate a summary.',
                  })}
                </Text>
                <Text className={styles.description}>
                  Would you like to load <Text weight="semibold">{modelDisplayName}</Text> or{' '}
                  <Link inline className={styles.inlineLink} onClick={handleGoToSettings}>
                    {t('llm.modal.select_other_inline', { defaultValue: 'select other model' })}
                  </Link>{' '}
                  {t('llm.modal.load_default_prompt_suffix', {
                    defaultValue: 'now?',
                  })}
                </Text>
                {lastError && (
                  <Text size={200} className={styles.errorText}>
                    {lastError}
                  </Text>
                )}
              </>
            )}
          </DialogContent>

          <DialogActions className={styles.actions}>
            <Button appearance="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            {!isSupported ? null : !hasDownloadedModels ? (
              <Button appearance="primary" onClick={handleGoToSettings}>
                {t('llm.modal.go_to_settings', { defaultValue: 'Go to AI Models' })}
              </Button>
            ) : (
              <Button
                appearance="primary"
                onClick={handleLoad}
                disabled={!modelToLoad || isLoadingModel}
              >
                {isLoadingModel ? (
                  <>
                    <Spinner size="tiny" />
                    {t('llm.modal.loading', { defaultValue: 'Loading...' })}
                  </>
                ) : (
                  t('llm.modal.load', { defaultValue: 'Load Model' })
                )}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
