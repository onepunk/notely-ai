/**
 * LLM Handlers
 *
 * IPC handlers for local LLM model management, inference, and GPU operations.
 * This is the core handler for Notely AI's local AI features.
 */

import { BrowserWindow, ipcMain, shell } from 'electron';
import { z } from 'zod';

import {
  DEFAULT_MODEL_PARAMETERS,
  buildModelParameters,
  type ModelParameters,
} from '../../common/config';
import { IPC } from '../../shared/ipc-channels';
import { logger } from '../logger';
import { GPUDetectionService } from '../services/gpu/GPUDetectionService';
import type { GPUCapabilities, GPUInfo } from '../services/gpu/types';
import { LLMServerManager } from '../services/llm/LLMServerManager';
import type { LLMServerState, GenerateSummaryResponse } from '../services/llm/types';
import { HuggingFaceAuth } from '../services/models/HuggingFaceAuth';
import { ModelDownloader } from '../services/models/ModelDownloader';
import { ModelRegistry } from '../services/models/ModelRegistry';
import type {
  ModelCatalogEntry,
  DownloadedModel,
  DownloadProgress,
  TokenValidationResult,
  DiskUsageResult,
  ParsedHuggingFaceUrl,
  CatalogHealthResult,
} from '../services/models/types';
import { type IStorageService } from '../storage/index';

// =============================================================================
// Validation Schemas
// =============================================================================

const LoadModelSchema = z.object({
  modelId: z.string().min(1),
  nGpuLayers: z.number().optional(),
  nCtx: z.number().optional(),
});

const DownloadModelSchema = z.object({
  modelId: z.string().min(1),
  hfToken: z.string().optional(),
});

const DeleteModelSchema = z.object({
  modelId: z.string().min(1),
});

const CancelDownloadSchema = z.object({
  modelId: z.string().min(1),
});

const GenerateSummarySchema = z.object({
  transcriptionId: z.string().min(1),
  text: z.string().min(1),
  analysisType: z.string().optional().default('full'),
  skipRefinement: z.boolean().optional().default(false),
});

const SetHuggingFaceTokenSchema = z.object({
  token: z.string().min(1),
});

const ModelParametersSchema = z.object({
  temperatureExtract: z.number().min(0).max(2).optional(),
  temperatureRefine: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).optional(),
  topP: z.number().min(0).max(1).optional(),
  contextWindow: z.number().min(512).optional(),
  nGpuLayers: z.number().optional(),
});

const SetPromptsSchema = z.object({
  systemPrompt: z.string().optional(),
  structure: z.record(z.unknown()).optional(),
});

const ParseHuggingFaceUrlSchema = z.object({
  url: z.string().min(1),
});

const DownloadCustomModelSchema = z.object({
  url: z.string().min(1),
  filename: z.string().min(1),
  modelId: z.string().min(1),
  repo: z.string().optional(),
  name: z.string().optional(),
});

const RemoveCustomModelSchema = z.object({
  modelId: z.string().min(1),
});

const ValidateCatalogUrlsSchema = z.object({
  modelIds: z.array(z.string()).optional(),
});

// =============================================================================
// Types
// =============================================================================

export interface LLMHandlersDependencies {
  llmServerManager: LLMServerManager;
  modelDownloader: ModelDownloader;
  modelRegistry: ModelRegistry;
  gpuService: GPUDetectionService;
  hfAuth: HuggingFaceAuth;
  storage: IStorageService;
  mainWindow?: BrowserWindow | null;
}

export interface LLMStatus {
  serverStatus: LLMServerState;
  modelLoaded: boolean;
  modelId: string | null;
  modelName: string | null;
  gpuCapabilities: GPUCapabilities | null;
}

export type { ModelParameters } from '../../common/config';

export interface PromptsConfig {
  systemPrompt: string;
  structure: Record<string, unknown>;
}

/**
 * Format bytes for catalog display
 */
