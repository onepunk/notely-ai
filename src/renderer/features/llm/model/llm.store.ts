import { create } from 'zustand';

import type {
  LLMServerStatus,
  GPUCapabilities,
  GPUInfo,
  ModelCatalogEntry,
  DownloadedModel,
  ModelParameters,
  PromptsConfig,
  LLMDownloadProgress,
  DiskUsageResult,
  ParsedHuggingFaceUrl,
} from '../../../../preload/index';

export type LLMState = {
  // Server status
  serverStatus: LLMServerStatus;
  port: number | null;
  lastError: string | null;

  // Model state
  modelLoaded: boolean;
  loadedModelId: string | null;
  loadedModelInfo: ModelCatalogEntry | null;
  modelPath: string | null;
  isLoadingModel: boolean;
  loadingModelId: string | null;

  // GPU state
  gpuInfo: GPUInfo | null;
  gpuCapabilities: GPUCapabilities | null;
  gpuDetected: boolean;

  // Model catalog
  availableModels: ModelCatalogEntry[];
  downloadedModels: DownloadedModel[];
  recommendedModels: ModelCatalogEntry[];

  // Download state
  activeDownloads: Map<string, LLMDownloadProgress>;
  downloadErrors: Map<string, string>;

  // Settings
  defaultModelId: string | null;
  modelParameters: ModelParameters | null;
  prompts: PromptsConfig | null;

  // HuggingFace auth
  hasHuggingFaceToken: boolean;
  huggingFaceUser: { name: string } | null;

  // Disk usage & health
  diskUsage: DiskUsageResult | null;
  catalogHealth: Record<string, boolean>;
  urlParseState: {
    parsing: boolean;
    result: ParsedHuggingFaceUrl | null;
    error: string | null;
  };

  // UI state
  isInitialized: boolean;
  isRefreshing: boolean;

  // Actions
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  loadModel: (modelId: string, options?: { nGpuLayers?: number; nCtx?: number }) => Promise<void>;
  unloadModel: () => Promise<void>;
  downloadModel: (modelId: string) => Promise<void>;
  cancelDownload: (modelId: string) => Promise<void>;
  deleteModel: (modelId: string) => Promise<void>;
  setDefaultModel: (modelId: string) => Promise<void>;
  setModelParameters: (params: Partial<ModelParameters>) => Promise<void>;
  setPrompts: (prompts: Partial<PromptsConfig>) => Promise<void>;
  resetPrompts: () => Promise<void>;
  setHuggingFaceToken: (token: string) => Promise<void>;
  clearHuggingFaceToken: () => Promise<void>;
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  restartServer: () => Promise<void>;

  // Custom model actions
  fetchDiskUsage: () => Promise<void>;
  parseHuggingFaceUrl: (url: string) => Promise<void>;
  clearUrlParseState: () => void;
  downloadCustomModel: (input: {
    url: string;
    filename: string;
    modelId: string;
    repo?: string;
    name?: string;
  }) => Promise<void>;
  removeCustomModel: (modelId: string) => Promise<void>;
  validateCatalogUrls: () => Promise<void>;
  openModelsDirectory: () => Promise<void>;
  refreshModels: () => Promise<void>;
  resetToDefaults: () => Promise<void>;

  // Internal setters
  setDownloadProgress: (progress: LLMDownloadProgress) => void;
  setDownloadError: (modelId: string, error: string) => void;
  clearDownload: (modelId: string) => void;
  setModelLoaded: (modelPath: string, loadTimeSeconds: number) => void;
  setModelUnloaded: () => void;
  setError: (error: string) => void;
};

