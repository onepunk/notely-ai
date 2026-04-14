import * as React from 'react';

import { useLLMStore } from '../model/llm.store';

/**
 * Hook for accessing LLM status and basic operations.
 * Automatically initializes the LLM store on first use.
 */
export function useLLMStatus() {
  const store = useLLMStore();

  // Initialize store on mount
  React.useEffect(() => {
    if (!store.isInitialized) {
      void store.initialize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isInitialized, store.initialize]);

  return {
    // Server state
    serverStatus: store.serverStatus,
    port: store.port,
    lastError: store.lastError,

    // Model state
    modelLoaded: store.modelLoaded,
    loadedModelId: store.loadedModelId,
    loadedModelInfo: store.loadedModelInfo,
    isLoadingModel: store.isLoadingModel,
    loadingModelId: store.loadingModelId,

    // GPU state
    gpuDetected: store.gpuDetected,
    gpuCapabilities: store.gpuCapabilities,

    // Default model
    defaultModelId: store.defaultModelId,

    // Status flags
    isInitialized: store.isInitialized,
    isRefreshing: store.isRefreshing,

    // Computed status
    isReady: store.serverStatus === 'ready' && store.isInitialized,
    canGenerateSummary: store.modelLoaded && store.serverStatus === 'ready' && store.gpuDetected,

    // Actions
    loadModel: store.loadModel,
    unloadModel: store.unloadModel,
    refresh: store.refresh,
    startServer: store.startServer,
    stopServer: store.stopServer,
    restartServer: store.restartServer,
  };
}

/**
 * Hook for checking if a model is ready for inference.
 * Returns true only when a GPU is detected, the server is ready, and a model is loaded.
 */
export function useCanGenerateSummary() {
  const modelLoaded = useLLMStore((state) => state.modelLoaded);
  const serverStatus = useLLMStore((state) => state.serverStatus);
  const gpuDetected = useLLMStore((state) => state.gpuDetected);

  return gpuDetected && modelLoaded && serverStatus === 'ready';
}

/**
 * Hook for getting just the loading state.
 */
export function useModelLoadingState() {
  const isLoadingModel = useLLMStore((state) => state.isLoadingModel);
  const loadingModelId = useLLMStore((state) => state.loadingModelId);
  const lastError = useLLMStore((state) => state.lastError);

  return {
    isLoading: isLoadingModel,
    modelId: loadingModelId,
    error: lastError,
  };
}
