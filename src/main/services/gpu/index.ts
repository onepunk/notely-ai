/**
 * GPU Detection and Model Compatibility Services
 *
 * Provides hardware detection and compatibility checking for local LLM inference.
 */

export { GPUDetectionService, detectGPU } from './GPUDetectionService';
export {
  calculateVramRequirement,
  getCompatibleModels,
  getRecommendedModel,
  canRunModel,
  getBestQuantization,
} from './ModelCompatibility';
export type {
  GPUInfo,
  GPUCapabilities,
  GPUDetectionResult,
  GPUVendor,
  ComputeBackend,
  ModelRequirements,
} from './types';
