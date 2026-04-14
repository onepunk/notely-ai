import { app, dialog } from 'electron';

import { AppManager } from './AppManager';
import { logger } from './logger';
import { detectGPU } from './services/gpu';
import { showGPUErrorWindow } from './windows/gpuErrorWindow';

let appManager: AppManager;

// Set Windows App User Model ID so the app appears as "Notely AI" in the
// taskbar and process list instead of "Electron".
app.setAppUserModelId('ai.notely.app');

// Ensure consistent app name regardless of how Electron is launched.
// When Playwright or other test harnesses launch dist-electron/main.cjs directly,
// there is no adjacent package.json so Electron falls back to app.name = "Electron".
// On macOS, safeStorage uses "${app.name} Safe Storage" as the Keychain service name,
// so a mismatched name means encryption keys from dev mode can't be decrypted in tests.
app.setName('notely-ai');

// Ensure single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Disable remote debugging in production
if (app.isPackaged) {
  app.commandLine.appendSwitch('inspect', '0');
  app.commandLine.appendSwitch('remote-debugging-port', '0');
}

// Allow tests to override the userData path (must be set before app.ready
// so that ALL app.getPath('userData') calls return the correct path,
// including safeStorageBackend which stores encryption keys).
if (process.env.NOTELY_USER_DATA) {
  app.setPath('userData', process.env.NOTELY_USER_DATA);
}

// Log application startup
logger.info(
  'App starting. packaged=%s, platform=%s, version=%s',
  app.isPackaged,
  process.platform,
  app.getVersion()
);

// Setup protocol handler for deep links
AppManager.setupProtocolHandler();

// Initialize application when ready
app.whenReady().then(async () => {
  try {
    // ========== GPU CHECK (Notely AI Requirement) ==========
    // Notely AI requires a compatible GPU for local LLM inference.
    // Supported: NVIDIA GPU with CUDA, Apple Silicon with Metal
    logger.info('Performing GPU compatibility check...');

    const gpuResult = await detectGPU();

    if (!gpuResult.capabilities.supported) {
      const reason = gpuResult.capabilities.reason || 'No compatible GPU detected';

      logger.error('GPU check failed - unsupported hardware', {
        reason,
        success: gpuResult.success,
        error: gpuResult.error,
      });

      await showGPUErrorWindow(reason);
      app.quit();
      return;
    }

    // Log GPU info for debugging
    const gpu = gpuResult.capabilities.gpu;
    logger.info('GPU check passed', {
      vendor: gpu?.vendor,
      name: gpu?.name,
      vramMB: gpu?.vramMB,
      backends: gpuResult.capabilities.backends,
      vramBudgetMB: gpuResult.capabilities.vramBudgetMB,
      maxModelSizeGB: gpuResult.capabilities.maxModelSizeGB,
    });

    // Log any warnings
    if (gpuResult.capabilities.warnings.length > 0) {
      logger.warn('GPU warnings', { warnings: gpuResult.capabilities.warnings });
    }

    // ========== NORMAL STARTUP ==========
    // Create and initialize the application manager
    appManager = new AppManager({
      userDataPath: app.getPath('userData'),
      argv: process.argv,
    });

    await appManager.initialize();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to initialize application', {
      error: message,
    });
    dialog.showErrorBox(
      'Notely AI — Failed to Start',
      `The application could not initialize.\n\n${message}\n\nThe app will now close.`
    );
    app.quit();
  }
});

// Standard app lifecycle handlers
app.on('window-all-closed', async () => {
  logger.info('App: window-all-closed event fired');

  // On macOS, keep the app running when all windows are closed (standard macOS behavior).
  // Shutdown will happen in 'before-quit' instead, so services remain alive for dock re-activation.
  if (process.platform === 'darwin') {
    return;
  }

  if (appManager && !appManager.isShuttingDownStatus()) {
    await appManager.shutdown();
  }
  app.quit();
});

app.on('before-quit', async () => {
  logger.info('App: before-quit event fired');
  if (appManager && !appManager.isShuttingDownStatus()) {
    await appManager.shutdown();
  }
});

app.on('activate', async () => {
  if (appManager) {
    await appManager.handleActivate();
  }
});

// Network connectivity monitoring for auto-sync
// Note: 'online'/'offline' events are not available on app in main process.
// Network status should be monitored via renderer process or periodic checks.
// The AppManager handles network status internally via its own mechanisms.

// Graceful shutdown on process signals
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  if (appManager && !appManager.isShuttingDownStatus()) {
    await appManager.shutdown();
    app.quit();
  }
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  if (appManager && !appManager.isShuttingDownStatus()) {
    await appManager.shutdown();
    app.quit();
  }
});

// Error handling for uncaught exceptions and rejections
// Deduplicate rapid-fire errors (e.g. EPIPE cascade from console transport)
let lastUncaughtMsg = '';
let lastUncaughtTime = 0;
let suppressedCount = 0;
process.on('uncaughtException', (err) => {
  const now = Date.now();
  if (err.message === lastUncaughtMsg && now - lastUncaughtTime < 5000) {
    suppressedCount++;
    return;
  }
  if (suppressedCount > 0) {
    logger.warn(`Suppressed ${suppressedCount} duplicate uncaughtException(s): ${lastUncaughtMsg}`);
    suppressedCount = 0;
  }
  lastUncaughtMsg = err.message;
  lastUncaughtTime = now;
  logger.error('uncaughtException', {
    err: { message: err.message, stack: err.stack, name: err.name },
  });
});
process.on('unhandledRejection', (reason: unknown) => {
  const details: Record<string, unknown> = { reason };
  if (reason instanceof Error) {
    details.message = reason.message;
    details.stack = reason.stack;
    details.name = reason.name;
  }
  logger.error('unhandledRejection', details);
});
