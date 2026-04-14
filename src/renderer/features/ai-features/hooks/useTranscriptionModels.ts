/**
 * Hook managing whisper model catalog, download status, and default model selection.
 */

import { useCallback, useEffect, useState } from 'react';

export interface WhisperModelInfo {
  id: string;
  name: string;
  paramsMB: number;
  englishOnly: boolean;
  accuracy: string;
  description?: string;
  downloaded: boolean;
}

export interface DownloadStatus {
  status: string;
  progress?: number;
  error?: string;
}

export function useTranscriptionModels() {
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [loadedModel, setLoadedModel] = useState<string | null>(null);
  const [defaultModel, setDefaultModelState] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DownloadStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [statusResult, defaultResult] = await Promise.all([
        window.api.transcription.getModelsStatus(),
        window.api.transcription.getDefaultWhisperModel(),
      ]);
      setModels(statusResult.models);
      setLoadedModel(statusResult.loadedModel);
      setDownloads(statusResult.downloads ?? {});
      setDefaultModelState(defaultResult.modelName);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load models';
      setError(message);
      console.error('useTranscriptionModels: Failed to refresh', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const downloadModel = useCallback(async (modelName: string) => {
    try {
      setDownloads((prev) => ({ ...prev, [modelName]: { status: 'downloading', progress: 0 } }));
      await window.api.transcription.downloadWhisperModel(modelName);
      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const status = await window.api.transcription.getModelsStatus();
          setModels(status.models);
          setDownloads(status.downloads ?? {});
          const dlStatus = status.downloads?.[modelName];
          if (!dlStatus || dlStatus.status !== 'downloading') {
            clearInterval(poll);
          }
        } catch {
          clearInterval(poll);
        }
      }, 2000);
    } catch (err) {
      console.error('useTranscriptionModels: Download failed', err);
      setDownloads((prev) => ({
        ...prev,
        [modelName]: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        },
      }));
    }
  }, []);

  const deleteModel = useCallback(
    async (modelName: string) => {
      try {
        const result = await window.api.transcription.deleteWhisperModel(modelName);
        if (!result.success) {
          throw new Error(result.error ?? 'Delete failed');
        }
        await refresh();
      } catch (err) {
        console.error('useTranscriptionModels: Delete failed', err);
        throw err;
      }
    },
    [refresh]
  );

  const setDefaultModel = useCallback(async (modelName: string) => {
    try {
      await window.api.transcription.setDefaultWhisperModel(modelName);
      setDefaultModelState(modelName);
    } catch (err) {
      console.error('useTranscriptionModels: Set default failed', err);
      throw err;
    }
  }, []);

  return {
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
  };
}
