/**
 * Model Management Types
 *
 * Type definitions for model registry, downloads, and HuggingFace integration.
 */

/**
 * Model quality tier
 */
export type ModelQuality = 'basic' | 'good' | 'excellent';

/**
 * Quantization type
 */
export type QuantizationType = 'Q4_K_M' | 'Q4_K_S' | 'Q5_K_M' | 'Q5_K_S' | 'Q6_K' | 'Q8_0' | 'F16';

/**
 * Model catalog entry
 */
export interface ModelCatalogEntry {
  /** Unique model identifier */
  id: string;

  /** Human-readable model name */
  name: string;

  /** Model description */
  description: string;

  /** Model file size (human-readable, e.g., "4.4GB") */
  size: string;

  /** File size in bytes */
  sizeBytes: number;

  /** VRAM required for full GPU offload (MB) */
  vramRequired: number;

  /** Minimum VRAM to run with partial offload (MB) */
  vramMinimum: number;

  /** Quality tier */
  quality: ModelQuality;

  /** HuggingFace repository path */
  huggingFaceRepo: string;

  /** Filename in the repository */
  filename: string;

  /** Whether HuggingFace authentication is required */
  requiresAuth: boolean;

  /** Model context window size */
  contextWindow: number;

  /** Quantization type */
  quantization: QuantizationType;

  /** Parameter count (billions) */
  parameterCount: number;

  /** Expected SHA256 hash for verification */
  sha256?: string;

  /** License type */
  license: string;

  /** Tags for filtering */
  tags: string[];

  /** Whether this is a user-imported custom model */
  isCustom?: boolean;

  /** Source of this model entry */
  source?: ModelSource;
}

/**
 * Downloaded model information
 */
export interface DownloadedModel {
  /** Model ID from catalog */
  id: string;

  /** Local file path */
  path: string;

  /** File size in bytes */
  sizeBytes: number;

  /** Download timestamp */
  downloadedAt: Date;

  /** Whether the model was verified against expected hash */
  verified: boolean;

  /** Catalog entry (if still available) */
  catalogEntry?: ModelCatalogEntry;
}

/**
 * Download progress information
 */
export interface DownloadProgress {
  /** Model ID being downloaded */
  modelId: string;

  /** Bytes downloaded so far */
  bytesDownloaded: number;

  /** Total bytes to download */
  totalBytes: number;

  /** Download percentage (0-100) */
  percentage: number;

  /** Current download speed (bytes/sec) */
  speed: number;

  /** Estimated time remaining (seconds) */
  eta: number;

  /** Whether download is paused/resumable */
  resumable: boolean;
}

/**
 * Download options
 */
export interface DownloadOptions {
  /** Model ID to download */
  modelId: string;

  /** HuggingFace token for authenticated downloads */
  hfToken?: string;

  /** Progress callback */
  onProgress?: (progress: DownloadProgress) => void;

  /** Custom destination path (defaults to models directory) */
  destinationPath?: string;

  /** Resume partial download if exists */
  resume?: boolean;

  /** Verify checksum after download */
  verify?: boolean;
}

/**
 * Download result
 */
export interface DownloadResult {
  success: boolean;
  modelId: string;
  path?: string;
  sizeBytes?: number;
  verified?: boolean;
  error?: string;
}

/**
 * Model deletion result
 */
export interface DeleteResult {
  success: boolean;
  modelId: string;
  path?: string;
  error?: string;
}

/**
 * HuggingFace user info from /api/whoami
 */
export interface HuggingFaceUserInfo {
  id: string;
  name: string;
  fullname?: string;
  email?: string;
  emailVerified?: boolean;
  canPay?: boolean;
  periodEnd?: string;
  avatarUrl?: string;
  orgs?: Array<{
    name: string;
    fullname?: string;
    isEnterprise?: boolean;
  }>;
}

/**
 * HuggingFace token validation result
 */
export interface TokenValidationResult {
  valid: boolean;
  user?: HuggingFaceUserInfo;
  error?: string;
}

/**
 * Model source type
 */
export type ModelSource = 'catalog' | 'custom-hf' | 'custom-local';

/**
 * Parsed HuggingFace URL result
 */
export interface ParsedHuggingFaceUrl {
  /** Repository path (e.g., "TheBloke/Mistral-7B-GGUF") */
  repo: string;

  /** Filename if URL points to a specific file */
  filename: string | null;

  /** Branch/ref (defaults to "main") */
  branch: string;

  /** Direct download URL (if specific file detected) */
  downloadUrl: string | null;

  /** Whether the URL was successfully parsed */
  isValid: boolean;

  /** Whether URL points to a repo page (vs specific file) */
  isRepoUrl: boolean;

  /** Available .gguf files (populated when isRepoUrl is true and API is queried) */
  ggufFiles?: HuggingFaceRepoFile[];

  /** Parse/fetch error message */
  error?: string;
}

/**
 * HuggingFace repository file info
 */
export interface HuggingFaceRepoFile {
  /** Filename */
  filename: string;

  /** File size in bytes */
  size: number;

  /** Direct download URL */
  downloadUrl: string;
}

/**
 * Disk usage result for models directory
 */
export interface DiskUsageResult {
  /** Total bytes used by all models */
  totalBytes: number;

  /** Number of model files */
  modelCount: number;

  /** Path to models directory */
  modelsDir: string;

  /** Per-model breakdown */
  models: Array<{
    id: string;
    name: string;
    sizeBytes: number;
  }>;
}

/**
 * Catalog URL health check result
 */
export interface CatalogHealthResult {
  /** Model ID that was checked */
  modelId: string;

  /** Whether the URL is reachable */
  reachable: boolean;

  /** Error message if not reachable */
  error?: string;
}

/**
 * Events emitted by model downloader
 */
export interface ModelDownloaderEvents {
  /** Download started */
  downloadStarted: { modelId: string; totalBytes: number };

  /** Download progress */
  downloadProgress: DownloadProgress;

  /** Download completed */
  downloadCompleted: { modelId: string; path: string; sizeBytes: number };

  /** Download failed */
  downloadFailed: { modelId: string; error: string };

  /** Download cancelled */
  downloadCancelled: { modelId: string };

  /** Verification started */
  verificationStarted: { modelId: string };

  /** Verification completed */
  verificationCompleted: { modelId: string; valid: boolean };
}
