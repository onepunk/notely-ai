import { BrowserWindow } from 'electron';

import type {
  MeetingReminderState,
  MeetingReminderTriggerPayload,
} from '../../common/meetingReminder';
import { type IAuthService } from '../auth';
import { logger } from '../logger';
import { AuthManager } from '../managers/AuthManager';
import type { ExportService } from '../services/export';
import { type FeatureFlagsService } from '../services/featureFlags';
import { GPUDetectionService } from '../services/gpu/GPUDetectionService';
import { LicenseService } from '../services/license/LicenseService';
import { LLMServerManager } from '../services/llm/LLMServerManager';
import { MeetingReminderManager } from '../services/MeetingReminderManager';
import { HuggingFaceAuth } from '../services/models/HuggingFaceAuth';
import { ModelDownloader } from '../services/models/ModelDownloader';
import { ModelRegistry } from '../services/models/ModelRegistry';
import { type UpdateService } from '../services/update';
import { type IStorageService } from '../storage/index';

import { AuthHandlers } from './AuthHandlers';
import { DiagnosticsHandlers } from './DiagnosticsHandlers';
import { ExportHandlers } from './ExportHandlers';
import { LicenseHandlers } from './LicenseHandlers';
import { LLMHandlers } from './LLMHandlers';
import { MeetingReminderHandlers } from './MeetingReminderHandlers';
import { PromptTemplateHandlers } from './PromptTemplateHandlers';
import { SecurityHandlers } from './SecurityHandlers';
import { SettingsHandlers } from './SettingsHandlers';
import { StorageHandlers } from './StorageHandlers';
import { SummaryHandlers } from './SummaryHandlers';
import { SystemAudioHandlers } from './SystemAudioHandlers';
import { TagHandlers } from './TagHandlers';
import { TranscriptionHandlers } from './TranscriptionHandlers';
import { UpdateHandlers } from './UpdateHandlers';
import { WindowHandlers } from './WindowHandlers';

export interface IPCHandlerRegistryDependencies {
  storage: IStorageService;
  authService: IAuthService;
  authManager: AuthManager;
  mainWindow?: BrowserWindow | null;
  getActiveTranscriptionSessionId: () => string | null;
  setActiveTranscriptionSessionId: (sessionId: string | null) => void;
  restartTranscriptionServer?: () => Promise<void>;
  getTranscriptionServerPort?: () => number;
  refineTranscription?: (
    wavPath: string,
    hints?: string
  ) => Promise<{ text: string; used_hints?: boolean }>;
  meetingReminderManager?: MeetingReminderManager;
  showReminderWindow?: (
    payload: MeetingReminderTriggerPayload,
    state: MeetingReminderState
  ) => Promise<void>;
  hideReminderWindow?: () => void;
  licenseService: LicenseService;
  featureFlagsService: FeatureFlagsService;
  updateService?: UpdateService;
  /** Base directory for storage (needed for security handlers) */
  baseDir?: string;
  /** Skip security handlers registration (if already registered early for password unlock) */
  skipSecurityHandlers?: boolean;
  /** Export service for note export functionality */
  exportService?: ExportService;
  /** LLM server manager for local AI inference (Notely AI) */
  llmServerManager?: LLMServerManager;
}

/**
 * IPCHandlerRegistry coordinates all IPC handler modules and provides
 * centralized registration, cleanup, and dependency management.
 *
 * This follows the registry pattern to organize related handlers
 * and ensure proper lifecycle management.
 *
 * Note: This is Notely AI - cloud sync and calendar handlers have been
 * removed in favor of local-only operation with on-device AI.
 */
export class IPCHandlerRegistry {
  private storageHandlers: StorageHandlers;
  private settingsHandlers: SettingsHandlers;
  private summaryHandlers: SummaryHandlers;
  private transcriptionHandlers: TranscriptionHandlers;
  private windowHandlers: WindowHandlers;
  private licenseHandlers: LicenseHandlers;
  private meetingReminderHandlers?: MeetingReminderHandlers;
  private meetingReminderManager?: MeetingReminderManager;
  private authHandlers: AuthHandlers;
  private updateHandlers?: UpdateHandlers;
  private systemAudioHandlers: SystemAudioHandlers;
  private tagHandlers: TagHandlers;
  private securityHandlers?: SecurityHandlers;
  private exportHandlers?: ExportHandlers;
  private llmHandlers?: LLMHandlers;
  private promptTemplateHandlers: PromptTemplateHandlers;
  private diagnosticsHandlers: DiagnosticsHandlers;

