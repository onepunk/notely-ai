/**
 * GPU Detection Types
 *
 * Type definitions for GPU hardware detection and capability assessment.
 * Used by the standalone edition to ensure compatible hardware is present.
 */

/**
 * Supported GPU vendors
 */
export type GPUVendor = 'nvidia' | 'apple' | 'amd' | 'intel' | 'unknown';

/**
 * Supported compute backends
 */
export type ComputeBackend = 'cuda' | 'metal' | 'rocm' | 'vulkan' | 'cpu';

/**
 * Information about detected GPU hardware
 */
export interface GPUInfo {
  /** GPU vendor/manufacturer */
  vendor: GPUVendor;

  /** GPU model name (e.g., "NVIDIA GeForce RTX 3080") */
  name: string;

  /** Video RAM in megabytes (or unified memory for Apple Silicon) */
  vramMB: number;

  /** Driver version (if available) */
  driverVersion?: string;

  /** NVIDIA compute capability (e.g., "8.6" for RTX 30-series) */
  computeCapability?: string;

  /** CUDA version (NVIDIA only) */
  cudaVersion?: string;

  /** Whether Metal is supported (Apple only) */
  metalSupport?: boolean;

  /** Metal version (Apple only) */
  metalVersion?: string;

  /** Whether GPU is a discrete (dedicated) GPU vs integrated */
  isDiscrete?: boolean;
}

/**
 * Assessment of GPU capabilities for running local LLM models
 */
export interface GPUCapabilities {
  /** Whether the GPU is supported for local LLM inference */
  supported: boolean;

  /** Human-readable reason if not supported */
  reason?: string;

  /** Detected GPU information */
  gpu: GPUInfo | null;

  /** Maximum model size in GB that can be loaded (85% VRAM budget) */
  maxModelSizeGB: number;

  /** VRAM budget in MB (85% of effective VRAM) */
  vramBudgetMB: number;

  /** ID of the single best recommended model for this GPU, or null */
  recommendedModelId: string | null;

  /** Available compute backends in order of preference */
  backends: ComputeBackend[];

  /** Whether GPU can run with acceptable performance */
  performanceOK: boolean;

  /** Warnings about potential issues (non-blocking) */
  warnings: string[];
}

/**
 * Result from GPU detection attempt
 */
export interface GPUDetectionResult {
  /** Whether detection was successful */
  success: boolean;

  /** Error message if detection failed */
  error?: string;

  /** Detected GPU capabilities */
  capabilities: GPUCapabilities;
}

/**
 * Model requirements for VRAM calculation
 */
export interface ModelRequirements {
  /** Model identifier */
  modelId: string;

  /** Model size in billions of parameters */
  parameterCount: number;

  /** Quantization level (e.g., 'Q4_K_M', 'Q8_0', 'F16') */
  quantization: string;

  /** Estimated VRAM usage in MB */
  estimatedVramMB: number;

  /** Minimum VRAM required for inference */
  minVramMB: number;

  /** Recommended VRAM for good performance */
  recommendedVramMB: number;
}