export const useLLMStore = create<LLMState>((set, get) => ({
  // Initial state
  serverStatus: 'stopped',
  port: null,
  lastError: null,

  modelLoaded: false,
  loadedModelId: null,
  loadedModelInfo: null,
  modelPath: null,
  isLoadingModel: false,
  loadingModelId: null,

  gpuInfo: null,
  gpuCapabilities: null,
  gpuDetected: false,

  availableModels: [],
  downloadedModels: [],
  recommendedModels: [],

  activeDownloads: new Map(),
  downloadErrors: new Map(),

  defaultModelId: null,
  modelParameters: null,
  prompts: null,

  hasHuggingFaceToken: false,
  huggingFaceUser: null,

  diskUsage: null,
  catalogHealth: {},
  urlParseState: { parsing: false, result: null, error: null },

  isInitialized: false,
  isRefreshing: false,

  // Initialize store - load all state from main process
  async initialize() {
    if (get().isInitialized) return;

    try {
      set({ isRefreshing: true });

      // Fetch all state in parallel
      const [
        status,
        gpuResult,
        availableModels,
        downloadedModels,
        recommendedModels,
        defaultModel,
        modelParameters,
        prompts,
        hfToken,
        loadedModel,
        diskUsage,
      ] = await Promise.all([
        window.api.llm.getStatus(),
        window.api.gpu.detect(),
        window.api.llm.getAvailableModels(),
        window.api.llm.getDownloadedModels(),
        window.api.llm.getRecommendedModels(),
        window.api.llm.getDefaultModel(),
        window.api.llm.getModelParameters(),
        window.api.llm.getPrompts(),
        window.api.llm.getHuggingFaceToken(),
        window.api.llm.getLoadedModel(),
        window.api.llm.getDiskUsage(),
      ]);

      set({
        serverStatus: status.serverStatus.status,
        port: status.serverStatus.port,
        lastError: status.serverStatus.lastError,

        modelLoaded: loadedModel.loaded,
        loadedModelId: loadedModel.modelId,
        loadedModelInfo: loadedModel.modelInfo,
        modelPath: loadedModel.modelPath,

        gpuInfo: gpuResult.gpu,
        gpuCapabilities: gpuResult.capabilities,
        gpuDetected: gpuResult.success && gpuResult.capabilities?.supported === true,

        availableModels,
        downloadedModels,
        recommendedModels,

        defaultModelId: defaultModel,
        modelParameters,
        prompts,

        hasHuggingFaceToken: hfToken.hasToken,
        huggingFaceUser: hfToken.user,

        diskUsage,

        isInitialized: true,
        isRefreshing: false,
      });

      // Fire-and-forget catalog URL validation in background
      window.api.llm
        .validateCatalogUrls()
        .then((results) => {
          const health: Record<string, boolean> = {};
          for (const r of results) {
            health[r.modelId] = r.reachable;
          }
          set({ catalogHealth: health });
        })
        .catch(() => {
          // Silently ignore validation failures
        });

      // Set up event listeners
      setupEventListeners(get, set);
    } catch (error) {
      console.error('Failed to initialize LLM store:', error);
      set({ isRefreshing: false, lastError: String(error) });
    }
  },

  // Refresh state from main process
  async refresh() {
    if (get().isRefreshing) return;

    try {
      set({ isRefreshing: true });

      const [status, downloadedModels, loadedModel] = await Promise.all([
        window.api.llm.getStatus(),
        window.api.llm.getDownloadedModels(),
        window.api.llm.getLoadedModel(),
      ]);

      set({
        serverStatus: status.serverStatus.status,
        port: status.serverStatus.port,
        lastError: status.serverStatus.lastError,
        modelLoaded: loadedModel.loaded,
        loadedModelId: loadedModel.modelId,
        loadedModelInfo: loadedModel.modelInfo,
        modelPath: loadedModel.modelPath,
        downloadedModels,
        isRefreshing: false,
      });
    } catch (error) {
      console.error('Failed to refresh LLM store:', error);
      set({ isRefreshing: false });
    }
  },

  // Load a model
  async loadModel(modelId, options) {
    try {
      set({ isLoadingModel: true, loadingModelId: modelId, lastError: null });

      const result = await window.api.llm.loadModel({
        modelId,
        nGpuLayers: options?.nGpuLayers,
        nCtx: options?.nCtx,
      });

      if (!result.success) {
        set({
          isLoadingModel: false,
          loadingModelId: null,
          lastError: result.error ?? 'Unknown error',
        });
        throw new Error(result.error ?? 'Failed to load model');
      }

      // Immediately mark as loaded so callers see the update synchronously.
      // The onModelLoaded event will still fire and enrich with loadedModelInfo.
      set({
        modelLoaded: true,
        loadedModelId: modelId,
        isLoadingModel: false,
        loadingModelId: null,
        serverStatus: 'ready',
      });
    } catch (error) {
      console.error('Failed to load model:', error);
      set({ isLoadingModel: false, loadingModelId: null });
      throw error;
    }
  },

  // Unload the current model
  async unloadModel() {
    try {
      set({ lastError: null });
      const result = await window.api.llm.unloadModel();

      if (!result.success) {
        set({ lastError: result.error ?? 'Unknown error' });
        throw new Error(result.error ?? 'Failed to unload model');
      }

      // State will be updated by event listeners
    } catch (error) {
      console.error('Failed to unload model:', error);
      throw error;
    }
  },

  // Download a model
  async downloadModel(modelId) {
    try {
      // Clear any previous error for this model
      const downloadErrors = new Map(get().downloadErrors);
      downloadErrors.delete(modelId);
      set({ downloadErrors });

      const result = await window.api.llm.downloadModel({ modelId });

      if (!result.success) {
        get().setDownloadError(modelId, result.error ?? 'Download failed');
        throw new Error(result.error ?? 'Failed to download model');
      }

      // Progress will be tracked via event listeners
    } catch (error) {
      console.error('Failed to download model:', error);
      throw error;
    }
  },

  // Cancel a download
  async cancelDownload(modelId) {
    try {
      await window.api.llm.cancelDownload({ modelId });
      get().clearDownload(modelId);
    } catch (error) {
      console.error('Failed to cancel download:', error);
    }
  },

  // Delete a downloaded model
  async deleteModel(modelId) {
    try {
      const result = await window.api.llm.deleteModel({ modelId });

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete model');
      }

      // Refresh downloaded models list and disk usage
      const [downloadedModels, diskUsage] = await Promise.all([
        window.api.llm.getDownloadedModels(),
        window.api.llm.getDiskUsage(),
      ]);
      set({ downloadedModels, diskUsage });
    } catch (error) {
      console.error('Failed to delete model:', error);
      throw error;
    }
  },

  // Set default model
  async setDefaultModel(modelId) {
    try {
      const result = await window.api.llm.setDefaultModel(modelId);

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to set default model');
      }

      set({ defaultModelId: modelId });
    } catch (error) {
      console.error('Failed to set default model:', error);
      throw error;
    }
  },

  // Set model parameters
  async setModelParameters(params) {
    try {
      const result = await window.api.llm.setModelParameters(params);

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to set model parameters');
      }

      const modelParameters = await window.api.llm.getModelParameters();
      set({ modelParameters });
    } catch (error) {
      console.error('Failed to set model parameters:', error);
      throw error;
    }
  },

  // Set prompts
  async setPrompts(prompts) {
    try {
      const result = await window.api.llm.setPrompts(prompts);

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to set prompts');
      }

      const newPrompts = await window.api.llm.getPrompts();
      set({ prompts: newPrompts });
    } catch (error) {
      console.error('Failed to set prompts:', error);
      throw error;
    }
  },

  // Reset prompts to defaults
  async resetPrompts() {
    try {
      const result = await window.api.llm.resetPrompts();

      if (!result.success) {
        throw new Error('Failed to reset prompts');
      }

      const prompts = await window.api.llm.getPrompts();
      set({ prompts });
    } catch (error) {
      console.error('Failed to reset prompts:', error);
      throw error;
    }
  },

  // Set HuggingFace token
  async setHuggingFaceToken(token) {
    try {
      const result = await window.api.llm.setHuggingFaceToken({ token });

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to set token');
      }

      set({
        hasHuggingFaceToken: true,
        huggingFaceUser: result.user ?? null,
      });
    } catch (error) {
      console.error('Failed to set HuggingFace token:', error);
      throw error;
    }
  },

  // Clear HuggingFace token
  async clearHuggingFaceToken() {
    try {
      await window.api.llm.clearHuggingFaceToken();
      set({ hasHuggingFaceToken: false, huggingFaceUser: null });
    } catch (error) {
      console.error('Failed to clear HuggingFace token:', error);
      throw error;
    }
  },

  // Start LLM server
  async startServer() {
    try {
      set({ serverStatus: 'starting', lastError: null });
      const result = await window.api.llm.startServer();

      if (!result.success) {
        set({ serverStatus: 'error', lastError: result.error ?? 'Unknown error' });
        throw new Error(result.error ?? 'Failed to start server');
      }

      set({ serverStatus: 'ready', port: result.port ?? null });
    } catch (error) {
      console.error('Failed to start server:', error);
      throw error;
    }
  },

  // Stop LLM server
  async stopServer() {
    try {
      const result = await window.api.llm.stopServer();

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to stop server');
      }

      set({ serverStatus: 'stopped', port: null, modelLoaded: false });
    } catch (error) {
      console.error('Failed to stop server:', error);
      throw error;
    }
  },

  // Restart LLM server
  async restartServer() {
    try {
      set({ serverStatus: 'starting', lastError: null });
      const result = await window.api.llm.restartServer();

      if (!result.success) {
        set({ serverStatus: 'error', lastError: result.error ?? 'Unknown error' });
        throw new Error(result.error ?? 'Failed to restart server');
      }

      set({ serverStatus: 'ready', port: result.port ?? null, modelLoaded: false });
    } catch (error) {
      console.error('Failed to restart server:', error);
      throw error;
    }
  },

  // Fetch disk usage
  async fetchDiskUsage() {
    try {
      const diskUsage = await window.api.llm.getDiskUsage();
      set({ diskUsage });
    } catch (error) {
      console.error('Failed to fetch disk usage:', error);
    }
  },

  // Parse a HuggingFace URL
  async parseHuggingFaceUrl(url) {
    try {
      set({ urlParseState: { parsing: true, result: null, error: null } });
      const result = await window.api.llm.parseHuggingFaceUrl({ url });

      if (!result.isValid) {
        set({
          urlParseState: {
            parsing: false,
            result: null,
            error: result.error ?? 'Invalid URL',
          },
        });
        return;
      }

      set({ urlParseState: { parsing: false, result, error: null } });
    } catch (error) {
      set({
        urlParseState: {
          parsing: false,
          result: null,
          error: error instanceof Error ? error.message : 'Failed to parse URL',
        },
      });
    }
  },

  // Clear URL parse state
  clearUrlParseState() {
    set({ urlParseState: { parsing: false, result: null, error: null } });
  },

  // Download a custom model
  async downloadCustomModel(input) {
    try {
      const downloadErrors = new Map(get().downloadErrors);
      downloadErrors.delete(input.modelId);
      set({ downloadErrors });

      const result = await window.api.llm.downloadCustomModel(input);

      if (!result.success) {
        get().setDownloadError(input.modelId, result.error ?? 'Download failed');
        throw new Error(result.error ?? 'Failed to download custom model');
      }

      // Refresh after download
      await get().refreshModels();
    } catch (error) {
      console.error('Failed to download custom model:', error);
      throw error;
    }
  },

  // Remove a custom model
  async removeCustomModel(modelId) {
    try {
      const result = await window.api.llm.removeCustomModel({ modelId });

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to remove custom model');
      }

      await get().refreshModels();
    } catch (error) {
      console.error('Failed to remove custom model:', error);
      throw error;
    }
  },

  // Validate catalog URLs
  async validateCatalogUrls() {
    try {
      const results = await window.api.llm.validateCatalogUrls();
      const health: Record<string, boolean> = {};
      for (const r of results) {
        health[r.modelId] = r.reachable;
      }
      set({ catalogHealth: health });
    } catch (error) {
      console.error('Failed to validate catalog URLs:', error);
    }
  },

  // Open models directory
  async openModelsDirectory() {
    try {
      await window.api.llm.openModelsDirectory();
    } catch (error) {
      console.error('Failed to open models directory:', error);
    }
  },

  // Refresh models (re-scan directory)
  async refreshModels() {
    try {
      const result = await window.api.llm.refreshModels();
      const availableModels = await window.api.llm.getAvailableModels();
      set({
        downloadedModels: result.downloadedModels,
        diskUsage: result.diskUsage,
        availableModels,
      });
    } catch (error) {
      console.error('Failed to refresh models:', error);
    }
  },

  // Reset all LLM settings to built-in defaults
  async resetToDefaults() {
    try {
      set({ isRefreshing: true });

      // Clear all LLM settings keys so handlers fall back to built-in defaults
      await Promise.all([
        window.api.settings.set('llm.defaultModel', ''),
        window.api.settings.set('llm.temperatureExtract', ''),
        window.api.settings.set('llm.temperatureRefine', ''),
        window.api.settings.set('llm.maxTokens', ''),
        window.api.settings.set('llm.topP', ''),
        window.api.settings.set('llm.contextWindow', ''),
        window.api.settings.set('llm.nGpuLayers', ''),
        window.api.settings.set('llm.systemPrompt', ''),
        window.api.settings.set('llm.promptStructure', ''),
        window.api.settings.set('llm.activePromptTemplateId', ''),
      ]);

      // Re-fetch to get default values from handlers
      const [modelParameters, prompts] = await Promise.all([
        window.api.llm.getModelParameters(),
        window.api.llm.getPrompts(),
      ]);

      set({
        defaultModelId: null,
        modelParameters,
        prompts,
        isRefreshing: false,
      });
    } catch (error) {
      console.error('Failed to reset to defaults:', error);
      set({ isRefreshing: false });
    }
  },

  // Internal: update download progress
  setDownloadProgress(progress) {
    const activeDownloads = new Map(get().activeDownloads);
    activeDownloads.set(progress.modelId, progress);
    set({ activeDownloads });
  },

  // Internal: set download error
  setDownloadError(modelId, error) {
    const downloadErrors = new Map(get().downloadErrors);
    downloadErrors.set(modelId, error);
    const activeDownloads = new Map(get().activeDownloads);
    activeDownloads.delete(modelId);
    set({ downloadErrors, activeDownloads });
  },

  // Internal: clear download state
  clearDownload(modelId) {
    const activeDownloads = new Map(get().activeDownloads);
    activeDownloads.delete(modelId);
    const downloadErrors = new Map(get().downloadErrors);
    downloadErrors.delete(modelId);
    set({ activeDownloads, downloadErrors });
  },

  // Internal: model loaded callback
  setModelLoaded(modelPath, loadTimeSeconds) {
    const { loadingModelId, availableModels } = get();
    const modelInfo = availableModels.find((m) => modelPath.includes(m.filename)) ?? null;

    set({
      modelLoaded: true,
      loadedModelId: loadingModelId,
      loadedModelInfo: modelInfo,
      modelPath,
      isLoadingModel: false,
      loadingModelId: null,
      serverStatus: 'ready',
    });

    console.log(`Model loaded in ${loadTimeSeconds.toFixed(1)}s:`, modelPath);
  },

  // Internal: model unloaded callback
  setModelUnloaded() {
    set({
      modelLoaded: false,
      loadedModelId: null,
      loadedModelInfo: null,
      modelPath: null,
      isLoadingModel: false,
      loadingModelId: null,
    });
  },

  // Internal: set error
  setError(error) {
    set({ lastError: error, isLoadingModel: false, loadingModelId: null });
  },
}));