  constructor(private deps: IPCHandlerRegistryDependencies) {
    logger.info('IPCHandlerRegistry: Initializing handler modules (standalone mode)');

    // Initialize all handler modules with their dependencies
    this.storageHandlers = new StorageHandlers({
      storage: deps.storage,
      mainWindow: deps.mainWindow || null,
    });

    this.settingsHandlers = new SettingsHandlers({
      storage: deps.storage,
      mainWindow: deps.mainWindow || null,
      authProvider: deps.authService,
    });

    // Standalone mode: summaries are generated locally, no cloud sync needed
    this.summaryHandlers = new SummaryHandlers({
      storage: deps.storage,
    });

    this.transcriptionHandlers = new TranscriptionHandlers({
      storage: deps.storage,
      getActiveTranscriptionSessionId: deps.getActiveTranscriptionSessionId,
      setActiveTranscriptionSessionId: deps.setActiveTranscriptionSessionId,
      restartTranscriptionServer: deps.restartTranscriptionServer,
      getTranscriptionServerPort: deps.getTranscriptionServerPort,
      refineTranscription: deps.refineTranscription,
      mainWindow: deps.mainWindow,
    });

    this.windowHandlers = new WindowHandlers({
      mainWindow: deps.mainWindow || null,
      onRendererReady: this.handleRendererReady.bind(this),
      settings: deps.storage.settings,
    });

    if (deps.meetingReminderManager) {
      this.meetingReminderManager = deps.meetingReminderManager;
      this.meetingReminderHandlers = new MeetingReminderHandlers({
        mainWindow: deps.mainWindow || null,
        meetingReminderManager: deps.meetingReminderManager,
        storage: deps.storage,
        showReminderWindow: deps.showReminderWindow,
        hideReminderWindow: deps.hideReminderWindow,
      });
    }

    this.licenseHandlers = new LicenseHandlers({
      licenseService: deps.licenseService,
      featureFlagsService: deps.featureFlagsService,
      mainWindow: deps.mainWindow || null,
    });

    this.authHandlers = new AuthHandlers({
      authService: deps.authService,
      authManager: deps.authManager,
    });

    // Initialize UpdateHandlers if updateService is provided
    if (deps.updateService) {
      this.updateHandlers = new UpdateHandlers({
        updateService: deps.updateService,
        mainWindow: deps.mainWindow || null,
      });
    }

    // Initialize SystemAudioHandlers for system audio capture
    this.systemAudioHandlers = new SystemAudioHandlers();

    // Initialize TagHandlers
    this.tagHandlers = new TagHandlers({
      storage: deps.storage,
      mainWindow: deps.mainWindow || null,
    });

    // Initialize SecurityHandlers if baseDir is provided and not skipped
    // Security handlers may be registered early for password unlock flow
    if (deps.baseDir && !deps.skipSecurityHandlers) {
      this.securityHandlers = new SecurityHandlers({
        mainWindow: deps.mainWindow || null,
        baseDir: deps.baseDir,
      });
    }

    // Initialize ExportHandlers if exportService is provided
    if (deps.exportService) {
      this.exportHandlers = new ExportHandlers({
        exportService: deps.exportService,
      });
    }

    // Initialize LLMHandlers for local AI inference (Standalone Edition)
    if (deps.llmServerManager) {
      this.llmHandlers = new LLMHandlers({
        llmServerManager: deps.llmServerManager,
        modelDownloader: ModelDownloader.getInstance(),
        modelRegistry: ModelRegistry.getInstance(),
        gpuService: GPUDetectionService.getInstance(),
        hfAuth: HuggingFaceAuth.getInstance(),
        storage: deps.storage,
        mainWindow: deps.mainWindow ?? null,
      });

      // Connect LLM server to SummaryHandlers for local summary generation
      this.summaryHandlers.setLLMServerManager(deps.llmServerManager);
    }

    // Initialize PromptTemplateHandlers for prompt template management
    this.promptTemplateHandlers = new PromptTemplateHandlers({
      storage: deps.storage,
    });

    // Initialize DiagnosticsHandlers for log export
    this.diagnosticsHandlers = new DiagnosticsHandlers();

    logger.info('IPCHandlerRegistry: All handler modules initialized');
  }

