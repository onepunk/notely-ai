/**
 * Model Compatibility Calculator
 *
 * Calculates VRAM requirements for different model sizes and quantization levels.
 * Helps determine which models can run on detected GPU hardware.
 */

import type { GPUCapabilities, ModelRequirements } from './types';

/**
 * Common quantization formats and their memory multipliers
 * Base is F16 (16-bit float) = 2 bytes per parameter
 */
const QUANTIZATION_MULTIPLIERS: Record<string, number> = {
  // Full precision
  F32: 4.0, // 32-bit float
  F16: 2.0, // 16-bit float (baseline)
  BF16: 2.0, // BFloat16

  // GGML/GGUF quantization (llama.cpp)
  Q8_0: 1.0, // 8-bit
  Q6_K: 0.83, // ~6.5 bits
  Q5_K_M: 0.71, // ~5.7 bits
  Q5_K_S: 0.68, // ~5.5 bits
  Q5_0: 0.63, // 5-bit
  Q4_K_M: 0.59, // ~4.7 bits
  Q4_K_S: 0.56, // ~4.5 bits
  Q4_0: 0.5, // 4-bit
  Q3_K_M: 0.46, // ~3.7 bits
  Q3_K_S: 0.43, // ~3.4 bits
  Q2_K: 0.375, // ~3 bits
};

/**
 * Predefined model configurations
 */
interface ModelConfig {
  name: string;
  parametersBillions: number;
  contextWindow: number;
  minVramMB: number;
  recommendedVramMB: number;
}

const KNOWN_MODELS: ModelConfig[] = [
  // Small models (1-3B)
  {
    name: 'Qwen2.5-0.5B',
    parametersBillions: 0.5,
    contextWindow: 32768,
    minVramMB: 1024,
    recommendedVramMB: 2048,
  },
  {
    name: 'Qwen2.5-1.5B',
    parametersBillions: 1.5,
    contextWindow: 32768,
    minVramMB: 2048,
    recommendedVramMB: 3072,
  },
  {
    name: 'Phi-3-mini',
    parametersBillions: 3.8,
    contextWindow: 128000,
    minVramMB: 3072,
    recommendedVramMB: 4096,
  },
  {
    name: 'Llama-3.2-3B',
    parametersBillions: 3.0,
    contextWindow: 8192,
    minVramMB: 2560,
    recommendedVramMB: 4096,
  },

  // Medium models (7-8B)
  {
    name: 'Qwen2.5-7B',
    parametersBillions: 7.0,
    contextWindow: 32768,
    minVramMB: 5120,
    recommendedVramMB: 8192,
  },
  {
    name: 'Llama-3.1-8B',
    parametersBillions: 8.0,
    contextWindow: 128000,
    minVramMB: 5632,
    recommendedVramMB: 8192,
  },
  {
    name: 'Mistral-7B',
    parametersBillions: 7.0,
    contextWindow: 32768,
    minVramMB: 5120,
    recommendedVramMB: 8192,
  },

  // Large models (13B+)
  {
    name: 'Qwen2.5-14B',
    parametersBillions: 14.0,
    contextWindow: 32768,
    minVramMB: 10240,
    recommendedVramMB: 16384,
  },
  {
    name: 'Llama-2-13B',
    parametersBillions: 13.0,
    contextWindow: 4096,
    minVramMB: 9216,
    recommendedVramMB: 12288,
  },
];

/**
 * Calculate VRAM requirements for a model at a given quantization level
 */
