import { Button, Spinner, Tooltip } from '@fluentui/react-components';
import { Brain20Regular, Brain20Filled, Warning20Regular } from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { useLLMStatus } from '../hooks/useLLMStatus';

import styles from './LoadModelButton.module.css';

interface LoadModelButtonProps {
  onOpenSettings?: () => void;
}

/**
 * Button for the toolbar that shows AI model status and allows loading/unloading.
 */
export const LoadModelButton: React.FC<LoadModelButtonProps> = ({ onOpenSettings }) => {
  const { t } = useTranslation();
  const {
    modelLoaded,
    loadedModelInfo,
    isLoadingModel,
    serverStatus,
    gpuDetected,
    defaultModelId,
    loadModel,
    unloadModel,
    startServer,
    lastError,
  } = useLLMStatus();

  const handleClick = React.useCallback(async () => {
    // If no GPU detected, show settings
    if (!gpuDetected) {
      onOpenSettings?.();
      return;
    }

    // If server not running, start it
    if (serverStatus === 'stopped' || serverStatus === 'error') {
      try {
        await startServer();
      } catch (error) {
        console.error('Failed to start LLM server:', error);
        return;
      }
    }

    // Toggle model
    if (modelLoaded) {
      try {
        await unloadModel();
      } catch (error) {
        console.error('Failed to unload model:', error);
      }
    } else if (defaultModelId) {
      try {
        await loadModel(defaultModelId);
      } catch (error) {
        console.error('Failed to load model:', error);
      }
    } else {
      // No default model set, open settings
      onOpenSettings?.();
    }
  }, [
    gpuDetected,
    serverStatus,
    modelLoaded,
    defaultModelId,
    loadModel,
    unloadModel,
    startServer,
    onOpenSettings,
  ]);

  // Determine icon and label
  let icon: React.ReactNode;
  let label: string;
  let tooltipContent: string;

  if (!gpuDetected) {
    icon = <Warning20Regular />;
    label = t('llm.no_gpu', { defaultValue: 'No GPU' });
    tooltipContent = t('llm.no_gpu_tooltip', {
      defaultValue: 'No compatible GPU detected. Click to configure.',
    });
  } else if (isLoadingModel) {
    icon = <Spinner size="tiny" />;
    label = t('llm.loading', { defaultValue: 'Loading...' });
    tooltipContent = t('llm.loading_model', { defaultValue: 'Loading AI model...' });
  } else if (serverStatus === 'starting') {
    icon = <Spinner size="tiny" />;
    label = t('llm.starting', { defaultValue: 'Starting...' });
    tooltipContent = t('llm.starting_server', { defaultValue: 'Starting AI server...' });
  } else if (modelLoaded && loadedModelInfo) {
    icon = <Brain20Filled />;
    label = loadedModelInfo.name.split(' ')[0]; // First word of model name
    tooltipContent = t('llm.model_loaded', {
      defaultValue: '{{model}} loaded - Click to unload',
      model: loadedModelInfo.name,
    });
  } else if (serverStatus === 'error') {
    icon = <Warning20Regular />;
    label = t('llm.error', { defaultValue: 'Error' });
    tooltipContent = lastError ?? t('llm.server_error', { defaultValue: 'AI server error' });
  } else {
    icon = <Brain20Regular />;
    label = t('llm.load_ai', { defaultValue: 'Load AI' });
    tooltipContent = defaultModelId
      ? t('llm.click_to_load', { defaultValue: 'Click to load AI model' })
      : t('llm.configure_model', { defaultValue: 'Click to configure AI model' });
  }

  const isActive = modelLoaded && serverStatus === 'ready';
  const isDisabled = isLoadingModel || serverStatus === 'starting';

  return (
    <Tooltip content={tooltipContent} relationship="label">
      <Button
        appearance={isActive ? 'primary' : 'subtle'}
        size="small"
        className={`${styles.button} ${isActive ? styles.active : ''}`}
        onClick={handleClick}
        disabled={isDisabled}
        icon={icon}
      >
        <span className={styles.label}>{label}</span>
      </Button>
    </Tooltip>
  );
};
