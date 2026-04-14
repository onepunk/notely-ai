/**
 * Model Registry
 *
 * Curated catalog of GGUF models for the Notely Standalone edition.
 * Models are selected for meeting transcription and summarization tasks.
 */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { app } from 'electron';

import { logger } from '../../logger';
import type { GPUCapabilities } from '../gpu/types';

import type { ModelCatalogEntry, ModelQuality, CatalogHealthResult } from './types';

/**
 * Curated model catalog
 *
 * Models are organized by VRAM requirements:
 * - Small tier (4-6GB): 1-3B parameter models
 * - Medium tier (6-8GB): 7B parameter models with Q4 quantisation
 * - Large tier (12GB+): 7-8B parameter models with Q8 quantisation
 */
export const MODEL_CATALOG: Record<string, ModelCatalogEntry> = {
  // ==========================================================================
  // Small Tier (4GB VRAM) - Basic quality, fast inference
  // ==========================================================================

  'llama-3.2-1b-instruct-q8': {
    id: 'llama-3.2-1b-instruct-q8',
    name: 'Llama 3.2 1B Instruct',
    description:
      '1.2B parameter model with Q8 quantisation. Low VRAM usage and fast inference, but limited on complex summarisation tasks.',
    size: '1.3GB',
    sizeBytes: 1_395_864_576,
    vramRequired: 2000,
    vramMinimum: 1500,
    quality: 'basic',
    huggingFaceRepo: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
    filename: 'Llama-3.2-1B-Instruct-Q8_0.gguf',
    requiresAuth: false,
    contextWindow: 8192,
    quantization: 'Q8_0',
    parameterCount: 1.2,
    license: 'llama3.2',
    tags: ['small', 'fast', 'llama'],
  },

  'llama-3.2-3b-instruct-q4': {
    id: 'llama-3.2-3b-instruct-q4',
    name: 'Llama 3.2 3B Instruct (Q4)',
    description:
      '3.2B parameter model with Q4 quantisation. Runs on low-VRAM systems. Adequate for straightforward meeting summaries.',
    size: '2.0GB',
    sizeBytes: 2_147_483_648,
    vramRequired: 3500,
    vramMinimum: 2500,
    quality: 'basic',
    huggingFaceRepo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    requiresAuth: false,
    contextWindow: 8192,
    quantization: 'Q4_K_M',
    parameterCount: 3.2,
    license: 'llama3.2',
    tags: ['small', 'balanced', 'llama'],
  },

  // ==========================================================================
  // Medium Tier (6-8GB VRAM) - Good quality
  // ==========================================================================

  'mistral-7b-instruct-q4': {
    id: 'mistral-7b-instruct-q4',
    name: 'Mistral 7B Instruct v0.3',
    description:
      '7B parameter Mistral model with Q4 quantisation and 32K context window. Supports longer transcripts than 8K-context models.',
    size: '4.4GB',
    sizeBytes: 4_724_464_640,
    vramRequired: 5500,
    vramMinimum: 4500,
    quality: 'good',
    huggingFaceRepo: 'bartowski/Mistral-7B-Instruct-v0.3-GGUF',
    filename: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    requiresAuth: false,
    contextWindow: 32768,
    quantization: 'Q4_K_M',
    parameterCount: 7.2,
    license: 'apache-2.0',
    tags: ['medium', 'balanced', 'mistral', 'recommended'],
  },

  'llama-3.1-8b-instruct-q4': {
    id: 'llama-3.1-8b-instruct-q4',
    name: 'Llama 3.1 8B Instruct (Q4)',
    description:
      '8B parameter Llama model with Q4 quantisation. Requires a HuggingFace token to download. 8K context window.',
    size: '4.9GB',
    sizeBytes: 5_261_334_528,
    vramRequired: 6000,
    vramMinimum: 5000,
    quality: 'good',
    huggingFaceRepo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
    filename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    requiresAuth: true,
    contextWindow: 8192,
    quantization: 'Q4_K_M',
    parameterCount: 8.0,
    license: 'llama3.1',
    tags: ['medium', 'quality', 'llama', 'recommended'],
  },

  'qwen-2.5-7b-instruct-q4': {
    id: 'qwen-2.5-7b-instruct-q4',
    name: 'Qwen 2.5 7B Instruct (Q4)',
    description:
      '7B parameter Qwen model with Q4 quantisation. Multilingual support and 32K context window.',
    size: '4.7GB',
    sizeBytes: 5_046_586_368,
    vramRequired: 5800,
    vramMinimum: 4800,
    quality: 'good',
    huggingFaceRepo: 'bartowski/Qwen2.5-7B-Instruct-GGUF',
    filename: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    requiresAuth: false,
    contextWindow: 32768,
    quantization: 'Q4_K_M',
    parameterCount: 7.6,
    license: 'apache-2.0',
    tags: ['medium', 'multilingual', 'qwen'],
  },

  // ==========================================================================
  // Large Tier (12GB+ VRAM) - Excellent quality
  // ==========================================================================

  'llama-3.1-8b-instruct-q8': {
    id: 'llama-3.1-8b-instruct-q8',
    name: 'Llama 3.1 8B Instruct (Q8)',
    description:
      '8B parameter Llama model with Q8 quantisation. Less quantisation loss than the Q4 variant but requires more VRAM.',
    size: '8.5GB',
    sizeBytes: 9_126_805_504,
    vramRequired: 10000,
    vramMinimum: 8500,
    quality: 'excellent',
    huggingFaceRepo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
    filename: 'Meta-Llama-3.1-8B-Instruct-Q8_0.gguf',
    requiresAuth: true,
    contextWindow: 8192,
    quantization: 'Q8_0',
    parameterCount: 8.0,
    license: 'llama3.1',
    tags: ['large', 'quality', 'llama', 'recommended'],
  },

  'mistral-7b-instruct-q8': {
    id: 'mistral-7b-instruct-q8',
    name: 'Mistral 7B Instruct v0.3 (Q8)',
    description:
      '7B parameter Mistral model with Q8 quantisation and 32K context window. Less quantisation loss than the Q4 variant.',
    size: '7.7GB',
    sizeBytes: 8_269_078_528,
    vramRequired: 9500,
    vramMinimum: 8000,
    quality: 'excellent',
    huggingFaceRepo: 'bartowski/Mistral-7B-Instruct-v0.3-GGUF',
    filename: 'Mistral-7B-Instruct-v0.3-Q8_0.gguf',
    requiresAuth: false,
    contextWindow: 32768,
    quantization: 'Q8_0',
    parameterCount: 7.2,
    license: 'apache-2.0',
    tags: ['large', 'quality', 'mistral'],
  },

  'qwen-2.5-14b-instruct-q4': {
    id: 'qwen-2.5-14b-instruct-q4',
    name: 'Qwen 2.5 14B Instruct (Q4)',
    description:
      '14B parameter Qwen model with Q4 quantisation. Multilingual support and 32K context window.',
    size: '8.9GB',
    sizeBytes: 9_556_148_224,
    vramRequired: 11000,
    vramMinimum: 9000,
    quality: 'excellent',
    huggingFaceRepo: 'bartowski/Qwen2.5-14B-Instruct-GGUF',
    filename: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    requiresAuth: false,
    contextWindow: 32768,
    quantization: 'Q4_K_M',
    parameterCount: 14.8,
    license: 'apache-2.0',
    tags: ['large', 'multilingual', 'qwen'],
  },

  // ==========================================================================
  // 16-24GB VRAM - Maximum quality for high-end GPUs
  // ==========================================================================

  'qwen-2.5-14b-instruct-q8': {
    id: 'qwen-2.5-14b-instruct-q8',
    name: 'Qwen 2.5 14B Instruct (Q8)',
    description:
      '14B parameter Qwen model with Q8 quantisation. Less quantisation loss than the Q4 variant. Requires 18GB+ VRAM.',
    size: '15.7GB',
    sizeBytes: 16_858_083_328,
    vramRequired: 18000,
    vramMinimum: 15500,
    quality: 'excellent',
    huggingFaceRepo: 'bartowski/Qwen2.5-14B-Instruct-GGUF',
    filename: 'Qwen2.5-14B-Instruct-Q8_0.gguf',
    requiresAuth: false,
    contextWindow: 32768,
    quantization: 'Q8_0',
    parameterCount: 14.8,
    license: 'apache-2.0',
    tags: ['large', 'quality', 'multilingual', 'qwen', 'recommended'],
  },

  // ==========================================================================
  // 32-48GB+ VRAM - For Apple Silicon Max/Ultra and workstation GPUs
  // ==========================================================================

  'qwen-2.5-32b-instruct-q4': {
    id: 'qwen-2.5-32b-instruct-q4',
    name: 'Qwen 2.5 32B Instruct (Q4)',
    description:
      '32B parameter Qwen model with Q4 quantisation. Largest available model. Requires 32GB+ VRAM — too slow on 24GB GPUs (e.g. RTX 3090).',
    size: '19.9GB',
    sizeBytes: 21_370_281_984,
    vramRequired: 28000,
    vramMinimum: 26000,
    quality: 'excellent',
    huggingFaceRepo: 'bartowski/Qwen2.5-32B-Instruct-GGUF',
    filename: 'Qwen2.5-32B-Instruct-Q4_K_M.gguf',
    requiresAuth: false,
    contextWindow: 32768,
    quantization: 'Q4_K_M',
    parameterCount: 32.5,
    license: 'apache-2.0',
    tags: ['large', 'quality', 'multilingual', 'qwen'],
  },
};

