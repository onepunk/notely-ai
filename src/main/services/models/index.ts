/**
 * Model Management Service Exports
 *
 * Provides model catalog, downloads, and HuggingFace authentication
 * for the Notely Standalone edition.
 */

export { ModelRegistry, getModelRegistry, MODEL_CATALOG } from './ModelRegistry';
export { ModelDownloader, getModelDownloader } from './ModelDownloader';
export { HuggingFaceAuth, getHuggingFaceAuth } from './HuggingFaceAuth';

export type {
  ModelCatalogEntry,
  ModelQuality,
  ModelSource,
  QuantizationType,
  DownloadedModel,
  DownloadProgress,
  DownloadOptions,
  DownloadResult,
  DeleteResult,
  HuggingFaceUserInfo,
  TokenValidationResult,
  ModelDownloaderEvents,
  ParsedHuggingFaceUrl,
  HuggingFaceRepoFile,
  DiskUsageResult,
  CatalogHealthResult,
} from './types';
