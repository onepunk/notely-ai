import * as React from 'react';

import type { ModelCatalogEntry } from '../../../../preload/index';
import { useLLMStore } from '../model/llm.store';

/**
 * Hook for accessing GPU information and capabilities.
 */
export function useGPUInfo() {
  const gpuInfo = useLLMStore((state) => state.gpuInfo);
  const gpuCapabilities = useLLMStore((state) => state.gpuCapabilities);
  const gpuDetected = useLLMStore((state) => state.gpuDetected);
  const recommendedModels = useLLMStore((state) => state.recommendedModels);
  const isInitialized = useLLMStore((state) => state.isInitialized);
  const initialize = useLLMStore((state) => state.initialize);

  // Initialize store if needed
  React.useEffect(() => {
    if (!isInitialized) {
      void initialize();
    }
  }, [isInitialized, initialize]);

  const vramBudgetMB = gpuCapabilities?.vramBudgetMB ?? 0;

  return {
    // GPU info
    gpuInfo,
    gpuCapabilities,
    gpuDetected,

    // Convenience accessors
    gpuName: gpuInfo?.name ?? 'Unknown',
    vendor: gpuInfo?.vendor ?? 'unknown',
    vramMB: gpuInfo?.vramMB ?? 0,
    vramGB: gpuInfo ? (gpuInfo.vramMB / 1024).toFixed(1) : '0',

    // Capabilities
    isSupported: gpuCapabilities?.supported ?? false,
    notSupportedReason: gpuCapabilities?.reason ?? null,
    maxModelSizeGB: gpuCapabilities?.maxModelSizeGB ?? 0,
    vramBudgetMB,
    vramBudgetGB: (vramBudgetMB / 1024).toFixed(1),
    recommendedModelId: gpuCapabilities?.recommendedModelId ?? null,
    backends: gpuCapabilities?.backends ?? [],
    performanceOK: gpuCapabilities?.performanceOK ?? false,
    warnings: gpuCapabilities?.warnings ?? [],

    // Recommended models
    recommendedModels,

    // Status
    isLoading: !isInitialized,
  };
}

/**
 * Hook for checking if a specific model is compatible with the current GPU.
 */
export function useModelCompatibility(model: ModelCatalogEntry | null) {
  const gpuCapabilities = useLLMStore((state) => state.gpuCapabilities);

  if (!model || !gpuCapabilities) {
    return {
      isCompatible: false,
      reason: 'Loading...',
      willPerformWell: false,
      vramUsagePercent: 0,
      vramBudgetPercent: 85,
      isWithinBudget: false,
    };
  }

  const vramMB = gpuCapabilities.gpu?.vramMB ?? 0;
  const vramBudgetMB = gpuCapabilities.vramBudgetMB;

  // Check if model fits in VRAM
  const hasEnoughVRAM = vramMB >= model.vramMinimum;
  const hasOptimalVRAM = vramMB >= model.vramRequired;

  const isCompatible = gpuCapabilities.supported && hasEnoughVRAM;
  const willPerformWell = isCompatible && hasOptimalVRAM;
  const vramUsagePercent =
    model.vramRequired > 0 && vramMB > 0 ? Math.round((model.vramRequired / vramMB) * 100) : 0;
  const isWithinBudget = model.vramRequired <= vramBudgetMB;

  let reason = '';
  if (!gpuCapabilities.supported) {
    reason = gpuCapabilities.reason ?? 'GPU not supported';
  } else if (!hasEnoughVRAM) {
    reason = `Requires ${model.vramMinimum}MB VRAM, you have ${vramMB}MB`;
  } else if (!hasOptimalVRAM) {
    reason = `May run slowly - optimal VRAM is ${model.vramRequired}MB, you have ${vramMB}MB`;
  }

  return {
    isCompatible,
    willPerformWell,
    reason,
    hasEnoughVRAM,
    hasOptimalVRAM,
    vramUsagePercent,
    vramBudgetPercent: 85,
    isWithinBudget,
  };
}

/**
 * Format VRAM in human readable format
 */
export function formatVRAM(vramMB: number): string {
  if (vramMB >= 1024) {
    return `${(vramMB / 1024).toFixed(1)} GB`;
  }
  return `${vramMB} MB`;
}

/**
 * Get VRAM bar color based on usage percentage
 */
export function getVramBarColor(_percent: number): 'success' {
  return 'success';
}