/**
 * Model Registry class for managing the model catalog
 */
export class ModelRegistry {
  private static instance: ModelRegistry | null = null;
  private customModels = new Map<string, ModelCatalogEntry>();

  private constructor() {
    this.loadCustomModels();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  /**
   * Get path to custom models JSON file
   */
  private getCustomModelsPath(): string {
    const modelsDir = path.join(app.getPath('userData'), 'models');
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }
    return path.join(modelsDir, 'custom-models.json');
  }

  /**
   * Load custom models from disk
   */
  loadCustomModels(): void {
    try {
      const filePath = this.getCustomModelsPath();
      if (!fs.existsSync(filePath)) return;

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry.id) {
            this.customModels.set(entry.id, entry);
          }
        }
      }
      logger.info('ModelRegistry: Loaded custom models', { count: this.customModels.size });
    } catch (error) {
      logger.warn('ModelRegistry: Failed to load custom models', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Persist custom models to disk
   */
  private saveCustomModels(): void {
    try {
      const filePath = this.getCustomModelsPath();
      const entries = Array.from(this.customModels.values());
      fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
    } catch (error) {
      logger.error('ModelRegistry: Failed to save custom models', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Add a custom model to the registry
   */
  addCustomModel(entry: ModelCatalogEntry): void {
    this.customModels.set(entry.id, { ...entry, isCustom: true });
    this.saveCustomModels();
    logger.info('ModelRegistry: Added custom model', { id: entry.id, name: entry.name });
  }

  /**
   * Remove a custom model from the registry
   */
  removeCustomModel(modelId: string): boolean {
    const removed = this.customModels.delete(modelId);
    if (removed) {
      this.saveCustomModels();
      logger.info('ModelRegistry: Removed custom model', { id: modelId });
    }
    return removed;
  }

  /**
   * Check if a model is a custom model
   */
  isCustomModel(modelId: string): boolean {
    return this.customModels.has(modelId);
  }

  /**
   * Validate a catalog model's download URL via HTTP HEAD
   */
  async validateCatalogUrl(modelId: string): Promise<CatalogHealthResult> {
    const model = this.getModel(modelId);
    if (!model) {
      return { modelId, reachable: false, error: 'Model not found' };
    }

    const url = this.getDownloadUrl(modelId);
    if (!url) {
      return { modelId, reachable: false, error: 'No download URL' };
    }

    return new Promise((resolve) => {
      const parsedUrl = new URL(url);
      const req = https.request(
        {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'HEAD',
          headers: { 'User-Agent': 'Notely-Standalone/1.0' },
          timeout: 5000,
        },
        (res) => {
          // Follow one redirect
          if (
            (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) &&
            res.headers.location
          ) {
            resolve({ modelId, reachable: true });
            return;
          }
          resolve({
            modelId,
            reachable: res.statusCode !== undefined && res.statusCode < 400,
            error: res.statusCode && res.statusCode >= 400 ? `HTTP ${res.statusCode}` : undefined,
          });
        }
      );

      req.on('error', (error) => {
        resolve({ modelId, reachable: false, error: error.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ modelId, reachable: false, error: 'Request timeout' });
      });

      req.end();
    });
  }

  /**
   * Get all models in the catalog (curated + custom)
   */
  getAllModels(): ModelCatalogEntry[] {
    return [...Object.values(MODEL_CATALOG), ...this.customModels.values()];
  }

  /**
   * Get a model by ID (checks both curated and custom)
   */
  getModel(id: string): ModelCatalogEntry | null {
    return MODEL_CATALOG[id] ?? this.customModels.get(id) ?? null;
  }

  /**
   * Get models filtered by quality tier
   */
  getModelsByQuality(quality: ModelQuality): ModelCatalogEntry[] {
    return Object.values(MODEL_CATALOG).filter((m) => m.quality === quality);
  }

  /**
   * Get models that can run with given VRAM
   */
  getModelsForVram(vramMB: number): ModelCatalogEntry[] {
    return Object.values(MODEL_CATALOG)
      .filter((m) => m.vramMinimum <= vramMB)
      .sort((a, b) => b.vramRequired - a.vramRequired); // Largest first
  }

  /**
   * Get models that require authentication
   */
  getModelsRequiringAuth(): ModelCatalogEntry[] {
    return Object.values(MODEL_CATALOG).filter((m) => m.requiresAuth);
  }

  /**
   * Get recommended models based on GPU capabilities.
   * Returns all compatible models sorted by vramRequired descending.
   */
  getRecommendedModels(capabilities: GPUCapabilities): ModelCatalogEntry[] {
    if (!capabilities.supported) {
      return [];
    }

    const vramMB = capabilities.gpu?.vramMB ?? 0;
    return this.getModelsForVram(vramMB);
  }

  /**
   * Get the single best recommended model for a given VRAM budget.
   * Finds the model with the highest vramRequired that still fits within the budget.
   * Among ties, prefers models tagged 'recommended'.
   */
  getRecommendedModelForVram(vramBudgetMB: number): ModelCatalogEntry | null {
    const allModels = Object.values(MODEL_CATALOG);

    // Filter to models that fit within budget
    const fittingModels = allModels
      .filter((m) => m.vramRequired > 0 && m.vramRequired <= vramBudgetMB)
      .sort((a, b) => {
        // Sort by vramRequired descending (largest first)
        if (b.vramRequired !== a.vramRequired) {
          return b.vramRequired - a.vramRequired;
        }
        // Among ties, prefer models tagged 'recommended'
        const aRec = a.tags.includes('recommended') ? 1 : 0;
        const bRec = b.tags.includes('recommended') ? 1 : 0;
        return bRec - aRec;
      });

    return fittingModels[0] ?? null;
  }

  /**
   * Check if a model requires HuggingFace authentication
   */
  requiresAuth(modelId: string): boolean {
    const model = this.getModel(modelId);
    return model?.requiresAuth ?? false;
  }

  /**
   * Get the HuggingFace download URL for a model
   */
  getDownloadUrl(modelId: string): string | null {
    const model = this.getModel(modelId);
    if (!model) return null;

    return `https://huggingface.co/${model.huggingFaceRepo}/resolve/main/${model.filename}`;
  }

  /**
   * Search models by name or tags
   */
  searchModels(query: string): ModelCatalogEntry[] {
    const lowerQuery = query.toLowerCase();
    return Object.values(MODEL_CATALOG).filter(
      (m) =>
        m.name.toLowerCase().includes(lowerQuery) ||
        m.description.toLowerCase().includes(lowerQuery) ||
        m.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get models sorted by a specific field
   */
  getModelsSorted(
    sortBy: 'name' | 'size' | 'vram' | 'quality',
    ascending = true
  ): ModelCatalogEntry[] {
    const models = Object.values(MODEL_CATALOG);

    const compareFn = (a: ModelCatalogEntry, b: ModelCatalogEntry) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          comparison = a.sizeBytes - b.sizeBytes;
          break;
        case 'vram':
          comparison = a.vramRequired - b.vramRequired;
          break;
        case 'quality': {
          const qualityOrder = { basic: 0, good: 1, excellent: 2 };
          comparison = qualityOrder[a.quality] - qualityOrder[b.quality];
          break;
        }
      }
      return ascending ? comparison : -comparison;
    };

    return models.sort(compareFn);
  }
}

/**
 * Convenience function to get the registry instance
 */
export function getModelRegistry(): ModelRegistry {
  return ModelRegistry.getInstance();
}
