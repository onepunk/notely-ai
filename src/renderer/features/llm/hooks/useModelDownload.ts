import * as React from 'react';

import type { LLMDownloadProgress } from '../../../../preload/index';
import { useLLMStore } from '../model/llm.store';

/**
 * Hook for managing model downloads.
 * Provides download status, progress, and actions for a specific model.
 */
export function useModelDownload(modelId: string) {
  const activeDownloads = useLLMStore((state) => state.activeDownloads);
  const downloadErrors = useLLMStore((state) => state.downloadErrors);
  const downloadedModels = useLLMStore((state) => state.downloadedModels);
  const downloadModel = useLLMStore((state) => state.downloadModel);
  const cancelDownload = useLLMStore((state) => state.cancelDownload);
  const deleteModel = useLLMStore((state) => state.deleteModel);

  const progress = activeDownloads.get(modelId) ?? null;
  const error = downloadErrors.get(modelId) ?? null;
  const isDownloaded = downloadedModels.some((m) => m.id === modelId);
  const isDownloading = progress !== null;

  return {
    // Status
    isDownloaded,
    isDownloading,
    progress,
    error,

    // Progress details
    percentage: progress?.percentage ?? 0,
    bytesDownloaded: progress?.bytesDownloaded ?? 0,
    totalBytes: progress?.totalBytes ?? 0,
    speed: progress?.speed ?? 0,
    eta: progress?.eta ?? 0,

    // Actions
    download: () => downloadModel(modelId),
    cancel: () => cancelDownload(modelId),
    delete: () => deleteModel(modelId),
  };
}

/**
 * Hook for managing all active downloads.
 */
export function useAllDownloads() {
  const activeDownloads = useLLMStore((state) => state.activeDownloads);
  const downloadErrors = useLLMStore((state) => state.downloadErrors);
  const cancelDownload = useLLMStore((state) => state.cancelDownload);

  const downloads = Array.from(activeDownloads.entries()).map(([modelId, progress]) => ({
    modelId,
    progress,
    error: downloadErrors.get(modelId) ?? null,
  }));

  const hasActiveDownloads = downloads.length > 0;
  const totalProgress =
    downloads.length > 0
      ? downloads.reduce((sum, d) => sum + d.progress.percentage, 0) / downloads.length
      : 0;

  return {
    downloads,
    hasActiveDownloads,
    totalProgress,
    cancelAll: () => downloads.forEach((d) => cancelDownload(d.modelId)),
  };
}

/**
 * Hook for download events using window event listeners.
 * Use this when you need to react to download events outside of the store.
 */
export function useDownloadEvents(
  onProgress?: (progress: LLMDownloadProgress) => void,
  onComplete?: (modelId: string) => void,
  onError?: (modelId: string, error: string) => void
) {
  React.useEffect(() => {
    const cleanups: Array<() => void> = [];

    if (onProgress) {
      cleanups.push(window.api.llm.onDownloadProgress(onProgress));
    }

    if (onComplete) {
      cleanups.push(window.api.llm.onDownloadCompleted(({ modelId }) => onComplete(modelId)));
    }

    if (onError) {
      cleanups.push(
        window.api.llm.onDownloadFailed(({ modelId, error }) => onError(modelId, error))
      );
    }

    return () => {
      cleanups.forEach((cleanup) => {
        try {
          cleanup();
        } catch {
          // Ignore cleanup errors
        }
      });
    };
  }, [onProgress, onComplete, onError]);
}
