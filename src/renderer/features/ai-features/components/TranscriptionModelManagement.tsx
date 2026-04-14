import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  Text,
} from '@fluentui/react-components';
import {
  ArrowClockwise20Regular,
  ArrowDownload20Regular,
  Checkmark20Regular,
  Delete20Regular,
  Mic20Regular,
} from '@fluentui/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsSection, SettingsTabLayout } from '../../settings/components/SettingsTabLayout';
import { useTranscriptionModels, type WhisperModelInfo } from '../hooks/useTranscriptionModels';

import styles from './AIFeatures.module.css';

const ACCURACY_COLOR: Record<string, 'informative' | 'success' | 'important'> = {
  basic: 'informative',
  good: 'success',
  excellent: 'important',
};

export const TranscriptionModelManagement: React.FC = () => {
  const { t: _t } = useTranslation();
  const {
    models,
    loadedModel,
    defaultModel,
    downloads,
    isLoading,
    error,
    downloadModel,
    deleteModel,
    setDefaultModel,
    refresh,
  } = useTranscriptionModels();

  const [deleteConfirmModel, setDeleteConfirmModel] = React.useState<string | null>(null);

  const handleDelete = React.useCallback(
    async (modelId: string) => {
      try {
        await deleteModel(modelId);
      } catch {
        // Error handled by hook
      }
      setDeleteConfirmModel(null);
    },
    [deleteModel]
  );

  if (isLoading) {
    return null;
  }

  if (error) {
    return (
      <SettingsTabLayout
        title="Transcription Models"
        actions={
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowClockwise20Regular />}
            onClick={() => refresh()}
          >
            Retry
          </Button>
        }
      >
        <Text className={styles.errorText}>
          Failed to load model status. Is the transcription server running?
        </Text>
        <Text size={200} className={styles.errorText}>
          {error}
        </Text>
      </SettingsTabLayout>
    );
  }

  const downloadedModels = models.filter((m) => m.downloaded);
  const availableModels = models.filter((m) => !m.downloaded);

  return (
    <>
      {/* Currently Loaded Model */}
      <SettingsSection title="Currently Loaded Model">
        {loadedModel ? (
          <div className={styles.currentModel}>
            <div className={styles.currentModelInfo}>
              <Mic20Regular className={styles.currentModelIcon} />
              <div className={styles.currentModelText}>
                <Text weight="semibold">
                  {models.find((m) => m.id === loadedModel)?.name ?? loadedModel}
                </Text>
                <Text size={200} className={styles.currentModelStats}>
                  {models.find((m) => m.id === loadedModel)?.paramsMB ?? '?'} MB
                </Text>
              </div>
            </div>
            <Badge appearance="filled" color="success">
              Loaded
            </Badge>
          </div>
        ) : (
          <Text className={styles.noModel}>
            No whisper model loaded. A model will be loaded when transcription starts.
          </Text>
        )}
      </SettingsSection>

      {/* Downloaded Models */}
      <SettingsSection
        title="Downloaded Models"
        description="Models available on your device. Set a default model for new transcription sessions."
        action={
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowClockwise20Regular />}
            onClick={() => refresh()}
          >
            Refresh
          </Button>
        }
      >
        {downloadedModels.length === 0 ? (
          <Text className={styles.noModel}>
            No models downloaded yet. Download a model from the catalog below.
          </Text>
        ) : (
          <div className={styles.whisperModelList}>
            {downloadedModels.map((model) => (
              <WhisperModelRow
                key={model.id}
                model={model}
                isLoaded={model.id === loadedModel}
                isDefault={model.id === defaultModel}
                downloadStatus={downloads[model.id]}
                onSetDefault={() => setDefaultModel(model.id)}
                onDelete={() => setDeleteConfirmModel(model.id)}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      {/* Model Catalog */}
      <SettingsSection
        title="Model Catalog"
        description="Download whisper models for local speech-to-text transcription."
      >
        <div className={styles.whisperModelList}>
          {availableModels.map((model) => (
            <WhisperModelRow
              key={model.id}
              model={model}
              isLoaded={false}
              isDefault={false}
              downloadStatus={downloads[model.id]}
              onDownload={() => downloadModel(model.id)}
            />
          ))}
        </div>
      </SettingsSection>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmModel !== null}
        onOpenChange={(_, data) => !data.open && setDeleteConfirmModel(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete Model?</DialogTitle>
            <DialogContent>
              <Text>
                This will remove the model from your device. You can download it again later.
              </Text>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setDeleteConfirmModel(null)}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => deleteConfirmModel && handleDelete(deleteConfirmModel)}
              >
                Delete
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
};

interface WhisperModelRowProps {
  model: WhisperModelInfo;
  isLoaded: boolean;
  isDefault: boolean;
  downloadStatus?: { status: string; progress?: number; error?: string };
  onDownload?: () => void;
  onDelete?: () => void;
  onSetDefault?: () => void;
}

const WhisperModelRow: React.FC<WhisperModelRowProps> = ({
  model,
  isLoaded,
  isDefault,
  downloadStatus,
  onDownload,
  onDelete,
  onSetDefault,
}) => {
  const { t } = useTranslation();
  const isDownloading = downloadStatus?.status === 'downloading';
  const i18nKey = `transcription.models.${model.id.replace(/\./g, '_')}`;

  return (
    <div className={`${styles.whisperModelRow} ${isDefault ? styles.whisperModelDefault : ''}`}>
      <div className={styles.whisperModelInfo}>
        <div className={styles.whisperModelMeta}>
          <Text weight="semibold" className={styles.whisperModelName}>
            {model.name}
          </Text>
          <Text size={200} className={styles.whisperModelSize}>
            {model.paramsMB} MB
          </Text>
          <Badge
            appearance="outline"
            color={ACCURACY_COLOR[model.accuracy] ?? 'informative'}
            size="small"
          >
            {model.accuracy}
          </Badge>
          {model.englishOnly && (
            <Badge appearance="outline" color="informative" size="small">
              EN only
            </Badge>
          )}
          {isLoaded && (
            <Badge appearance="filled" color="success" size="small">
              Loaded
            </Badge>
          )}
          {isDefault && (
            <Badge appearance="tint" color="brand" size="small">
              Default
            </Badge>
          )}
        </div>
        <Text size={200} className={styles.whisperModelDescription}>
          {t(i18nKey)}
        </Text>
      </div>
      <div className={styles.whisperModelActions}>
        {model.downloaded ? (
          <>
            {!isDefault && onSetDefault && (
              <Button
                size="small"
                appearance="subtle"
                icon={<Checkmark20Regular />}
                onClick={onSetDefault}
              >
                Set Default
              </Button>
            )}
            {!isLoaded && onDelete && (
              <Button
                size="small"
                appearance="subtle"
                icon={<Delete20Regular />}
                onClick={onDelete}
              >
                Delete
              </Button>
            )}
          </>
        ) : isDownloading ? (
          <Button size="small" appearance="subtle" disabled>
            <Spinner size="tiny" />
            <span style={{ marginLeft: 4 }}>Downloading...</span>
          </Button>
        ) : (
          onDownload && (
            <Button
              size="small"
              appearance="subtle"
              icon={<ArrowDownload20Regular />}
              onClick={onDownload}
            >
              Download
            </Button>
          )
        )}
      </div>
    </div>
  );
};