// Set up IPC event listeners - separate function to avoid being part of state
function setupEventListeners(get: () => LLMState, set: (partial: Partial<LLMState>) => void) {
  // Download events
  window.api.llm.onDownloadProgress((progress) => {
    get().setDownloadProgress(progress);
  });

  window.api.llm.onDownloadCompleted(async ({ modelId }) => {
    get().clearDownload(modelId);
    // Refresh downloaded models list and disk usage
    const [downloadedModels, diskUsage] = await Promise.all([
      window.api.llm.getDownloadedModels(),
      window.api.llm.getDiskUsage(),
    ]);
    set({ downloadedModels, diskUsage });
  });

  window.api.llm.onDownloadFailed(({ modelId, error }) => {
    get().setDownloadError(modelId, error);
  });

  window.api.llm.onDownloadCancelled(({ modelId }) => {
    get().clearDownload(modelId);
  });

  // Model events
  window.api.llm.onModelLoaded(({ modelPath, loadTimeSeconds }) => {
    get().setModelLoaded(modelPath, loadTimeSeconds);
  });

  window.api.llm.onModelUnloaded(() => {
    get().setModelUnloaded();
  });

  // Error events
  window.api.llm.onError(({ error }) => {
    get().setError(error);
  });
}

// Selector hooks for common patterns
export const useIsModelLoaded = () => useLLMStore((state) => state.modelLoaded);
export const useLoadedModel = () =>
  useLLMStore((state) => ({
    id: state.loadedModelId,
    info: state.loadedModelInfo,
  }));
export const useGPUCapabilities = () => useLLMStore((state) => state.gpuCapabilities);
export const useDownloadedModels = () => useLLMStore((state) => state.downloadedModels);
export const useAvailableModels = () => useLLMStore((state) => state.availableModels);
export const useRecommendedModels = () => useLLMStore((state) => state.recommendedModels);
export const useActiveDownloads = () => useLLMStore((state) => state.activeDownloads);
export const useServerStatus = () => useLLMStore((state) => state.serverStatus);
export const useIsLoadingModel = () => useLLMStore((state) => state.isLoadingModel);
export const useDiskUsage = () => useLLMStore((state) => state.diskUsage);
export const useCatalogHealth = () => useLLMStore((state) => state.catalogHealth);
export const useUrlParseState = () => useLLMStore((state) => state.urlParseState);