function formatBytesForCatalog(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

// Settings keys
const SETTINGS_PREFIX = 'llm.';
const SETTINGS_KEYS = {
  defaultModel: `${SETTINGS_PREFIX}defaultModel`,
  temperatureExtract: `${SETTINGS_PREFIX}temperatureExtract`,
  temperatureRefine: `${SETTINGS_PREFIX}temperatureRefine`,
  maxTokens: `${SETTINGS_PREFIX}maxTokens`,
  topP: `${SETTINGS_PREFIX}topP`,
  contextWindow: `${SETTINGS_PREFIX}contextWindow`,
  nGpuLayers: `${SETTINGS_PREFIX}nGpuLayers`,
  systemPrompt: `${SETTINGS_PREFIX}systemPrompt`,
  promptStructure: `${SETTINGS_PREFIX}promptStructure`,
};

// =============================================================================
// Handler Class
// =============================================================================

/**
 * LLMHandlers manages all IPC handlers related to local LLM operations.
 */
export class LLMHandlers {
  private deps: LLMHandlersDependencies;
  private downloadProgressListeners: Map<string, (progress: DownloadProgress) => void> = new Map();

  constructor(deps: LLMHandlersDependencies) {
    this.deps = deps;
    this.setupEventForwarding();
  }

  /**
   * Set up event forwarding from services to renderer
   */
  private setupEventForwarding(): void {
    // Forward download progress to renderer
    this.deps.modelDownloader.on('downloadProgress', (progress: DownloadProgress) => {
      this.sendToRenderer(IPC.EVT_LLM_DOWNLOAD_PROGRESS, progress);
    });

    this.deps.modelDownloader.on(
      'downloadStarted',
      (data: { modelId: string; totalBytes: number }) => {
        this.sendToRenderer(IPC.EVT_LLM_DOWNLOAD_STARTED, data);
      }
    );

    this.deps.modelDownloader.on('downloadCompleted', (data: { modelId: string; path: string }) => {
      this.sendToRenderer(IPC.EVT_LLM_DOWNLOAD_COMPLETED, data);
    });

    this.deps.modelDownloader.on('downloadFailed', (data: { modelId: string; error: string }) => {
      this.sendToRenderer(IPC.EVT_LLM_DOWNLOAD_FAILED, data);
    });

    this.deps.modelDownloader.on('downloadCancelled', (data: { modelId: string }) => {
      this.sendToRenderer(IPC.EVT_LLM_DOWNLOAD_CANCELLED, data);
    });

    // Forward LLM server events
    this.deps.llmServerManager.on(
      'modelLoaded',
      (data: { modelPath: string; loadTimeSeconds: number }) => {
        this.sendToRenderer(IPC.EVT_LLM_MODEL_LOADED, data);
      }
    );

    this.deps.llmServerManager.on('modelUnloaded', () => {
      this.sendToRenderer(IPC.EVT_LLM_MODEL_UNLOADED, {});
    });

    this.deps.llmServerManager.on('generationStarted', (data: { textLength: number }) => {
      this.sendToRenderer(IPC.EVT_LLM_GENERATION_STARTED, data);
    });

    this.deps.llmServerManager.on('generationCompleted', (data: { timeSeconds: number }) => {
      this.sendToRenderer(IPC.EVT_LLM_GENERATION_COMPLETED, data);
    });

    this.deps.llmServerManager.on('error', (data: { error: Error | string }) => {
      this.sendToRenderer(IPC.EVT_LLM_ERROR, {
        error: typeof data.error === 'string' ? data.error : data.error.message,
      });
    });
  }

  /**
   * Send event to renderer process
   */
  private sendToRenderer(channel: string, data: unknown): void {
    if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
      this.deps.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Update the main window reference
   */
  updateMainWindow(mainWindow: BrowserWindow | null): void {
    this.deps.mainWindow = mainWindow;
  }

  /**
   * Register all LLM-related IPC handlers
   */
  register(): void {
    logger.info('LLMHandlers: Registering IPC handlers');

    // Status and lifecycle
    ipcMain.handle(IPC.LLM_GET_STATUS, this.handleGetStatus.bind(this));
    ipcMain.handle(IPC.LLM_LOAD_MODEL, this.handleLoadModel.bind(this));
    ipcMain.handle(IPC.LLM_UNLOAD_MODEL, this.handleUnloadModel.bind(this));
    ipcMain.handle(IPC.LLM_GET_LOADED_MODEL, this.handleGetLoadedModel.bind(this));

    // Model catalog
    ipcMain.handle(IPC.LLM_GET_AVAILABLE_MODELS, this.handleGetAvailableModels.bind(this));
    ipcMain.handle(IPC.LLM_GET_DOWNLOADED_MODELS, this.handleGetDownloadedModels.bind(this));
    ipcMain.handle(IPC.LLM_DOWNLOAD_MODEL, this.handleDownloadModel.bind(this));
    ipcMain.handle(IPC.LLM_DELETE_MODEL, this.handleDeleteModel.bind(this));
    ipcMain.handle(IPC.LLM_CANCEL_DOWNLOAD, this.handleCancelDownload.bind(this));

    // Inference
    ipcMain.handle(IPC.LLM_GENERATE_SUMMARY, this.handleGenerateSummary.bind(this));

    // GPU
    ipcMain.handle(IPC.LLM_GET_GPU_INFO, this.handleGetGPUInfo.bind(this));
    ipcMain.handle(IPC.LLM_GET_RECOMMENDED_MODELS, this.handleGetRecommendedModels.bind(this));

    // Settings
    ipcMain.handle(IPC.LLM_GET_MODEL_PARAMETERS, this.handleGetModelParameters.bind(this));
    ipcMain.handle(IPC.LLM_SET_MODEL_PARAMETERS, this.handleSetModelParameters.bind(this));
    ipcMain.handle(IPC.LLM_GET_DEFAULT_MODEL, this.handleGetDefaultModel.bind(this));
    ipcMain.handle(IPC.LLM_SET_DEFAULT_MODEL, this.handleSetDefaultModel.bind(this));

    // HuggingFace
    ipcMain.handle(IPC.LLM_SET_HF_TOKEN, this.handleSetHuggingFaceToken.bind(this));
    ipcMain.handle(IPC.LLM_GET_HF_TOKEN, this.handleGetHuggingFaceToken.bind(this));
    ipcMain.handle(IPC.LLM_VALIDATE_HF_TOKEN, this.handleValidateHuggingFaceToken.bind(this));
    ipcMain.handle(IPC.LLM_CLEAR_HF_TOKEN, this.handleClearHuggingFaceToken.bind(this));
    ipcMain.handle(IPC.LLM_HAS_HF_TOKEN, this.handleHasHuggingFaceToken.bind(this));

    // Prompts
    ipcMain.handle(IPC.LLM_GET_PROMPTS, this.handleGetPrompts.bind(this));
    ipcMain.handle(IPC.LLM_SET_PROMPTS, this.handleSetPrompts.bind(this));
    ipcMain.handle(IPC.LLM_RESET_PROMPTS, this.handleResetPrompts.bind(this));

    // Server management
    ipcMain.handle(IPC.LLM_START_SERVER, this.handleStartServer.bind(this));
    ipcMain.handle(IPC.LLM_STOP_SERVER, this.handleStopServer.bind(this));
    ipcMain.handle(IPC.LLM_RESTART_SERVER, this.handleRestartServer.bind(this));

    // Custom model management
    ipcMain.handle(IPC.LLM_GET_DISK_USAGE, this.handleGetDiskUsage.bind(this));
    ipcMain.handle(IPC.LLM_PARSE_HF_URL, this.handleParseHuggingFaceUrl.bind(this));
    ipcMain.handle(IPC.LLM_DOWNLOAD_CUSTOM_MODEL, this.handleDownloadCustomModel.bind(this));
    ipcMain.handle(IPC.LLM_REMOVE_CUSTOM_MODEL, this.handleRemoveCustomModel.bind(this));
    ipcMain.handle(IPC.LLM_VALIDATE_CATALOG_URLS, this.handleValidateCatalogUrls.bind(this));
    ipcMain.handle(IPC.LLM_OPEN_MODELS_DIRECTORY, this.handleOpenModelsDirectory.bind(this));
    ipcMain.handle(IPC.LLM_REFRESH_MODELS, this.handleRefreshModels.bind(this));

    logger.info('LLMHandlers: All handlers registered successfully');
  }

  // ===========================================================================
  // Status and Lifecycle Handlers
  // ===========================================================================

  /**
   * Get comprehensive LLM status
   */
  private async handleGetStatus(): Promise<LLMStatus> {
    try {
      const serverState = this.deps.llmServerManager.getState();
      const gpuResult = await this.deps.gpuService.detect();

      // Try to get model name if loaded
      let modelId: string | null = null;
      let modelName: string | null = null;

      if (serverState.modelPath) {
        // Find model by path
        const downloaded = this.deps.modelDownloader.getDownloadedModels();
        const match = downloaded.find((m) => m.path === serverState.modelPath);
        if (match) {
          modelId = match.id;
          const catalogEntry = this.deps.modelRegistry.getModel(match.id);
          modelName = catalogEntry?.name ?? match.id;
        }
      }

      return {
        serverStatus: serverState,
        modelLoaded: serverState.modelLoaded,
        modelId,
        modelName,
        gpuCapabilities: gpuResult.capabilities,
      };
    } catch (error) {
      logger.error('LLMHandlers: Failed to get status', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Load a model
   */
  private async handleLoadModel(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const validated = LoadModelSchema.parse(request);
      logger.info('LLMHandlers: Loading model', { modelId: validated.modelId });

      // Get model path
      const modelPath = this.deps.modelDownloader.getModelPath(validated.modelId);

      // Check if downloaded
      if (!this.deps.modelDownloader.isModelDownloaded(validated.modelId)) {
        return { success: false, error: 'Model not downloaded' };
      }

      // Get model info for context window
      const modelInfo = this.deps.modelRegistry.getModel(validated.modelId);
      const nCtx = validated.nCtx ?? modelInfo?.contextWindow ?? 4096;
      const nGpuLayers = validated.nGpuLayers ?? -1;

      // Ensure server is running
      if (this.deps.llmServerManager.getState().status === 'stopped') {
        await this.deps.llmServerManager.start();
      }

      // GPU is required — verify the Python backend has CUDA support before loading
      const gpuStatus = await this.deps.llmServerManager.checkGpuStatus();
      if (!gpuStatus.gpuAvailable) {
        logger.error('LLMHandlers: GPU not available in LLM backend', {
          detail: gpuStatus.detail,
        });
        return {
          success: false,
          error:
            'GPU acceleration is required but not available. ' +
            'The AI backend was built without CUDA support.',
        };
      }

      // Load model
      await this.deps.llmServerManager.loadModel({
        modelPath,
        nGpuLayers,
        nCtx,
      });

      // Persist the context window so settings UI reflects what's actually loaded
      await this.deps.storage.settings.set(SETTINGS_KEYS.contextWindow, nCtx.toString());

      return { success: true };
    } catch (error) {
      logger.error('LLMHandlers: Failed to load model', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Unload the current model
   */
  private async handleUnloadModel(): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info('LLMHandlers: Unloading model');
      await this.deps.llmServerManager.unloadModel();
      return { success: true };
    } catch (error) {
      logger.error('LLMHandlers: Failed to unload model', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get info about the currently loaded model
   */
  private async handleGetLoadedModel(): Promise<{
    loaded: boolean;
    modelId: string | null;
    modelInfo: ModelCatalogEntry | null;
    modelPath: string | null;
  }> {
    try {
      const state = this.deps.llmServerManager.getState();

      if (!state.modelLoaded || !state.modelPath) {
        return { loaded: false, modelId: null, modelInfo: null, modelPath: null };
      }

      // Find model by path
      const downloaded = this.deps.modelDownloader.getDownloadedModels();
      const match = downloaded.find((m) => m.path === state.modelPath);

      if (!match) {
        return { loaded: true, modelId: null, modelInfo: null, modelPath: state.modelPath };
      }

      const modelInfo = this.deps.modelRegistry.getModel(match.id);

      return {
        loaded: true,
        modelId: match.id,
        modelInfo,
        modelPath: state.modelPath,
      };
    } catch (error) {
      logger.error('LLMHandlers: Failed to get loaded model', {
        error: error instanceof Error ? error.message : error,
      });
      return { loaded: false, modelId: null, modelInfo: null, modelPath: null };
    }
  }

  // ===========================================================================
  // Model Catalog Handlers
  // ===========================================================================

  /**
   * Get all available models from the catalog
   */
  private async handleGetAvailableModels(): Promise<ModelCatalogEntry[]> {
    try {
      return this.deps.modelRegistry.getAllModels();
    } catch (error) {
      logger.error('LLMHandlers: Failed to get available models', {
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  /**
   * Get all downloaded models
   */
  private async handleGetDownloadedModels(): Promise<DownloadedModel[]> {
    try {
      return this.deps.modelDownloader.getDownloadedModels();
    } catch (error) {
      logger.error('LLMHandlers: Failed to get downloaded models', {
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  /**
   * Download a model
   */
  private async handleDownloadModel(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      const validated = DownloadModelSchema.parse(request);
      logger.info('LLMHandlers: Downloading model', { modelId: validated.modelId });

      // Get HF token if model requires auth
      let hfToken = validated.hfToken;
      const model = this.deps.modelRegistry.getModel(validated.modelId);

      if (model?.requiresAuth && !hfToken) {
        hfToken = (await this.deps.hfAuth.getToken()) ?? undefined;
        if (!hfToken) {
          return { success: false, error: 'HuggingFace token required for this model' };
        }
      }

      const result = await this.deps.modelDownloader.download({
        modelId: validated.modelId,
        hfToken,
      });

      return {
        success: result.success,
        path: result.path,
        error: result.error,
      };
    } catch (error) {
      logger.error('LLMHandlers: Failed to download model', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete a downloaded model
   */
  private async handleDeleteModel(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const validated = DeleteModelSchema.parse(request);
      logger.info('LLMHandlers: Deleting model', { modelId: validated.modelId });

      // Unload model if it's currently loaded
      const state = this.deps.llmServerManager.getState();
      const modelPath = this.deps.modelDownloader.getModelPath(validated.modelId);

      if (state.modelPath === modelPath) {
        await this.deps.llmServerManager.unloadModel();
      }

      const result = await this.deps.modelDownloader.deleteModel(validated.modelId);

      return {
        success: result.success,
        error: result.error,
      };
    } catch (error) {
      logger.error('LLMHandlers: Failed to delete model', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Cancel an active download
   */
  private async handleCancelDownload(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean }> {
    try {
      const validated = CancelDownloadSchema.parse(request);
      logger.info('LLMHandlers: Cancelling download', { modelId: validated.modelId });

      const cancelled = this.deps.modelDownloader.cancelDownload(validated.modelId);

      return { success: cancelled };
    } catch (error) {
      logger.error('LLMHandlers: Failed to cancel download', {
        error: error instanceof Error ? error.message : error,
      });
      return { success: false };
    }
  }

  // ===========================================================================
  // Inference Handlers
  // ===========================================================================

  /**
   * Generate a summary using the local LLM
   */
  async handleGenerateSummary(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; result?: GenerateSummaryResponse; error?: string }> {
    try {
      const validated = GenerateSummarySchema.parse(request);
      logger.info('LLMHandlers: Generating summary', {
        transcriptionId: validated.transcriptionId,
        textLength: validated.text.length,
        analysisType: validated.analysisType,
      });

      // Check if model is loaded
      if (!this.deps.llmServerManager.isReady()) {
        return { success: false, error: 'NO_MODEL_LOADED' };
      }

      // Generate summary
      const result = await this.deps.llmServerManager.generateSummary({
        text: validated.text,
        analysisType: validated.analysisType,
        skipRefinement: validated.skipRefinement,
      });

      return { success: true, result };
    } catch (error) {
      logger.error('LLMHandlers: Failed to generate summary', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ===========================================================================
  // GPU Handlers
  // ===========================================================================

  /**
   * Get GPU information and capabilities
   */
  private async handleGetGPUInfo(): Promise<{
    success: boolean;
    gpu: GPUInfo | null;
    capabilities: GPUCapabilities | null;
    error?: string;
  }> {
    try {
      const result = await this.deps.gpuService.detect();

      // Populate recommendedModelId using the model registry
      if (result.capabilities.supported && result.capabilities.vramBudgetMB > 0) {
        const recommended = this.deps.modelRegistry.getRecommendedModelForVram(
          result.capabilities.vramBudgetMB
        );
        result.capabilities.recommendedModelId = recommended?.id ?? null;
      }

      return {
        success: result.success,
        gpu: result.capabilities.gpu,
        capabilities: result.capabilities,
        error: result.error,
      };
    } catch (error) {
      logger.error('LLMHandlers: Failed to get GPU info', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        gpu: null,
        capabilities: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get recommended models based on GPU capabilities
   */
  private async handleGetRecommendedModels(): Promise<ModelCatalogEntry[]> {
    try {
      const result = await this.deps.gpuService.detect();

      if (!result.success || !result.capabilities.supported) {
        return [];
      }

      return this.deps.modelRegistry.getRecommendedModels(result.capabilities);
    } catch (error) {
      logger.error('LLMHandlers: Failed to get recommended models', {
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  // ===========================================================================
  // Settings Handlers
  // ===========================================================================

  /**
   * Get model parameters
   */
  private async handleGetModelParameters(): Promise<ModelParameters> {
    try {
      const overrides: Partial<Record<keyof ModelParameters, string | null>> = {
        temperatureExtract: await this.deps.storage.settings.get(SETTINGS_KEYS.temperatureExtract),
        temperatureRefine: await this.deps.storage.settings.get(SETTINGS_KEYS.temperatureRefine),
        maxTokens: await this.deps.storage.settings.get(SETTINGS_KEYS.maxTokens),
        topP: await this.deps.storage.settings.get(SETTINGS_KEYS.topP),
        contextWindow: await this.deps.storage.settings.get(SETTINGS_KEYS.contextWindow),
        nGpuLayers: await this.deps.storage.settings.get(SETTINGS_KEYS.nGpuLayers),
      };

      return buildModelParameters(overrides);
    } catch (error) {
      logger.error('LLMHandlers: Failed to get model parameters', {
        error: error instanceof Error ? error.message : error,
      });
      return DEFAULT_MODEL_PARAMETERS;
    }
  }

  /**
   * Set model parameters
   */
  private async handleSetModelParameters(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const validated = ModelParametersSchema.parse(request);

      if (validated.temperatureExtract !== undefined) {
        await this.deps.storage.settings.set(
          SETTINGS_KEYS.temperatureExtract,
          validated.temperatureExtract.toString()
        );
      }
      if (validated.temperatureRefine !== undefined) {
        await this.deps.storage.settings.set(
          SETTINGS_KEYS.temperatureRefine,
          validated.temperatureRefine.toString()
        );
      }
      if (validated.maxTokens !== undefined) {
        await this.deps.storage.settings.set(
          SETTINGS_KEYS.maxTokens,
          validated.maxTokens.toString()
        );
      }
      if (validated.topP !== undefined) {
        await this.deps.storage.settings.set(SETTINGS_KEYS.topP, validated.topP.toString());
      }
      if (validated.contextWindow !== undefined) {
        await this.deps.storage.settings.set(
          SETTINGS_KEYS.contextWindow,
          validated.contextWindow.toString()
        );
      }
      if (validated.nGpuLayers !== undefined) {
        await this.deps.storage.settings.set(
          SETTINGS_KEYS.nGpuLayers,
          validated.nGpuLayers.toString()
        );
      }

      return { success: true };
    } catch (error) {
      logger.error('LLMHandlers: Failed to set model parameters', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get the default model ID
   */
  private async handleGetDefaultModel(): Promise<string | null> {
    try {
      return await this.deps.storage.settings.get(SETTINGS_KEYS.defaultModel);
    } catch (error) {
      logger.error('LLMHandlers: Failed to get default model', {
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Set the default model ID
   */
  private async handleSetDefaultModel(
    _event: Electron.IpcMainInvokeEvent,
    modelId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!modelId) {
        return { success: false, error: 'Model ID required' };
      }

      await this.deps.storage.settings.set(SETTINGS_KEYS.defaultModel, modelId);
      return { success: true };
    } catch (error) {
      logger.error('LLMHandlers: Failed to set default model', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ===========================================================================
  // HuggingFace Handlers
  // ===========================================================================

  /**
   * Set HuggingFace token
   */
  private async handleSetHuggingFaceToken(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; user?: { name: string }; error?: string }> {
    try {
      const validated = SetHuggingFaceTokenSchema.parse(request);
      logger.info('LLMHandlers: Setting HuggingFace token');

      await this.deps.hfAuth.setToken(validated.token);
      const userInfo = this.deps.hfAuth.getCachedUserInfo();

      return {
        success: true,
        user: userInfo ? { name: userInfo.name } : undefined,
      };
    } catch (error) {
      logger.error('LLMHandlers: Failed to set HuggingFace token', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get HuggingFace token (masked)
   */
  private async handleGetHuggingFaceToken(): Promise<{
    hasToken: boolean;
    maskedToken: string | null;
    user: { name: string } | null;
  }> {
    try {
      const token = await this.deps.hfAuth.getToken();
      const userInfo = this.deps.hfAuth.getCachedUserInfo();

      if (!token) {
        return { hasToken: false, maskedToken: null, user: null };
      }

      // Mask token for display (show first and last 4 chars)
      const masked =
        token.length > 8
          ? `${token.substring(0, 4)}...${token.substring(token.length - 4)}`
          : '****';

      return {
        hasToken: true,
        maskedToken: masked,
        user: userInfo ? { name: userInfo.name } : null,
      };
    } catch (error) {
      logger.error('LLMHandlers: Failed to get HuggingFace token', {
        error: error instanceof Error ? error.message : error,
      });
      return { hasToken: false, maskedToken: null, user: null };
    }
  }

  /**
   * Validate the stored HuggingFace token
   */
  private async handleValidateHuggingFaceToken(): Promise<TokenValidationResult> {
    try {
      return await this.deps.hfAuth.validateStoredToken();
    } catch (error) {
      logger.error('LLMHandlers: Failed to validate HuggingFace token', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Clear HuggingFace token
   */
  private async handleClearHuggingFaceToken(): Promise<{ success: boolean }> {
    try {
      await this.deps.hfAuth.clearToken();
      return { success: true };
    } catch (error) {
      logger.error('LLMHandlers: Failed to clear HuggingFace token', {
        error: error instanceof Error ? error.message : error,
      });
      return { success: false };
    }
  }

  /**
   * Check if HuggingFace token exists
   */
  private async handleHasHuggingFaceToken(): Promise<boolean> {
    try {
      return this.deps.hfAuth.hasToken();
    } catch (error) {
      logger.error('LLMHandlers: Failed to check HuggingFace token', {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  // ===========================================================================
  // Prompts Handlers
  // ===========================================================================

  /**
   * Get custom prompts - reads from the active prompt template if set
   */
  private async handleGetPrompts(): Promise<PromptsConfig> {
    try {
      // Check if there's an active prompt template
      const activeTemplateId = await this.deps.storage.settings.get('llm.activePromptTemplateId');

      if (activeTemplateId) {
        try {
          const db = this.deps.storage.database.getDatabase();
          const row = db
            .prepare(`SELECT system_prompt, output_structure FROM prompt_templates WHERE id = ?`)
            .get(activeTemplateId) as
            | { system_prompt: string; output_structure: string }
            | undefined;

          if (row) {
            let structure: Record<string, unknown> = {};
            if (row.output_structure && row.output_structure !== '{}') {
              try {
                structure = JSON.parse(row.output_structure);
              } catch {
                // Invalid JSON, use empty object
              }
            }
            return {
              systemPrompt: row.system_prompt,
              structure,
            };
          }
        } catch (dbError) {
          logger.warn('LLMHandlers: Failed to read active template, falling back to settings', {
            error: dbError instanceof Error ? dbError.message : dbError,
          });
        }
      }

      // Fallback to legacy settings-based prompts
      const systemPrompt = await this.deps.storage.settings.get(SETTINGS_KEYS.systemPrompt);
      const structureJson = await this.deps.storage.settings.get(SETTINGS_KEYS.promptStructure);

      let structure: Record<string, unknown> = {};
      if (structureJson) {
        try {
          structure = JSON.parse(structureJson);
        } catch {
          // Invalid JSON, use empty object
        }
      }

      return {
        systemPrompt: systemPrompt ?? '',
        structure,
      };
    } catch (error) {
      logger.error('LLMHandlers: Failed to get prompts', {
        error: error instanceof Error ? error.message : error,
      });
      return { systemPrompt: '', structure: {} };
    }
  }

  /**
   * Set custom prompts
   */
  private async handleSetPrompts(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const validated = SetPromptsSchema.parse(request);

      if (validated.systemPrompt !== undefined) {
        await this.deps.storage.settings.set(SETTINGS_KEYS.systemPrompt, validated.systemPrompt);
      }

      if (validated.structure !== undefined) {
        await this.deps.storage.settings.set(
          SETTINGS_KEYS.promptStructure,
          JSON.stringify(validated.structure)
        );
      }

      return { success: true };
    } catch (error) {
      logger.error('LLMHandlers: Failed to set prompts', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Reset prompts to defaults
   */
  private async handleResetPrompts(): Promise<{ success: boolean }> {
    try {
      // Remove custom prompts (empty string means use defaults)
      await this.deps.storage.settings.set(SETTINGS_KEYS.systemPrompt, '');
      await this.deps.storage.settings.set(SETTINGS_KEYS.promptStructure, '');

      return { success: true };
    } catch (error) {
      logger.error('LLMHandlers: Failed to reset prompts', {
        error: error instanceof Error ? error.message : error,
      });
      return { success: false };
    }
  }

  // ===========================================================================
  // Server Management Handlers
  // ===========================================================================

  /**
   * Start the LLM server
   */
  private async handleStartServer(): Promise<{ success: boolean; port?: number; error?: string }> {
    try {
      await this.deps.llmServerManager.start();
      return { success: true, port: this.deps.llmServerManager.getPort() };
    } catch (error) {
      logger.error('LLMHandlers: Failed to start server', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Stop the LLM server
   */
  private async handleStopServer(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.deps.llmServerManager.stop();
      return { success: true };
    } catch (error) {
      logger.error('LLMHandlers: Failed to stop server', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Restart the LLM server
   */
  private async handleRestartServer(): Promise<{
    success: boolean;
    port?: number;
    error?: string;
  }> {
    try {
      await this.deps.llmServerManager.restart();
      return { success: true, port: this.deps.llmServerManager.getPort() };
    } catch (error) {
      logger.error('LLMHandlers: Failed to restart server', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ===========================================================================
  // Custom Model Management Handlers
  // ===========================================================================

  /**
   * Get disk usage for the models directory
   */
  private async handleGetDiskUsage(): Promise<DiskUsageResult> {
    try {
      return this.deps.modelDownloader.getDiskUsage();
    } catch (error) {
      logger.error('LLMHandlers: Failed to get disk usage', {
        error: error instanceof Error ? error.message : error,
      });
      return { totalBytes: 0, modelCount: 0, modelsDir: '', models: [] };
    }
  }

  /**
   * Parse a HuggingFace URL
   */
  private async handleParseHuggingFaceUrl(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<ParsedHuggingFaceUrl> {
    try {
      const validated = ParseHuggingFaceUrlSchema.parse(request);
      const result = ModelDownloader.parseHuggingFaceUrl(validated.url);

      // If it's a repo URL, fetch available .gguf files
      if (result.isValid && result.isRepoUrl) {
        const hfToken = (await this.deps.hfAuth.getToken()) ?? undefined;
        const ggufFiles = await ModelDownloader.listRepoGgufFiles(
          result.repo,
          result.branch,
          hfToken
        );
        result.ggufFiles = ggufFiles;

        if (ggufFiles.length === 0) {
          result.error = 'No GGUF files found in this repository';
        }
      }

      return result;
    } catch (error) {
      logger.error('LLMHandlers: Failed to parse HuggingFace URL', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        repo: '',
        filename: null,
        branch: 'main',
        downloadUrl: null,
        isValid: false,
        isRepoUrl: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Download a custom model from a HuggingFace URL
   */
  private async handleDownloadCustomModel(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      const validated = DownloadCustomModelSchema.parse(request);
      logger.info('LLMHandlers: Downloading custom model', {
        modelId: validated.modelId,
        filename: validated.filename,
      });

      // Get HF token if available
      const hfToken = (await this.deps.hfAuth.getToken()) ?? undefined;

      // Start the download
      const result = await this.deps.modelDownloader.downloadFromUrl(
        validated.url,
        validated.filename,
        validated.modelId,
        { hfToken }
      );

      if (result.success && result.path) {
        // Register as a custom model in the registry
        const stats = await import('node:fs').then((fs) => fs.statSync(result.path!));
        this.deps.modelRegistry.addCustomModel({
          id: validated.modelId,
          name: validated.name ?? validated.filename.replace('.gguf', ''),
          description: `Downloaded from HuggingFace${validated.repo ? ` (${validated.repo})` : ''}`,
          size: formatBytesForCatalog(stats.size),
          sizeBytes: stats.size,
          vramRequired: 0,
          vramMinimum: 0,
          quality: 'good',
          huggingFaceRepo: validated.repo ?? '',
          filename: validated.filename,
          requiresAuth: false,
          contextWindow: 4096,
          quantization: 'Q4_K_M',
          parameterCount: 0,
          license: 'unknown',
          tags: ['custom'],
          isCustom: true,
          source: 'custom-hf',
        });
      }

      return { success: result.success, path: result.path, error: result.error };
    } catch (error) {
      logger.error('LLMHandlers: Failed to download custom model', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Remove a custom model (file + registry entry)
   */
  private async handleRemoveCustomModel(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const validated = RemoveCustomModelSchema.parse(request);
      logger.info('LLMHandlers: Removing custom model', { modelId: validated.modelId });

      // Unload if currently loaded
      const state = this.deps.llmServerManager.getState();
      try {
        const modelPath = this.deps.modelDownloader.getModelPath(validated.modelId);
        if (state.modelPath === modelPath) {
          await this.deps.llmServerManager.unloadModel();
        }
      } catch {
        // Model path may not resolve — that's fine
      }

      // Remove from custom registry
      this.deps.modelRegistry.removeCustomModel(validated.modelId);

      // Try to delete the file
      const model = this.deps.modelRegistry.getModel(validated.modelId);
      if (model) {
        try {
          const result = await this.deps.modelDownloader.deleteModel(validated.modelId);
          return { success: result.success, error: result.error };
        } catch {
          // If deleteModel fails (e.g. unknown model now), try manual cleanup
        }
      }

      return { success: true };
    } catch (error) {
      logger.error('LLMHandlers: Failed to remove custom model', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Validate catalog model URLs via HEAD requests
   */
  private async handleValidateCatalogUrls(
    _event: Electron.IpcMainInvokeEvent,
    request?: unknown
  ): Promise<CatalogHealthResult[]> {
    try {
      const validated = request
        ? ValidateCatalogUrlsSchema.parse(request)
        : { modelIds: undefined };
      const models = this.deps.modelRegistry.getAllModels();
      const modelIds = validated.modelIds ?? models.filter((m) => !m.isCustom).map((m) => m.id);

      const results = await Promise.all(
        modelIds.map((id) => this.deps.modelRegistry.validateCatalogUrl(id))
      );

      return results;
    } catch (error) {
      logger.error('LLMHandlers: Failed to validate catalog URLs', {
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  /**
   * Open the models directory in the system file manager
   */
  private async handleOpenModelsDirectory(): Promise<{ success: boolean; error?: string }> {
    try {
      const modelsDir = this.deps.modelDownloader.getModelsDirectory();
      await shell.openPath(modelsDir);
      return { success: true };
    } catch (error) {
      logger.error('LLMHandlers: Failed to open models directory', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Refresh models: re-scan directory for newly added/removed files
   */
  private async handleRefreshModels(): Promise<{
    downloadedModels: DownloadedModel[];
    diskUsage: DiskUsageResult;
  }> {
    try {
      // Reload custom models from disk
      this.deps.modelRegistry.loadCustomModels();

      // Get fresh data
      const downloadedModels = this.deps.modelDownloader.getDownloadedModels();
      const diskUsage = this.deps.modelDownloader.getDiskUsage();

      return { downloadedModels, diskUsage };
    } catch (error) {
      logger.error('LLMHandlers: Failed to refresh models', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        downloadedModels: [],
        diskUsage: { totalBytes: 0, modelCount: 0, modelsDir: '', models: [] },
      };
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Cleanup handler - remove all IPC listeners
   */
  cleanup(): void {
    logger.info('LLMHandlers: Cleaning up IPC handlers');

    // Remove all registered handlers
    const channels = [
      IPC.LLM_GET_STATUS,
      IPC.LLM_LOAD_MODEL,
      IPC.LLM_UNLOAD_MODEL,
      IPC.LLM_GET_LOADED_MODEL,
      IPC.LLM_GET_AVAILABLE_MODELS,
      IPC.LLM_GET_DOWNLOADED_MODELS,
      IPC.LLM_DOWNLOAD_MODEL,
      IPC.LLM_DELETE_MODEL,
      IPC.LLM_CANCEL_DOWNLOAD,
      IPC.LLM_GENERATE_SUMMARY,
      IPC.LLM_GET_GPU_INFO,
      IPC.LLM_GET_RECOMMENDED_MODELS,
      IPC.LLM_GET_MODEL_PARAMETERS,
      IPC.LLM_SET_MODEL_PARAMETERS,
      IPC.LLM_GET_DEFAULT_MODEL,
      IPC.LLM_SET_DEFAULT_MODEL,
      IPC.LLM_SET_HF_TOKEN,
      IPC.LLM_GET_HF_TOKEN,
      IPC.LLM_VALIDATE_HF_TOKEN,
      IPC.LLM_CLEAR_HF_TOKEN,
      IPC.LLM_HAS_HF_TOKEN,
      IPC.LLM_GET_PROMPTS,
      IPC.LLM_SET_PROMPTS,
      IPC.LLM_RESET_PROMPTS,
      IPC.LLM_START_SERVER,
      IPC.LLM_STOP_SERVER,
      IPC.LLM_RESTART_SERVER,
      IPC.LLM_GET_DISK_USAGE,
      IPC.LLM_PARSE_HF_URL,
      IPC.LLM_DOWNLOAD_CUSTOM_MODEL,
      IPC.LLM_REMOVE_CUSTOM_MODEL,
      IPC.LLM_VALIDATE_CATALOG_URLS,
      IPC.LLM_OPEN_MODELS_DIRECTORY,
      IPC.LLM_REFRESH_MODELS,
    ];

    for (const channel of channels) {
      ipcMain.removeAllListeners(channel);
    }

    logger.info('LLMHandlers: Cleanup completed');
  }
}
