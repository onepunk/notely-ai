/**
 * GPU Detection Service
 *
 * Detects GPU hardware and assesses compatibility for running local LLM models.
 * Supports NVIDIA (CUDA) and Apple Silicon (Metal).
 */

import { exec } from 'child_process';
import { promisify } from 'util';

import { logger } from '../../logger';

import type {
  GPUInfo,
  GPUCapabilities,
  GPUDetectionResult,
  GPUVendor,
  ComputeBackend,
} from './types';

const execAsync = promisify(exec);

// Minimum VRAM requirements (MB)
const MIN_VRAM_MB = 4096; // 4GB minimum for any meaningful LLM inference
const MIN_CUDA_COMPUTE = 6.0; // Minimum CUDA compute capability (Pascal architecture)

/**
 * Service for detecting GPU hardware and assessing LLM compatibility
 */
export class GPUDetectionService {
  private static instance: GPUDetectionService | null = null;
  private cachedResult: GPUDetectionResult | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): GPUDetectionService {
    if (!GPUDetectionService.instance) {
      GPUDetectionService.instance = new GPUDetectionService();
    }
    return GPUDetectionService.instance;
  }

  /**
   * Detect GPU and assess capabilities
   * Results are cached after first detection
   */
  async detect(): Promise<GPUDetectionResult> {
    if (this.cachedResult) {
      return this.cachedResult;
    }

    logger.info('GPUDetectionService: Starting GPU detection');

    try {
      const platform = process.platform;

      let gpuInfo: GPUInfo | null = null;

      if (platform === 'darwin') {
        // macOS - check for Apple Silicon
        gpuInfo = await this.detectAppleSilicon();
      } else if (platform === 'win32' || platform === 'linux') {
        // Windows/Linux - check for NVIDIA first
        gpuInfo = await this.detectNvidia();

        // If no NVIDIA, could check for AMD ROCm in the future
        // For now, only NVIDIA is supported on Windows/Linux
      }

      const capabilities = this.assessCapabilities(gpuInfo);

      this.cachedResult = {
        success: true,
        capabilities,
      };

      logger.info('GPUDetectionService: Detection complete', {
        supported: capabilities.supported,
        vendor: gpuInfo?.vendor,
        name: gpuInfo?.name,
        vramMB: gpuInfo?.vramMB,
        backends: capabilities.backends,
      });

      return this.cachedResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('GPUDetectionService: Detection failed', { error: errorMsg });

      this.cachedResult = {
        success: false,
        error: errorMsg,
        capabilities: this.getUnsupportedCapabilities('Detection failed: ' + errorMsg),
      };

      return this.cachedResult;
    }
  }

  /**
   * Clear cached detection results (useful for re-detection)
   */
  clearCache(): void {
    this.cachedResult = null;
  }

  /**
   * Detect NVIDIA GPU using nvidia-smi
   */
  private async detectNvidia(): Promise<GPUInfo | null> {
    try {
      // Query GPU name, memory, and compute capability
      const { stdout } = await execAsync(
        'nvidia-smi --query-gpu=name,memory.total,compute_cap,driver_version --format=csv,noheader,nounits',
        { timeout: 10000 }
      );

      const lines = stdout.trim().split('\n');
      if (lines.length === 0 || !lines[0]) {
        return null;
      }

      // Parse first GPU (multi-GPU support could be added later)
      const parts = lines[0].split(',').map((s) => s.trim());
      const [name, memoryStr, computeCap, driverVersion] = parts;

      const vramMB = parseInt(memoryStr, 10);

      // Get CUDA version
      let cudaVersion: string | undefined;
      try {
        const { stdout: cudaOut } = await execAsync(
          'nvidia-smi --query-gpu=driver_version --format=csv,noheader',
          { timeout: 5000 }
        );
        // CUDA version is typically in the nvidia-smi header or we use driver version
        cudaVersion = cudaOut.trim();
      } catch {
        // CUDA version query failed, continue without it
      }

      return {
        vendor: 'nvidia',
        name: name || 'Unknown NVIDIA GPU',
        vramMB: isNaN(vramMB) ? 0 : vramMB,
        computeCapability: computeCap,
        driverVersion,
        cudaVersion,
        isDiscrete: true,
      };
    } catch (error) {
      // nvidia-smi not found or failed - no NVIDIA GPU
      logger.debug('GPUDetectionService: NVIDIA detection failed (expected if no NVIDIA GPU)', {
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Detect Apple Silicon GPU
   */
  private async detectAppleSilicon(): Promise<GPUInfo | null> {
    try {
      // Check if running on Apple Silicon
      const arch = process.arch;
      if (arch !== 'arm64') {
        logger.info('GPUDetectionService: Not Apple Silicon (Intel Mac)');
        return null; // Intel Mac - not supported for Metal LLM inference
      }

      // Get chip info using system_profiler
      const { stdout: hwInfo } = await execAsync('system_profiler SPHardwareDataType', {
        timeout: 10000,
      });

      // Extract chip name (M1, M2, M3, etc.)
      const chipMatch = hwInfo.match(/Chip:\s*Apple\s*(M\d+(?:\s+(?:Pro|Max|Ultra))?)/i);
      const chipName = chipMatch ? chipMatch[1] : 'Apple Silicon';

      // Get total memory (unified memory is shared with GPU)
      const memoryMatch = hwInfo.match(/Memory:\s*(\d+)\s*GB/i);
      const totalMemoryGB = memoryMatch ? parseInt(memoryMatch[1], 10) : 8;

      // Apple Silicon uses unified memory - GPU can access most of system RAM
      // Reserve some for system, allocate ~70% for potential GPU use
      const gpuAccessibleMemoryMB = Math.floor(totalMemoryGB * 0.7 * 1024);

      // Check Metal support
      let metalVersion: string | undefined;
      try {
        const { stdout: metalInfo } = await execAsync('system_profiler SPDisplaysDataType', {
          timeout: 10000,
        });
        const metalMatch = metalInfo.match(/Metal(?:\s+Family)?:\s*([\w\s]+)/i);
        metalVersion = metalMatch ? metalMatch[1].trim() : 'Supported';
      } catch {
        // Metal check failed, assume supported on Apple Silicon
        metalVersion = 'Unknown';
      }

      return {
        vendor: 'apple',
        name: `Apple ${chipName}`,
        vramMB: gpuAccessibleMemoryMB,
        metalSupport: true,
        metalVersion,
        isDiscrete: false, // Unified memory architecture
      };
    } catch (error) {
      logger.debug('GPUDetectionService: Apple Silicon detection failed', {
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Assess GPU capabilities for LLM inference
   */
  private assessCapabilities(gpuInfo: GPUInfo | null): GPUCapabilities {
    const warnings: string[] = [];

    // No GPU detected
    if (!gpuInfo) {
      return this.getUnsupportedCapabilities('No compatible GPU detected');
    }

    // Check vendor support
    if (gpuInfo.vendor === 'unknown') {
      return this.getUnsupportedCapabilities('Unknown GPU vendor');
    }

    // AMD and Intel not yet supported
    if (gpuInfo.vendor === 'amd' || gpuInfo.vendor === 'intel') {
      return this.getUnsupportedCapabilities(
        `${gpuInfo.vendor.toUpperCase()} GPUs are not yet supported. ` +
          'Please use an NVIDIA GPU (CUDA) or Apple Silicon Mac.'
      );
    }

    // Check minimum VRAM
    if (gpuInfo.vramMB < MIN_VRAM_MB) {
      return this.getUnsupportedCapabilities(
        `Insufficient GPU memory: ${gpuInfo.vramMB}MB detected, ` +
          `minimum ${MIN_VRAM_MB}MB required`
      );
    }

    // NVIDIA-specific checks
    if (gpuInfo.vendor === 'nvidia') {
      if (gpuInfo.computeCapability) {
        const computeCap = parseFloat(gpuInfo.computeCapability);
        if (!isNaN(computeCap) && computeCap < MIN_CUDA_COMPUTE) {
          return this.getUnsupportedCapabilities(
            `CUDA compute capability ${gpuInfo.computeCapability} is too old. ` +
              `Minimum required: ${MIN_CUDA_COMPUTE} (Pascal architecture or newer)`
          );
        }
      }
    }

    // Determine backends
    const backends: ComputeBackend[] = [];
    if (gpuInfo.vendor === 'nvidia') {
      backends.push('cuda');
    } else if (gpuInfo.vendor === 'apple') {
      backends.push('metal');
    }
    // CPU is NOT a supported backend — GPU is required for all AI features

    // Calculate VRAM budget from effective VRAM
    const { vramBudgetMB, maxModelSizeGB } = this.calculateVramBudget(
      gpuInfo.vramMB,
      gpuInfo.vendor
    );

    // Performance warnings
    if (gpuInfo.vramMB < 6144) {
      warnings.push(
        'Limited VRAM - only small models (1-3B parameters) or heavily quantized 7B models recommended'
      );
    }

    // Success - GPU is supported
    return {
      supported: true,
      gpu: gpuInfo,
      maxModelSizeGB,
      vramBudgetMB,
      recommendedModelId: null, // Populated later by IPC handler with access to model registry
      backends,
      performanceOK: true,
      warnings,
    };
  }

  /**
   * Calculate VRAM budget from effective VRAM
   */
  private calculateVramBudget(
    vramMB: number,
    vendor: GPUVendor
  ): { vramBudgetMB: number; maxModelSizeGB: number } {
    // Apple Silicon can use more memory due to unified architecture
    const effectiveVram = vendor === 'apple' ? vramMB * 1.3 : vramMB;
    const vramBudgetMB = Math.floor(effectiveVram);
    const maxModelSizeGB = Math.round((vramBudgetMB / 1024) * 10) / 10; // 1 decimal place

    return { vramBudgetMB, maxModelSizeGB };
  }

  /**
   * Create unsupported capabilities result
   */
  private getUnsupportedCapabilities(reason: string): GPUCapabilities {
    return {
      supported: false,
      reason,
      gpu: null,
      maxModelSizeGB: 0,
      vramBudgetMB: 0,
      recommendedModelId: null,
      backends: [],
      performanceOK: false,
      warnings: [],
    };
  }
}

/**
 * Convenience function for quick GPU detection
 */
export async function detectGPU(): Promise<GPUDetectionResult> {
  return GPUDetectionService.getInstance().detect();
}
