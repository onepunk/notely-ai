import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';

import { IPC } from '../../shared/ipc-channels';
import type {
  HeartbeatStatus,
  HeartbeatLimitExceeded,
  LicenseWarning,
  LicenseValidatedEvent,
  LicenseExpiredEvent,
  LicenseSnapshot,
  UpgradePollingStatus,
} from '../../shared/types/license';
import { DEFAULT_API_URL } from '../config';
import { logger } from '../logger';
import type { FeatureFlagsService } from '../services/featureFlags';
import {
  LicenseService,
  type LicensePayload,
  type ActivationResult,
  type ActivationError,
} from '../services/license/LicenseService';

// DiagnosticsService type for optional functionality
interface DiagnosticsService {
  getDiagnostics(): Promise<LicenseDiagnostics>;
  exportToFile(): Promise<string>;
  clearValidationHistory(): void;
}

// LicenseDiagnostics type
interface LicenseDiagnostics {
  timestamp: string;
  license: unknown;
  validationHistory: unknown[];
  heartbeat: unknown;
  system: unknown;
}

// HeartbeatService type for optional cloud functionality
// In standalone mode, this service is not available
interface HeartbeatService {
  getStatus(): HeartbeatStatus;
  start(): Promise<void>;
  stop(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

// UpgradePollingService type for optional cloud functionality
interface UpgradePollingService {
  startUpgradePolling(): Promise<void>;
  stopUpgradePolling(): Promise<void>;
  getStatus(): UpgradePollingStatus;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

const ValidateSchema = z.object({
  key: z.string().min(1, 'License key is required'),
});

const ActivateSchema = z.object({
  licenseKey: z.string().min(1, 'License key is required'),
  email: z.string().email('Valid email is required'),
});

export interface LicenseHandlersDeps {
  licenseService: LicenseService;
  featureFlagsService: FeatureFlagsService;
  /** Optional in standalone mode - no cloud heartbeat */
  heartbeatService?: HeartbeatService;
  diagnosticsService?: DiagnosticsService;
  /** Optional in standalone mode - no cloud upgrade polling */
  upgradePollingService?: UpgradePollingService;
  mainWindow?: BrowserWindow | null;
}

export class LicenseHandlers {
  private mainWindow: BrowserWindow | null;
  private unsubscribeLicense?: () => void;
  private unsubscribeFeatures?: () => void;

  constructor(private deps: LicenseHandlersDeps) {
    this.mainWindow = deps.mainWindow ?? null;
  }

  register(): void {
    logger.info('LicenseHandlers: Registering IPC handlers');

    // Register IPC handlers
    ipcMain.handle(IPC.LICENSE_GET_CURRENT, this.handleGetCurrent.bind(this));
    ipcMain.handle(IPC.LICENSE_VALIDATE, this.handleValidate.bind(this));
    ipcMain.handle(IPC.LICENSE_CLEAR_CACHE, this.handleClear.bind(this));
    ipcMain.handle(IPC.LICENSE_GET_FEATURES, this.handleGetFeatures.bind(this));
    ipcMain.handle(IPC.LICENSE_HAS_FEATURE, this.handleHasFeature.bind(this));
    ipcMain.handle(IPC.LICENSE_MANUAL_CHECK, this.handleManualCheck.bind(this));
    ipcMain.handle(IPC.LICENSE_CHECK_SERVER_HEALTH, this.handleCheckServerHealth.bind(this));
    ipcMain.handle(IPC.LICENSE_SET_API_URL, this.handleSetApiUrl.bind(this));
    ipcMain.handle(IPC.LICENSE_GET_API_URL, this.handleGetApiUrl.bind(this));
    ipcMain.handle(IPC.LICENSE_FETCH_CURRENT, this.handleFetchCurrent.bind(this));
    ipcMain.handle(IPC.HEARTBEAT_GET_STATUS, this.handleGetHeartbeatStatus.bind(this));
    ipcMain.handle(IPC.LICENSE_GET_DIAGNOSTICS, this.handleGetDiagnostics.bind(this));
    ipcMain.handle(IPC.LICENSE_EXPORT_DIAGNOSTICS, this.handleExportDiagnostics.bind(this));
    ipcMain.handle(
      IPC.LICENSE_CLEAR_VALIDATION_HISTORY,
      this.handleClearValidationHistory.bind(this)
    );

    // Upgrade polling handlers
    ipcMain.handle(IPC.LICENSE_START_UPGRADE_POLLING, this.handleStartUpgradePolling.bind(this));
    ipcMain.handle(IPC.LICENSE_STOP_UPGRADE_POLLING, this.handleStopUpgradePolling.bind(this));
    ipcMain.handle(
      IPC.LICENSE_GET_UPGRADE_POLLING_STATUS,
      this.handleGetUpgradePollingStatus.bind(this)
    );

    // Activation handlers for na- (Notely AI) licenses
    ipcMain.handle(IPC.LICENSE_ACTIVATE, this.handleActivate.bind(this));
    ipcMain.handle(IPC.LICENSE_IS_ACTIVATED, this.handleIsActivated.bind(this));
    ipcMain.handle(IPC.LICENSE_GET_ACTIVATION_DETAILS, this.handleGetActivationDetails.bind(this));
    ipcMain.handle(IPC.LICENSE_REVALIDATE_ACTIVATION, this.handleRevalidateActivation.bind(this));
    ipcMain.handle(IPC.LICENSE_DEACTIVATE, this.handleDeactivate.bind(this));

    // Subscribe to license changes
    this.unsubscribeLicense = this.deps.licenseService.onChanged((payload) => {
      this.handleLicenseChanged(payload);
    });

    // Subscribe to feature flag changes
    this.unsubscribeFeatures = this.deps.featureFlagsService.onFeaturesChanged((features) => {
      this.broadcastFeaturesChanged(features);
    });

    // Subscribe to heartbeat service events
    this.setupHeartbeatListeners();
  }

  updateMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  cleanup(): void {
    logger.info('LicenseHandlers: Cleaning up handlers');

    // Remove IPC handlers
    ipcMain.removeHandler(IPC.LICENSE_GET_CURRENT);
    ipcMain.removeHandler(IPC.LICENSE_VALIDATE);
    ipcMain.removeHandler(IPC.LICENSE_CLEAR_CACHE);
    ipcMain.removeHandler(IPC.LICENSE_GET_FEATURES);
    ipcMain.removeHandler(IPC.LICENSE_HAS_FEATURE);
    ipcMain.removeHandler(IPC.LICENSE_MANUAL_CHECK);
    ipcMain.removeHandler(IPC.LICENSE_CHECK_SERVER_HEALTH);
    ipcMain.removeHandler(IPC.LICENSE_SET_API_URL);
    ipcMain.removeHandler(IPC.LICENSE_GET_API_URL);
    ipcMain.removeHandler(IPC.LICENSE_FETCH_CURRENT);
    ipcMain.removeHandler(IPC.HEARTBEAT_GET_STATUS);
    ipcMain.removeHandler(IPC.LICENSE_GET_DIAGNOSTICS);
    ipcMain.removeHandler(IPC.LICENSE_EXPORT_DIAGNOSTICS);
    ipcMain.removeHandler(IPC.LICENSE_CLEAR_VALIDATION_HISTORY);
    ipcMain.removeHandler(IPC.LICENSE_START_UPGRADE_POLLING);
    ipcMain.removeHandler(IPC.LICENSE_STOP_UPGRADE_POLLING);
    ipcMain.removeHandler(IPC.LICENSE_GET_UPGRADE_POLLING_STATUS);

    // Activation handlers
    ipcMain.removeHandler(IPC.LICENSE_ACTIVATE);
    ipcMain.removeHandler(IPC.LICENSE_IS_ACTIVATED);
    ipcMain.removeHandler(IPC.LICENSE_GET_ACTIVATION_DETAILS);
    ipcMain.removeHandler(IPC.LICENSE_REVALIDATE_ACTIVATION);
    ipcMain.removeHandler(IPC.LICENSE_DEACTIVATE);

    // Unsubscribe from services
    if (this.unsubscribeLicense) {
      this.unsubscribeLicense();
      this.unsubscribeLicense = undefined;
    }

    if (this.unsubscribeFeatures) {
      this.unsubscribeFeatures();
      this.unsubscribeFeatures = undefined;
    }

    // Remove heartbeat listeners
    this.cleanupHeartbeatListeners();
  }

  private async handleGetCurrent(): Promise<LicensePayload> {
    try {
      return await this.deps.licenseService.getCurrentLicense();
    } catch (error) {
      logger.error('LicenseHandlers: Failed to get current license', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  private async handleValidate(
    _event: Electron.IpcMainInvokeEvent,
    payload: unknown
  ): Promise<LicensePayload> {
    try {
      const { key } = ValidateSchema.parse(payload);
      return await this.deps.licenseService.validateLicense(key);
    } catch (error) {
      logger.warn('LicenseHandlers: License validation failed', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  private async handleClear(): Promise<void> {
    try {
      await this.deps.licenseService.clearLicense();
    } catch (error) {
      logger.error('LicenseHandlers: Failed to clear license cache', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  private async handleGetFeatures(): Promise<string[]> {
    try {
      return this.deps.featureFlagsService.getEnabledFeatures();
    } catch (error) {
      logger.error('LicenseHandlers: Failed to get features', {
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  private async handleHasFeature(
    _event: Electron.IpcMainInvokeEvent,
    payload: unknown
  ): Promise<boolean> {
    try {
      const key = typeof payload === 'string' ? payload : (payload as { key: string })?.key;
      if (!key) {
        throw new Error('Feature key is required');
      }
      return this.deps.featureFlagsService.hasFeature(key);
    } catch (error) {
      logger.error('LicenseHandlers: Failed to check feature', {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Handle manual license check
   * Triggers a re-validation of the current license
   */
  private async handleManualCheck(): Promise<LicensePayload> {
    try {
      const currentLicense = await this.deps.licenseService.getCurrentLicense();

      if (currentLicense.status === 'unlicensed') {
        throw new Error('No license key configured. Please enter a license key first.');
      }

      // Re-validate using the stored license key
      // This requires accessing the internal license key, which we'll need to add a method for
      logger.info('LicenseHandlers: Manual license check requested');

      // For now, just return the current license
      // TODO: Add a method to LicenseService to re-validate the current key
      return currentLicense;
    } catch (error) {
      logger.error('LicenseHandlers: Failed to perform manual license check', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Get heartbeat service status
   * In standalone mode (no heartbeatService), returns a default inactive status
   */
  private async handleGetHeartbeatStatus(): Promise<HeartbeatStatus> {
    if (!this.deps.heartbeatService) {
      // Standalone mode - no heartbeat service
      return {
        isRunning: false,
        isPaused: false,
        sessionToken: '',
      };
    }
    try {
      const status = this.deps.heartbeatService.getStatus();
      return status;
    } catch (error) {
      logger.error('LicenseHandlers: Failed to get heartbeat status', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Check server health
   */
  private async handleCheckServerHealth(
    _event: Electron.IpcMainInvokeEvent,
    apiUrl?: string
  ): Promise<{ online: boolean; responseTime: number; error?: string }> {
    // Standalone mode: no cloud server to check
    // Return a simulated healthy response
    logger.debug('LicenseHandlers: Server health check (standalone mode)', { apiUrl });
    return { online: true, responseTime: 0 };
  }

  /**
   * Set custom API URL
   */
  private async handleSetApiUrl(
    _event: Electron.IpcMainInvokeEvent,
    rawUrl: string | null
  ): Promise<void> {
    try {
      const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';

      if (!trimmed) {
        await this.deps.licenseService['deps'].settings.delete('server.apiUrl');
        logger.info('LicenseHandlers: Custom API URL cleared');
        return;
      }

      // Basic URL validation
      try {
        const parsed = new URL(trimmed);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('URL must use http or https protocol');
        }
      } catch {
        throw new Error('Invalid URL format');
      }

      await this.deps.licenseService['deps'].settings.set('server.apiUrl', trimmed);

      logger.info('LicenseHandlers: Custom API URL set', { url: trimmed });
    } catch (error) {
      logger.error('LicenseHandlers: Failed to set API URL', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Get current API URL
   */
  private async handleGetApiUrl(): Promise<string> {
    try {
      return await this.deps.licenseService.resolveApiUrl();
    } catch (error) {
      logger.error('LicenseHandlers: Failed to resolve API URL', {
        error: error instanceof Error ? error.message : error,
      });
      return DEFAULT_API_URL;
    }
  }

  /**
   * Fetch current license from backend
   * Calls /api/license/current with the user's access token
   */
  private async handleFetchCurrent(): Promise<LicensePayload> {
    try {
      return await this.deps.licenseService.fetchCurrentLicense();
    } catch (error) {
      logger.error('LicenseHandlers: Failed to fetch current license', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Handle license changed event
   * Manages heartbeat service lifecycle based on license status
   */
  private handleLicenseChanged(payload: LicensePayload): void {
    logger.info('LicenseHandlers: License changed', {
      status: payload.status,
      type: payload.type,
      features: payload.features.length,
    });

    // Broadcast to renderer
    this.broadcastChange(payload);

    // Emit validated event
    this.broadcastValidated({
      success: payload.status === 'active',
      mode: payload.validationMode,
      timestamp: new Date().toISOString(),
    });

    // Check for expiry
    if (payload.status === 'expired') {
      this.broadcastExpired({
        expiresAt: payload.expiresAt || new Date().toISOString(),
        timestamp: new Date().toISOString(),
      });
    }

    // Check for warnings
    this.checkAndEmitWarnings(payload);

    // Manage heartbeat service lifecycle (only if heartbeatService is available)
    if (this.deps.heartbeatService) {
      if (payload.status === 'active') {
        // Start heartbeat for active licenses
        void this.deps.heartbeatService.start();
      } else {
        // Stop heartbeat for inactive licenses
        this.deps.heartbeatService.stop();
      }
    }
  }

  /**
   * Check license status and emit warnings if needed
   */
  private checkAndEmitWarnings(payload: LicensePayload): void {
    const now = new Date();

    // Check cache age
    if (payload.lastValidatedAt) {
      const lastValidated = new Date(payload.lastValidatedAt);
      const hoursSinceValidation = (now.getTime() - lastValidated.getTime()) / (1000 * 60 * 60);

      if (hoursSinceValidation > 24) {
        this.broadcastWarning({
          type: 'cache-age-warning',
          message: `License hasn't been validated in ${Math.floor(hoursSinceValidation)} hours. Consider checking your connection.`,
          severity: 'warning',
          timestamp: now.toISOString(),
        });
      }
    }

    // Check if validation is overdue
    if (payload.nextValidationAt) {
      const nextValidation = new Date(payload.nextValidationAt);
      if (now > nextValidation) {
        this.broadcastWarning({
          type: 'validation-overdue',
          message: 'License validation is overdue. Please connect to the internet to validate.',
          severity: 'warning',
          timestamp: now.toISOString(),
        });
      }
    }

    // Check expiry warning (7 days before expiry)
    if (payload.expiresAt && payload.status === 'active') {
      const expiresAt = new Date(payload.expiresAt);
      const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      if (daysUntilExpiry > 0 && daysUntilExpiry <= 7) {
        this.broadcastWarning({
          type: 'expiry-warning',
          message: `Your license expires in ${Math.ceil(daysUntilExpiry)} days. Please renew to continue using all features.`,
          severity: 'warning',
          timestamp: now.toISOString(),
        });
      }
    }
  }

  /**
   * Setup heartbeat service event listeners
   * In standalone mode (no heartbeatService), this is a no-op
   */
  private setupHeartbeatListeners(): void {
    // Standalone mode - no heartbeat service
    if (!this.deps.heartbeatService) {
      logger.info('LicenseHandlers: Heartbeat service not available (standalone mode)');
      return;
    }

    // Listen for limit exceeded
    this.deps.heartbeatService.on('heartbeat:limit-exceeded', (data) => {
      logger.warn('LicenseHandlers: Heartbeat limit exceeded', data);
      this.broadcastLimitExceeded({
        activeSessions: (data as { activeSessions: number }).activeSessions,
        sessionLimit: (data as { sessionLimit: number }).sessionLimit,
        warnings: (data as { warnings: string[] }).warnings,
        timestamp: new Date().toISOString(),
      });
    });

    // Listen for offline mode
    this.deps.heartbeatService.on('heartbeat:offline', () => {
      logger.info('LicenseHandlers: Heartbeat service went offline');
      this.broadcastWarning({
        type: 'offline-mode',
        message: 'Connection lost. License is now running in offline mode.',
        severity: 'warning',
        timestamp: new Date().toISOString(),
      });
    });

    // Listen for online mode
    this.deps.heartbeatService.on('heartbeat:online', () => {
      logger.info('LicenseHandlers: Heartbeat service came online');
      // Trigger license validation when coming back online
      void this.handleManualCheck();
    });

    // Listen for license changes detected via heartbeat
    this.deps.heartbeatService.on('heartbeat:license-changed', async (snapshot: unknown) => {
      const s = snapshot as LicenseSnapshot;
      logger.info('LicenseHandlers: License change detected via heartbeat', {
        licenseId: s.licenseId,
        status: s.status,
        hasLicense: s.hasLicense,
      });

      // If a new license was detected or license became active, fetch full details
      if (s.hasLicense && s.status === 'active') {
        try {
          await this.deps.licenseService.fetchCurrentLicense();
          // The fetchCurrentLicense will emit 'changed' event which triggers UI update
        } catch (error) {
          logger.error('LicenseHandlers: Failed to fetch updated license', {
            error: error instanceof Error ? error.message : error,
          });
        }
      } else if (!s.hasLicense || s.status === 'expired' || s.status === 'revoked') {
        // License was removed or expired - clear local license
        await this.deps.licenseService.clearLicense();
      }
    });

    // Setup upgrade polling listeners if service is available
    this.setupUpgradePollingListeners();
  }

  /**
   * Setup upgrade polling service event listeners
   */
  private setupUpgradePollingListeners(): void {
    if (!this.deps.upgradePollingService) {
      return;
    }

    // Listen for status changes
    this.deps.upgradePollingService.on('status:changed', (status: UpgradePollingStatus) => {
      this.broadcastUpgradePollingStatus(status);
    });

    // Listen for upgrade success
    this.deps.upgradePollingService.on('upgrade:success', (license: LicensePayload) => {
      logger.info('LicenseHandlers: Upgrade success detected via polling');
      this.broadcastUpgradeSuccess(license);
    });
  }

  /**
   * Cleanup heartbeat service listeners
   * In standalone mode (no heartbeatService), this is a no-op
   */
  private cleanupHeartbeatListeners(): void {
    // Standalone mode - no heartbeat service to cleanup
    if (!this.deps.heartbeatService) {
      return;
    }

    this.deps.heartbeatService.off('heartbeat:limit-exceeded', () => {});
    this.deps.heartbeatService.off('heartbeat:offline', () => {});
    this.deps.heartbeatService.off('heartbeat:online', () => {});
    this.deps.heartbeatService.off('heartbeat:license-changed', () => {});

    // Cleanup upgrade polling listeners - handled by the service being optional
  }

  /**
   * Handle start upgrade polling request
   */
  private async handleStartUpgradePolling(): Promise<void> {
    if (!this.deps.upgradePollingService) {
      logger.warn('LicenseHandlers: UpgradePollingService not available');
      return;
    }
    await this.deps.upgradePollingService.startUpgradePolling();
  }

  /**
   * Handle stop upgrade polling request
   */
  private async handleStopUpgradePolling(): Promise<void> {
    if (!this.deps.upgradePollingService) {
      logger.warn('LicenseHandlers: UpgradePollingService not available');
      return;
    }
    await this.deps.upgradePollingService.stopUpgradePolling();
  }

  /**
   * Handle get upgrade polling status request
   */
  private handleGetUpgradePollingStatus(): UpgradePollingStatus {
    if (!this.deps.upgradePollingService) {
      return { isActive: false, startedAt: null, timeRemainingMs: null };
    }
    return this.deps.upgradePollingService.getStatus();
  }

  // ============================================================================
  // Activation Handlers for na- (Notely AI) Licenses
  // ============================================================================

  /**
   * Handle license activation request
   * Activates a license with email binding for na- licenses
   */
  private async handleActivate(
    _event: Electron.IpcMainInvokeEvent,
    payload: unknown
  ): Promise<ActivationResult | ActivationError> {
    try {
      const { licenseKey, email } = ActivateSchema.parse(payload);
      logger.info('LicenseHandlers: Processing activation request', {
        licenseKeyPrefix: licenseKey.substring(0, 10) + '...',
        emailDomain: email.split('@')[1],
      });
      return await this.deps.licenseService.activateLicense(licenseKey, email);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('LicenseHandlers: Activation request validation failed', {
          errors: error.errors,
        });
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.errors[0]?.message || 'Invalid request',
          },
        };
      }
      logger.error('LicenseHandlers: Activation failed', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Activation failed',
        },
      };
    }
  }

  /**
   * Handle check if license is activated for offline use
   */
  private async handleIsActivated(): Promise<boolean> {
    try {
      return await this.deps.licenseService.isActivatedForOffline();
    } catch (error) {
      logger.error('LicenseHandlers: Failed to check activation status', {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Handle get activation details request
   */
  private async handleGetActivationDetails(): Promise<{
    activationId: string;
    email: string;
    activatedAt: string;
    offlineGraceDeadline: string | null;
    nextRequiredValidation: string | null;
  } | null> {
    try {
      return await this.deps.licenseService.getActivationDetails();
    } catch (error) {
      logger.error('LicenseHandlers: Failed to get activation details', {
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Handle revalidate activation request
   * Extends offline grace period and refreshes offline token
   */
  private async handleRevalidateActivation(): Promise<LicensePayload> {
    try {
      return await this.deps.licenseService.revalidateActivation();
    } catch (error) {
      logger.error('LicenseHandlers: Revalidation failed', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Handle deactivate license request
   * Frees up activation slot for use on another device
   */
  private async handleDeactivate(): Promise<boolean> {
    try {
      return await this.deps.licenseService.deactivateLicense();
    } catch (error) {
      logger.error('LicenseHandlers: Deactivation failed', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Broadcast license change to renderer
   */
  private broadcastChange(payload: LicensePayload): void {
    if (!this.mainWindow) {
      return;
    }
    try {
      this.mainWindow.webContents.send(IPC.EVT_LICENSE_CHANGED, payload);
    } catch (error) {
      logger.warn('LicenseHandlers: Failed to broadcast license change', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Broadcast license validation event to renderer
   */
  private broadcastValidated(event: LicenseValidatedEvent): void {
    if (!this.mainWindow) {
      return;
    }
    try {
      this.mainWindow.webContents.send(IPC.EVT_LICENSE_VALIDATED, event);
    } catch (error) {
      logger.warn('LicenseHandlers: Failed to broadcast license validated event', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Broadcast license expired event to renderer
   */
  private broadcastExpired(event: LicenseExpiredEvent): void {
    if (!this.mainWindow) {
      return;
    }
    try {
      this.mainWindow.webContents.send(IPC.EVT_LICENSE_EXPIRED, event);
    } catch (error) {
      logger.warn('LicenseHandlers: Failed to broadcast license expired event', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Broadcast license warning to renderer
   */
  private broadcastWarning(warning: LicenseWarning): void {
    if (!this.mainWindow) {
      return;
    }
    try {
      this.mainWindow.webContents.send(IPC.EVT_LICENSE_WARNING, warning);
    } catch (error) {
      logger.warn('LicenseHandlers: Failed to broadcast license warning', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Broadcast features changed to renderer
   */
  private broadcastFeaturesChanged(features: string[]): void {
    if (!this.mainWindow) {
      return;
    }
    try {
      this.mainWindow.webContents.send(IPC.EVT_LICENSE_FEATURES_CHANGED, features);
    } catch (error) {
      logger.warn('LicenseHandlers: Failed to broadcast features change', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Broadcast heartbeat limit exceeded to renderer
   */
  private broadcastLimitExceeded(event: HeartbeatLimitExceeded): void {
    if (!this.mainWindow) {
      return;
    }
    try {
      this.mainWindow.webContents.send(IPC.EVT_HEARTBEAT_LIMIT_EXCEEDED, event);
    } catch (error) {
      logger.warn('LicenseHandlers: Failed to broadcast heartbeat limit exceeded', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Broadcast upgrade polling status to renderer
   */
  private broadcastUpgradePollingStatus(status: UpgradePollingStatus): void {
    if (!this.mainWindow) {
      return;
    }
    try {
      this.mainWindow.webContents.send(IPC.EVT_LICENSE_UPGRADE_POLLING_STATUS, status);
    } catch (error) {
      logger.warn('LicenseHandlers: Failed to broadcast upgrade polling status', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Broadcast upgrade success to renderer
   */
  private broadcastUpgradeSuccess(license: LicensePayload): void {
    if (!this.mainWindow) {
      return;
    }
    try {
      this.mainWindow.webContents.send(IPC.EVT_LICENSE_UPGRADE_SUCCESS, license);
    } catch (error) {
      logger.warn('LicenseHandlers: Failed to broadcast upgrade success', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Handle get diagnostics request
   * Returns comprehensive diagnostic information
   * In standalone mode without diagnosticsService, returns minimal info
   */
  private async handleGetDiagnostics(): Promise<LicenseDiagnostics> {
    if (!this.deps.diagnosticsService) {
      // Standalone mode: return minimal diagnostics
      return {
        timestamp: new Date().toISOString(),
        license: await this.deps.licenseService.getCurrentLicense(),
        validationHistory: [],
        heartbeat: null,
        system: { platform: process.platform, version: process.version },
      };
    }
    try {
      return await this.deps.diagnosticsService.getDiagnostics();
    } catch (error) {
      logger.error('LicenseHandlers: Failed to get diagnostics', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Handle export diagnostics request
   * Opens save dialog and exports diagnostics to JSON file
   * In standalone mode without diagnosticsService, returns error
   */
  private async handleExportDiagnostics(): Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }> {
    if (!this.deps.diagnosticsService) {
      return { success: false, error: 'Diagnostics service not available in standalone mode' };
    }
    try {
      const path = await this.deps.diagnosticsService.exportToFile();
      return { success: true, path };
    } catch (error) {
      logger.error('LicenseHandlers: Failed to export diagnostics', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export diagnostics',
      };
    }
  }

  /**
   * Handle clear validation history request
   * In standalone mode without diagnosticsService, this is a no-op
   */
  private async handleClearValidationHistory(): Promise<void> {
    if (!this.deps.diagnosticsService) {
      return; // No-op in standalone mode
    }
    try {
      this.deps.diagnosticsService.clearValidationHistory();
    } catch (error) {
      logger.error('LicenseHandlers: Failed to clear validation history', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }
}
