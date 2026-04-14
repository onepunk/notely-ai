/**
 * Model Downloader
 *
 * Downloads GGUF models from HuggingFace with support for:
 * - Resumable downloads via HTTP Range headers
 * - Progress tracking and speed calculation
 * - SHA256 checksum verification
 * - Concurrent download management
 */

import { EventEmitter } from 'events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { app } from 'electron';

import { logger } from '../../logger';

import { MODEL_CATALOG, ModelRegistry } from './ModelRegistry';
import type {
  DownloadOptions,
  DownloadProgress,
  DownloadResult,
  DeleteResult,
  DownloadedModel,
  ModelCatalogEntry,
  DiskUsageResult,
  ParsedHuggingFaceUrl,
  HuggingFaceRepoFile,
} from './types';

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * Get the models directory path
 */
function getModelsDirectory(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'models');
}

/**
 * Ensure the models directory exists
 */
function ensureModelsDirectory(): string {
  const dir = getModelsDirectory();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Model Downloader class
 */
export class ModelDownloader extends EventEmitter {
  private static instance: ModelDownloader | null = null;
  private activeDownloads = new Map<string, AbortController>();
  private registry: ModelRegistry;

  private constructor() {
    super();
    this.registry = ModelRegistry.getInstance();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ModelDownloader {
    if (!ModelDownloader.instance) {
      ModelDownloader.instance = new ModelDownloader();
    }
    return ModelDownloader.instance;
  }

  /**
   * Get the models directory path
   */
  getModelsDirectory(): string {
    return ensureModelsDirectory();
  }

  /**
   * Get the path where a model would be stored
   */
  getModelPath(modelId: string): string {
    const model = this.registry.getModel(modelId);
    if (!model) {
      // Check if it's an unregistered .gguf file using the modelId as filename
      const possiblePath = path.join(this.getModelsDirectory(), modelId);
      if (fs.existsSync(possiblePath) && modelId.endsWith('.gguf')) {
        return possiblePath;
      }
      throw new Error(`Unknown model: ${modelId}`);
    }
    return path.join(this.getModelsDirectory(), model.filename);
  }

  /**
   * Check if a model is downloaded
   */
  isModelDownloaded(modelId: string): boolean {
    try {
      const modelPath = this.getModelPath(modelId);
      return fs.existsSync(modelPath);
    } catch {
      return false;
    }
  }

  /**
   * Get partial download path
   */
  private getPartialPath(modelPath: string): string {
    return modelPath + '.partial';
  }

  /**
   * Download a model from HuggingFace
   */
  async download(options: DownloadOptions): Promise<DownloadResult> {
    const { modelId, hfToken, onProgress, resume = true, verify = true } = options;

    // Get model info
    const model = this.registry.getModel(modelId);
    if (!model) {
      return { success: false, modelId, error: `Unknown model: ${modelId}` };
    }

    // Check if already downloading
    if (this.activeDownloads.has(modelId)) {
      return { success: false, modelId, error: 'Download already in progress' };
    }

    // Check if auth required but not provided
    if (model.requiresAuth && !hfToken) {
      return {
        success: false,
        modelId,
        error: 'HuggingFace token required for this model',
      };
    }

    const modelsDir = this.getModelsDirectory();
    const destPath = options.destinationPath ?? path.join(modelsDir, model.filename);
    const partialPath = this.getPartialPath(destPath);

    // Create abort controller
    const abortController = new AbortController();
    this.activeDownloads.set(modelId, abortController);

    try {
      // Check for existing partial download
      let startByte = 0;
      if (resume && fs.existsSync(partialPath)) {
        const stats = fs.statSync(partialPath);
        startByte = stats.size;
        logger.info(`ModelDownloader: Resuming download from byte ${startByte}`);
      }

      // Get download URL
      const url = this.registry.getDownloadUrl(modelId);
      if (!url) {
        return { success: false, modelId, error: 'Could not get download URL' };
      }

      // Perform download
      const result = await this.performDownload(url, partialPath, destPath, model, {
        hfToken,
        startByte,
        onProgress,
        abortController,
      });

      if (!result.success) {
        return result;
      }

      // Verify checksum if requested and available
      if (verify && model.sha256) {
        this.emit('verificationStarted', { modelId });
        const isValid = await this.verifyChecksum(destPath, model.sha256);
        this.emit('verificationCompleted', { modelId, valid: isValid });

        if (!isValid) {
          fs.unlinkSync(destPath);
          return { success: false, modelId, error: 'Checksum verification failed' };
        }
      }

      // Save metadata
      await this.saveModelMetadata(modelId, destPath);

      this.emit('downloadCompleted', {
        modelId,
        path: destPath,
        sizeBytes: fs.statSync(destPath).size,
      });

      return {
        success: true,
        modelId,
        path: destPath,
        sizeBytes: fs.statSync(destPath).size,
        verified: verify && !!model.sha256,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ModelDownloader: Download failed', { modelId, error: errorMsg });

      if (abortController.signal.aborted) {
        this.emit('downloadCancelled', { modelId });
        return { success: false, modelId, error: 'Download cancelled' };
      }

      this.emit('downloadFailed', { modelId, error: errorMsg });
      return { success: false, modelId, error: errorMsg };
    } finally {
      this.activeDownloads.delete(modelId);
    }
  }

  /**
   * Perform the actual HTTP download
   */
  private performDownload(
    url: string,
    partialPath: string,
    destPath: string,
    model: ModelCatalogEntry,
    options: {
      hfToken?: string;
      startByte: number;
      onProgress?: (progress: DownloadProgress) => void;
      abortController: AbortController;
    }
  ): Promise<DownloadResult> {
    return new Promise((resolve) => {
      const { hfToken, startByte, onProgress, abortController } = options;

      const headers: Record<string, string> = {
        'User-Agent': 'Notely-Standalone/1.0',
      };

      if (hfToken) {
        headers['Authorization'] = `Bearer ${hfToken}`;
      }

      if (startByte > 0) {
        headers['Range'] = `bytes=${startByte}-`;
      }

      const parsedUrl = new URL(url);

      const reqOptions = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers,
      };

      const req = https.request(reqOptions, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            logger.info('ModelDownloader: Following redirect', { redirectUrl });
            this.performDownload(redirectUrl, partialPath, destPath, model, options).then(resolve);
            return;
          }
        }

        // Check for errors
        if (res.statusCode && res.statusCode >= 400) {
          let errorData = '';
          res.on('data', (chunk) => (errorData += chunk.toString('utf-8')));
          res.on('end', () => {
            resolve({
              success: false,
              modelId: model.id,
              error: `HTTP ${res.statusCode}: ${errorData.substring(0, 200)}`,
            });
          });
          return;
        }

        // Get total size
        const contentLength = parseInt(res.headers['content-length'] || '0', 10);
        const totalBytes =
          res.statusCode === 206 ? startByte + contentLength : contentLength || model.sizeBytes;

        const isResumable = res.headers['accept-ranges'] === 'bytes';

        this.emit('downloadStarted', { modelId: model.id, totalBytes });
        logger.info('ModelDownloader: Download started', {
          modelId: model.id,
          totalBytes,
          resumable: isResumable,
        });

        // Create write stream
        const writeStream = fs.createWriteStream(partialPath, {
          flags: startByte > 0 ? 'a' : 'w',
        });

        let bytesDownloaded = startByte;
        let lastProgressTime = Date.now();
        let lastBytes = bytesDownloaded;

        // Handle abort
        abortController.signal.addEventListener('abort', () => {
          res.destroy();
          writeStream.end();
        });

        res.on('data', (chunk: Buffer) => {
          writeStream.write(chunk);
          bytesDownloaded += chunk.length;

          // Calculate progress
          const now = Date.now();
          const timeDiff = (now - lastProgressTime) / 1000;

          if (timeDiff >= 0.5) {
            // Update every 500ms
            const bytesDiff = bytesDownloaded - lastBytes;
            const speed = bytesDiff / timeDiff;
            const remaining = totalBytes - bytesDownloaded;
            const eta = speed > 0 ? remaining / speed : 0;

            const progress: DownloadProgress = {
              modelId: model.id,
              bytesDownloaded,
              totalBytes,
              percentage: (bytesDownloaded / totalBytes) * 100,
              speed,
              eta,
              resumable: isResumable,
            };

            this.emit('downloadProgress', progress);
            onProgress?.(progress);

            lastProgressTime = now;
            lastBytes = bytesDownloaded;
          }
        });

        res.on('end', () => {
          writeStream.end(() => {
            // Rename partial to final
            try {
              if (fs.existsSync(destPath)) {
                fs.unlinkSync(destPath);
              }
              fs.renameSync(partialPath, destPath);
              resolve({ success: true, modelId: model.id, path: destPath });
            } catch (err) {
              resolve({
                success: false,
                modelId: model.id,
                error: `Failed to finalize download: ${err}`,
              });
            }
          });
        });

        res.on('error', (err) => {
          writeStream.end();
          resolve({ success: false, modelId: model.id, error: err.message });
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, modelId: model.id, error: err.message });
      });

      req.end();
    });
  }

  /**
   * Cancel an active download
   */
  cancelDownload(modelId: string): boolean {
    const controller = this.activeDownloads.get(modelId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * Verify file checksum
   */
  async verifyChecksum(filePath: string, expectedHash: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => {
        const actualHash = hash.digest('hex');
        resolve(actualHash.toLowerCase() === expectedHash.toLowerCase());
      });
      stream.on('error', reject);
    });
  }

  /**
   * Save model metadata to a JSON file
   */
  private async saveModelMetadata(modelId: string, modelPath: string): Promise<void> {
    const model = this.registry.getModel(modelId);
    if (!model) return;

    const metadataPath = modelPath + '.json';
    const metadata = {
      id: modelId,
      downloadedAt: new Date().toISOString(),
      catalogEntry: model,
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Get all downloaded models (catalog + custom + unregistered)
   */
  getDownloadedModels(): DownloadedModel[] {
    const modelsDir = this.getModelsDirectory();
    const downloaded: DownloadedModel[] = [];

    if (!fs.existsSync(modelsDir)) {
      return downloaded;
    }

    const files = fs.readdirSync(modelsDir);
    const allKnownModels = this.registry.getAllModels();

    for (const file of files) {
      if (!file.endsWith('.gguf')) continue;

      const filePath = path.join(modelsDir, file);
      const metadataPath = filePath + '.json';

      // Find matching model in catalog or custom registry
      const model = allKnownModels.find((m) => m.filename === file);

      let metadata: Record<string, unknown> = {};
      if (fs.existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        } catch {
          // Ignore metadata parse errors
        }
      }

      const stats = fs.statSync(filePath);

      if (model) {
        downloaded.push({
          id: model.id,
          path: filePath,
          sizeBytes: stats.size,
          downloadedAt: metadata.downloadedAt
            ? new Date(metadata.downloadedAt as string)
            : stats.mtime,
          verified: false,
          catalogEntry: model,
        });
      } else {
        // Unregistered .gguf file found in models dir
        downloaded.push({
          id: `local-${file.replace('.gguf', '')}`,
          path: filePath,
          sizeBytes: stats.size,
          downloadedAt: stats.mtime,
          verified: false,
          catalogEntry: {
            id: `local-${file.replace('.gguf', '')}`,
            name: file.replace('.gguf', '').replace(/[-_]/g, ' '),
            description: 'Manually added model file',
            size: formatBytes(stats.size),
            sizeBytes: stats.size,
            vramRequired: 0,
            vramMinimum: 0,
            quality: 'good',
            huggingFaceRepo: '',
            filename: file,
            requiresAuth: false,
            contextWindow: 4096,
            quantization: 'Q4_K_M',
            parameterCount: 0,
            license: 'unknown',
            tags: ['custom', 'local'],
            isCustom: true,
            source: 'custom-local',
          },
        });
      }
    }

    return downloaded;
  }

  /**
   * Delete a downloaded model
   */
  async deleteModel(modelId: string): Promise<DeleteResult> {
    try {
      const modelPath = this.getModelPath(modelId);

      if (!fs.existsSync(modelPath)) {
        return { success: false, modelId, error: 'Model not found' };
      }

      // Cancel any active download
      this.cancelDownload(modelId);

      // Delete model file
      fs.unlinkSync(modelPath);

      // Delete metadata file if exists
      const metadataPath = modelPath + '.json';
      if (fs.existsSync(metadataPath)) {
        fs.unlinkSync(metadataPath);
      }

      // Delete partial file if exists
      const partialPath = this.getPartialPath(modelPath);
      if (fs.existsSync(partialPath)) {
        fs.unlinkSync(partialPath);
      }

      logger.info('ModelDownloader: Deleted model', { modelId, path: modelPath });

      return { success: true, modelId, path: modelPath };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ModelDownloader: Delete failed', { modelId, error: errorMsg });
      return { success: false, modelId, error: errorMsg };
    }
  }

  /**
   * Get disk space usage by downloaded models (enhanced)
   */
  getDiskUsage(): DiskUsageResult {
    const modelsDir = this.getModelsDirectory();
    const downloaded = this.getDownloadedModels();
    const modelBreakdown = downloaded.map((m) => ({
      id: m.id,
      name: m.catalogEntry?.name ?? m.id,
      sizeBytes: m.sizeBytes,
    }));

    return {
      totalBytes: downloaded.reduce((sum, m) => sum + m.sizeBytes, 0),
      modelCount: downloaded.length,
      modelsDir,
      models: modelBreakdown,
    };
  }

  /**
   * Scan models directory for .gguf files not in the catalog or custom registry
   */
  scanForUnregisteredModels(): DownloadedModel[] {
    const modelsDir = this.getModelsDirectory();
    const unregistered: DownloadedModel[] = [];

    if (!fs.existsSync(modelsDir)) return unregistered;

    const files = fs.readdirSync(modelsDir);
    const catalogFilenames = new Set(Object.values(MODEL_CATALOG).map((m) => m.filename));

    for (const file of files) {
      if (!file.endsWith('.gguf')) continue;

      // Check if it's a known catalog model
      if (catalogFilenames.has(file)) continue;

      // Check if it's a registered custom model
      const customModels = this.registry.getAllModels().filter((m) => m.isCustom);
      const isRegisteredCustom = customModels.some((m) => m.filename === file);
      if (isRegisteredCustom) continue;

      // This is an unregistered .gguf file
      const filePath = path.join(modelsDir, file);
      const stats = fs.statSync(filePath);

      unregistered.push({
        id: `local-${file.replace('.gguf', '')}`,
        path: filePath,
        sizeBytes: stats.size,
        downloadedAt: stats.mtime,
        verified: false,
        catalogEntry: {
          id: `local-${file.replace('.gguf', '')}`,
          name: file.replace('.gguf', '').replace(/[-_]/g, ' '),
          description: 'Manually added model file',
          size: formatBytes(stats.size),
          sizeBytes: stats.size,
          vramRequired: 0,
          vramMinimum: 0,
          quality: 'good' as const,
          huggingFaceRepo: '',
          filename: file,
          requiresAuth: false,
          contextWindow: 4096,
          quantization: 'Q4_K_M' as const,
          parameterCount: 0,
          license: 'unknown',
          tags: ['custom', 'local'],
          isCustom: true,
          source: 'custom-local',
        },
      });
    }

    return unregistered;
  }

  /**
   * Download a model from an arbitrary HuggingFace URL
   */
  async downloadFromUrl(
    url: string,
    filename: string,
    modelId: string,
    options?: { hfToken?: string; onProgress?: (progress: DownloadProgress) => void }
  ): Promise<DownloadResult> {
    if (this.activeDownloads.has(modelId)) {
      return { success: false, modelId, error: 'Download already in progress' };
    }

    const modelsDir = this.getModelsDirectory();
    const destPath = path.join(modelsDir, filename);
    const partialPath = this.getPartialPath(destPath);
    const abortController = new AbortController();
    this.activeDownloads.set(modelId, abortController);

    try {
      let startByte = 0;
      if (fs.existsSync(partialPath)) {
        const stats = fs.statSync(partialPath);
        startByte = stats.size;
      }

      // Create a placeholder model entry for performDownload
      const placeholderModel: ModelCatalogEntry = {
        id: modelId,
        name: filename.replace('.gguf', ''),
        description: 'Custom model from HuggingFace',
        size: '0',
        sizeBytes: 0,
        vramRequired: 0,
        vramMinimum: 0,
        quality: 'good',
        huggingFaceRepo: '',
        filename,
        requiresAuth: false,
        contextWindow: 4096,
        quantization: 'Q4_K_M',
        parameterCount: 0,
        license: 'unknown',
        tags: ['custom'],
        isCustom: true,
        source: 'custom-hf',
      };

      const result = await this.performDownload(url, partialPath, destPath, placeholderModel, {
        hfToken: options?.hfToken,
        startByte,
        onProgress: options?.onProgress,
        abortController,
      });

      if (!result.success) return result;

      // Save metadata
      const stats = fs.statSync(destPath);
      const metadataPath = destPath + '.json';
      fs.writeFileSync(
        metadataPath,
        JSON.stringify(
          { id: modelId, downloadedAt: new Date().toISOString(), source: 'custom-hf' },
          null,
          2
        )
      );

      this.emit('downloadCompleted', { modelId, path: destPath, sizeBytes: stats.size });

      return { success: true, modelId, path: destPath, sizeBytes: stats.size };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ModelDownloader: Custom URL download failed', { modelId, error: errorMsg });

      if (abortController.signal.aborted) {
        this.emit('downloadCancelled', { modelId });
        return { success: false, modelId, error: 'Download cancelled' };
      }

      this.emit('downloadFailed', { modelId, error: errorMsg });
      return { success: false, modelId, error: errorMsg };
    } finally {
      this.activeDownloads.delete(modelId);
    }
  }

  /**
   * Parse a HuggingFace URL and determine its type
   */
  static parseHuggingFaceUrl(url: string): ParsedHuggingFaceUrl {
    const invalid: ParsedHuggingFaceUrl = {
      repo: '',
      filename: null,
      branch: 'main',
      downloadUrl: null,
      isValid: false,
      isRepoUrl: false,
      error: 'Invalid URL',
    };

    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'huggingface.co') {
        return { ...invalid, error: 'Not a HuggingFace URL' };
      }

      // Remove leading slash and split
      const parts = parsed.pathname.replace(/^\//, '').split('/');
      if (parts.length < 2) {
        return { ...invalid, error: 'URL does not contain a valid repository path' };
      }

      const repo = `${parts[0]}/${parts[1]}`;

      // Check for direct file URL: /org/repo/resolve/branch/file.gguf or /org/repo/blob/branch/file.gguf
      if (parts.length >= 5 && (parts[2] === 'resolve' || parts[2] === 'blob')) {
        const branch = parts[3];
        const filename = parts.slice(4).join('/');

        if (!filename.endsWith('.gguf')) {
          return { ...invalid, repo, error: 'File is not in GGUF format' };
        }

        // Always use /resolve/ for download
        const downloadUrl = `https://huggingface.co/${repo}/resolve/${branch}/${filename}`;

        return {
          repo,
          filename,
          branch,
          downloadUrl,
          isValid: true,
          isRepoUrl: false,
        };
      }

      // Check for repo page or /tree/ URL
      const branch = parts.length >= 4 && parts[2] === 'tree' ? parts[3] : 'main';

      return {
        repo,
        filename: null,
        branch,
        downloadUrl: null,
        isValid: true,
        isRepoUrl: true,
      };
    } catch {
      return invalid;
    }
  }

  /**
   * List .gguf files in a HuggingFace repository
   */
  static async listRepoGgufFiles(
    repo: string,
    branch: string = 'main',
    hfToken?: string
  ): Promise<HuggingFaceRepoFile[]> {
    return new Promise((resolve) => {
      const headers: Record<string, string> = {
        'User-Agent': 'Notely-Standalone/1.0',
      };
      if (hfToken) {
        headers['Authorization'] = `Bearer ${hfToken}`;
      }

      const req = https.request(
        {
          hostname: 'huggingface.co',
          path: `/api/models/${repo}/tree/${branch}`,
          method: 'GET',
          headers,
          timeout: 15000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk.toString('utf-8')));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              logger.warn('ModelDownloader: Failed to list repo files', {
                repo,
                status: res.statusCode,
              });
              resolve([]);
              return;
            }

            try {
              const files = JSON.parse(data);
              if (!Array.isArray(files)) {
                resolve([]);
                return;
              }

              const ggufFiles: HuggingFaceRepoFile[] = files
                .filter(
                  (f: { type: string; path: string }) =>
                    f.type === 'file' && f.path.endsWith('.gguf')
                )
                .map((f: { path: string; size: number }) => ({
                  filename: f.path,
                  size: f.size ?? 0,
                  downloadUrl: `https://huggingface.co/${repo}/resolve/${branch}/${f.path}`,
                }));

              resolve(ggufFiles);
            } catch {
              resolve([]);
            }
          });
        }
      );

      req.on('error', () => resolve([]));
      req.on('timeout', () => {
        req.destroy();
        resolve([]);
      });
      req.end();
    });
  }

  /**
   * Check if there's a partial download for a model
   */
  hasPartialDownload(modelId: string): { exists: boolean; bytes: number } {
    try {
      const modelPath = this.getModelPath(modelId);
      const partialPath = this.getPartialPath(modelPath);

      if (fs.existsSync(partialPath)) {
        const stats = fs.statSync(partialPath);
        return { exists: true, bytes: stats.size };
      }
    } catch {
      // Ignore errors
    }

    return { exists: false, bytes: 0 };
  }

  /**
   * Delete a partial download
   */
  deletePartialDownload(modelId: string): boolean {
    try {
      const modelPath = this.getModelPath(modelId);
      const partialPath = this.getPartialPath(modelPath);

      if (fs.existsSync(partialPath)) {
        fs.unlinkSync(partialPath);
        return true;
      }
    } catch (error) {
      logger.warn('ModelDownloader: Failed to delete partial', {
        modelId,
        error: error instanceof Error ? error.message : error,
      });
    }

    return false;
  }

  /**
   * Check if a download is in progress
   */
  isDownloading(modelId: string): boolean {
    return this.activeDownloads.has(modelId);
  }

  /**
   * Get IDs of all active downloads
   */
  getActiveDownloads(): string[] {
    return Array.from(this.activeDownloads.keys());
  }
}

/**
 * Convenience function to get the downloader instance
 */
export function getModelDownloader(): ModelDownloader {
  return ModelDownloader.getInstance();
}
