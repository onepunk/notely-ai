/**
 * Diagnostics IPC Handlers - Exports sanitized log bundles for troubleshooting
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import archiver from 'archiver';
import { app, dialog, ipcMain, shell } from 'electron';

import { IPC } from '../../shared/ipc-channels';
import { getLogFileDir, logger } from '../logger';
import { GPUDetectionService } from '../services/gpu/GPUDetectionService';

export interface DiagnosticsExportResult {
  success: boolean;
  path?: string;
  error?: string;
}

/**
 * DiagnosticsHandlers manages IPC handlers for diagnostics export.
 */
export class DiagnosticsHandlers {
  /**
   * Register all diagnostics-related IPC handlers
   */
  register(): void {
    logger.info('DiagnosticsHandlers: Registering IPC handlers');

    ipcMain.handle(IPC.DIAGNOSTICS_EXPORT, this.handleExport.bind(this));

    logger.info('DiagnosticsHandlers: All handlers registered successfully');
  }

  /**
   * Export diagnostics bundle - compresses log files into a zip with manifest
   */
  private async handleExport(): Promise<DiagnosticsExportResult> {
    try {
      const logDir = getLogFileDir();
      if (!logDir || !fs.existsSync(logDir)) {
        return { success: false, error: 'Log directory not found' };
      }

      // Enumerate log files
      const allFiles = fs.readdirSync(logDir);
      const logFiles = allFiles.filter((f) => f.endsWith('.log'));

      if (logFiles.length === 0) {
        return { success: false, error: 'No log files found' };
      }

      // Show save dialog
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `notely-diagnostics-${timestamp}.zip`;

      const result = await dialog.showSaveDialog({
        title: 'Save Diagnostics Bundle',
        defaultPath: path.join(app.getPath('desktop'), defaultName),
        filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Export cancelled' };
      }

      const outputPath = result.filePath;

      // Detect GPU (uses cached result if already detected)
      let gpuInfo: { name: string; vendor: string; vramMB: number } | null = null;
      try {
        const gpuResult = await GPUDetectionService.getInstance().detect();
        if (gpuResult.success && gpuResult.capabilities.gpu) {
          const g = gpuResult.capabilities.gpu;
          gpuInfo = { name: g.name, vendor: g.vendor, vramMB: g.vramMB };
        }
      } catch {
        /* non-fatal */
      }

      // Create zip archive
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve());
        archive.on('error', (err: Error) => reject(err));

        archive.pipe(output);

        // Add log files
        for (const file of logFiles) {
          archive.file(path.join(logDir, file), { name: `logs/${file}` });
        }

        // Add manifest
        const manifest = {
          appVersion: app.getVersion(),
          platform: process.platform,
          osVersion: process.getSystemVersion(),
          arch: process.arch,
          timestamp: new Date().toISOString(),
          logFileCount: logFiles.length,
          electronVersion: process.versions.electron,
          cpuModel: os.cpus()[0]?.model || 'Unknown',
          cpuCores: os.cpus().length,
          totalMemoryGB: Math.round(os.totalmem() / 1024 ** 3),
          gpu: gpuInfo,
        };
        archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

        archive.finalize();
      });

      logger.info('DiagnosticsHandlers: Diagnostics bundle exported', {
        path: outputPath,
        logFileCount: logFiles.length,
      });

      // Open the portal support page for upload
      shell.openExternal('https://portal.yourdomain.com/support?upload=diagnostics').catch(() => {
        // Non-fatal if browser fails to open
      });

      return { success: true, path: outputPath };
    } catch (error) {
      logger.error('DiagnosticsHandlers: Failed to export diagnostics', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
      };
    }
  }

  /**
   * Cleanup and unregister handlers
   */
  cleanup(): void {
    logger.info('DiagnosticsHandlers: Cleaning up IPC handlers');

    try {
      ipcMain.removeHandler(IPC.DIAGNOSTICS_EXPORT);
    } catch (error) {
      logger.warn('DiagnosticsHandlers: Failed to remove handler', {
        error: error instanceof Error ? error.message : error,
      });
    }

    logger.info('DiagnosticsHandlers: Cleanup completed');
  }
}