export function calculateVramRequirement(
  parametersBillions: number,
  quantization: string,
  contextTokens: number = 4096
): ModelRequirements {
  const multiplier = QUANTIZATION_MULTIPLIERS[quantization] ?? QUANTIZATION_MULTIPLIERS['Q4_K_M'];

  // Base model size (parameters * bytes per parameter)
  const baseModelSizeMB = (parametersBillions * 1e9 * 2 * multiplier) / (1024 * 1024);

  // KV cache size estimate (roughly 2 bytes per token per layer)
  // Assuming ~32 layers for 7B model, scales with model size
  const numLayers = Math.ceil(parametersBillions * 4.5); // Rough estimate
  const kvCacheSizeMB = (contextTokens * numLayers * 2 * 2) / (1024 * 1024);

  // Runtime overhead (activations, intermediate tensors, etc.)
  const overheadMB = baseModelSizeMB * 0.2;

  const totalVramMB = Math.ceil(baseModelSizeMB + kvCacheSizeMB + overheadMB);

  return {
    modelId: `${parametersBillions}B-${quantization}`,
    parameterCount: parametersBillions,
    quantization,
    estimatedVramMB: totalVramMB,
    minVramMB: Math.ceil(baseModelSizeMB + overheadMB * 0.5),
    recommendedVramMB: Math.ceil(totalVramMB * 1.2), // 20% headroom
  };
}

/**
 * Get list of compatible models for given GPU capabilities
 */
export function getCompatibleModels(capabilities: GPUCapabilities): ModelConfig[] {
  if (!capabilities.supported || !capabilities.gpu) {
    return [];
  }

  const vramMB = capabilities.gpu.vramMB;

  return KNOWN_MODELS.filter((model) => model.minVramMB <= vramMB).sort(
    (a, b) => b.parametersBillions - a.parametersBillions // Largest first
  );
}

/**
 * Get recommended model for given GPU capabilities
 */
export function getRecommendedModel(capabilities: GPUCapabilities): ModelConfig | null {
  const compatibleModels = getCompatibleModels(capabilities);

  if (compatibleModels.length === 0) {
    return null;
  }

  // Find largest model that fits within recommended VRAM
  const vramMB = capabilities.gpu?.vramMB ?? 0;

  const recommendedModels = compatibleModels.filter((m) => m.recommendedVramMB <= vramMB);

  // Return largest model that fits comfortably, or smallest if none fit comfortably
  return recommendedModels.length > 0
    ? recommendedModels[0]
    : compatibleModels[compatibleModels.length - 1];
}

/**
 * Check if a specific model can run on given capabilities
 */
export function canRunModel(
  capabilities: GPUCapabilities,
  model: { parametersBillions: number; quantization: string }
): { canRun: boolean; reason?: string; vramRequired: number } {
  if (!capabilities.supported || !capabilities.gpu) {
    return { canRun: false, reason: 'No compatible GPU', vramRequired: 0 };
  }

  const requirements = calculateVramRequirement(model.parametersBillions, model.quantization);

  const availableVram = capabilities.gpu.vramMB;

  if (requirements.minVramMB > availableVram) {
    return {
      canRun: false,
      reason: `Insufficient VRAM: ${requirements.minVramMB}MB required, ${availableVram}MB available`,
      vramRequired: requirements.minVramMB,
    };
  }

  if (requirements.recommendedVramMB > availableVram) {
    return {
      canRun: true,
      reason: 'May experience performance issues due to limited VRAM',
      vramRequired: requirements.minVramMB,
    };
  }

  return {
    canRun: true,
    vramRequired: requirements.estimatedVramMB,
  };
}

/**
 * Get best quantization level for available VRAM
 */
export function getBestQuantization(
  parametersBillions: number,
  availableVramMB: number
): string | null {
  const quantizationLevels = ['Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M', 'Q4_0', 'Q3_K_M', 'Q2_K'];

  for (const quant of quantizationLevels) {
    const requirements = calculateVramRequirement(parametersBillions, quant);
    if (requirements.recommendedVramMB <= availableVramMB) {
      return quant;
    }
  }

  // Check if even Q2_K fits
  const minRequirements = calculateVramRequirement(parametersBillions, 'Q2_K');
  if (minRequirements.minVramMB <= availableVramMB) {
    return 'Q2_K';
  }

  return null; // Model too large for available VRAM
}