  /**
   * Register all IPC handlers across all modules
   */
  registerAll(): void {
    logger.info('IPCHandlerRegistry: Registering all IPC handlers');

    try {
      // Register each handler module
      this.storageHandlers.register();
      this.settingsHandlers.register();
      this.summaryHandlers.register();
      this.transcriptionHandlers.register();
      this.windowHandlers.register();
      this.licenseHandlers.register();
      this.authHandlers.register();
      this.meetingReminderHandlers?.register();
      this.updateHandlers?.register();
      this.systemAudioHandlers.register();
      this.tagHandlers.register();
      this.securityHandlers?.register();
      this.exportHandlers?.register();
      this.llmHandlers?.register();
      this.promptTemplateHandlers.register();
      this.diagnosticsHandlers.register();

      logger.info('IPCHandlerRegistry: All IPC handlers registered successfully');
    } catch (error) {
      logger.error('IPCHandlerRegistry: Failed to register IPC handlers', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Update main window reference across all handlers that need it
   */
  updateMainWindow(mainWindow: BrowserWindow | null): void {
    logger.debug('IPCHandlerRegistry: Updating main window reference across handlers');

    try {
      // Update all handlers that need the main window reference
      this.storageHandlers['deps'].mainWindow = mainWindow;
      this.settingsHandlers['deps'].mainWindow = mainWindow;
      this.windowHandlers.updateMainWindow(mainWindow);
      this.licenseHandlers.updateMainWindow(mainWindow);
      this.meetingReminderHandlers?.updateMainWindow(mainWindow);
      this.updateHandlers?.updateMainWindow(mainWindow);
      this.tagHandlers['deps'].mainWindow = mainWindow;
      this.securityHandlers?.updateMainWindow(mainWindow);
      this.llmHandlers?.updateMainWindow(mainWindow);
      this.summaryHandlers.updateMainWindow(mainWindow);

      // Also update AuthManager if it exists
      if (this.deps.authManager && mainWindow) {
        this.deps.authManager['options'].mainWindow = mainWindow;
      }

      logger.debug('IPCHandlerRegistry: Main window reference updated successfully');
    } catch (error) {
      logger.error('IPCHandlerRegistry: Failed to update main window reference', {
        error: error instanceof Error ? error.message : error,
      });
      // Don't throw as this isn't critical for startup
    }
  }

  /**
   * Handle renderer ready event - coordinate across modules
   */
  private handleRendererReady(): void {
    try {
      logger.debug('IPCHandlerRegistry: Handling renderer ready event');

      // Send settings hydration
      this.settingsHandlers.sendSettingsHydration();

      // Handle pending deep links via AuthManager
      if (this.deps.authManager) {
        this.deps.authManager.handlePendingDeepLink();
      }

      logger.debug('IPCHandlerRegistry: Renderer ready event handled');
    } catch (error) {
      logger.error('IPCHandlerRegistry: Failed to handle renderer ready', {
        error: error instanceof Error ? error.message : error,
      });
      // Don't throw as this could prevent app startup
    }
  }

  /**
   * Get handler modules for direct access if needed
   */
  getHandlers() {
    return {
      storage: this.storageHandlers,
      settings: this.settingsHandlers,
      summary: this.summaryHandlers,
      transcription: this.transcriptionHandlers,
      window: this.windowHandlers,
      auth: this.authHandlers,
      meetingReminder: this.meetingReminderHandlers,
      license: this.licenseHandlers,
      update: this.updateHandlers,
      tags: this.tagHandlers,
      export: this.exportHandlers,
      llm: this.llmHandlers,
    };
  }

  /**
   * Get active transcription session info
   */
  getActiveTranscriptionInfo() {
    return this.transcriptionHandlers.getActiveSessionInfo();
  }

  /**
   * Cleanup all handlers and unregister IPC listeners
   */
  cleanup(): void {
    logger.info('IPCHandlerRegistry: Starting cleanup of all IPC handlers');

    try {
      // Cleanup each handler module
      this.storageHandlers.cleanup();
      this.settingsHandlers.cleanup();
      this.summaryHandlers.cleanup();
      this.transcriptionHandlers.cleanup();
      this.windowHandlers.cleanup();
      this.licenseHandlers.cleanup();
      this.meetingReminderHandlers?.cleanup();
      this.updateHandlers?.cleanup();
      this.systemAudioHandlers.cleanup();
      this.tagHandlers.cleanup();
      this.securityHandlers?.cleanup();
      this.exportHandlers?.cleanup();
      this.llmHandlers?.cleanup();
      this.promptTemplateHandlers.cleanup();
      this.diagnosticsHandlers.cleanup();

      logger.info('IPCHandlerRegistry: All IPC handlers cleaned up successfully');
    } catch (error) {
      logger.error('IPCHandlerRegistry: Error during IPC handlers cleanup', {
        error: error instanceof Error ? error.message : error,
      });
      // Continue cleanup even if some handlers fail
    }
  }
}

// Export handler types for external use
export type {
  StorageHandlers,
  SettingsHandlers,
  SummaryHandlers,
  TranscriptionHandlers,
  WindowHandlers,
  TagHandlers,
  LLMHandlers,
};
