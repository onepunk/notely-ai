/**
 * LLM Service Types
 *
 * Type definitions for the local LLM server integration.
 * Used by LLMServerManager and related handlers.
 */

import type { ComponentManager } from '../../services/components/ComponentManager';

/**
 * Configuration options for the LLM server
 */
export interface LLMServerOptions {
  /** Server port (default: 8766) */
  port?: number;

  /** Custom executable path for dev/testing */
  executablePath?: string;

  /** Health check endpoint path */
  healthPath?: string;

  /** Whether to restart on unexpected exit */
  restartOnExit?: boolean;

  /** Additional environment variables */
  env?: Record<string, string | undefined>;

  /** Directory for debug output */
  debugDir?: string;

  /** ComponentManager for on-demand component downloads */
  componentManager?: ComponentManager;
}

/**
 * Request to load a model
 */
export interface LoadModelRequest {
  /** Path to the GGUF model file */
  modelPath: string;

  /** Number of GPU layers to offload (-1 for all) */
  nGpuLayers?: number;

  /** Context window size in tokens */
  nCtx?: number;

  /** Number of CPU threads (null for auto) */
  nThreads?: number | null;
}

/**
 * Response after loading a model
 */
export interface LoadModelResponse {
  status: 'loaded' | 'error';
  modelPath: string;
  loadTimeSeconds: number;
  contextLength: number;
  error?: string;
}

/**
 * Request to generate a summary
 */
export interface GenerateSummaryRequest {
  /** Transcript text to analyze */
  text: string;

  /** Type of analysis (default: "full") */
  analysisType?: string;

  /** Skip the refinement pass */
  skipRefinement?: boolean;

  /** Custom system prompt (if provided, overrides server defaults) */
  systemPrompt?: string;

  /** Custom prompt templates JSON (if provided, overrides server defaults) */
  promptTemplates?: Record<string, string>;

  /** Temperature for chunk extraction pass */
  temperatureExtract?: number;

  /** Temperature for summary refinement pass */
  temperatureRefine?: number;

  /** Top-P nucleus sampling threshold */
  topP?: number;

  /** Maximum completion tokens per generation */
  maxTokens?: number;
}

/**
 * Action item extracted from transcript
 */
export interface ActionItem {
  text: string;
  owner: string | null;
  dueDate: string | null;
}

/**
 * Decision extracted from transcript
 */
export interface Decision {
  text: string;
  context: string | null;
}

/**
 * Key point extracted from transcript
 */
export interface KeyPoint {
  topic: string;
  summary: string;
  participants: string[];
}

/**
 * Processing statistics
 */
export interface ProcessingStats {
  chunksProcessed: number;
  processingTimeSeconds: number;
  actionItemsBeforeDedup: number;
  actionItemsAfterDedup: number;
  totalTimeSeconds: number;
}

/**
 * Structured summary result
 */
export interface SummaryResult {
  /** Narrative summary text */
  summary: string;

  /** Extracted action items */
  actionItems: ActionItem[];

  /** Extracted decisions */
  decisions: Decision[];

  /** Key discussion points */
  keyPoints: KeyPoint[];

  /** Meeting participants */
  participants: string[];

  /** Topics discussed */
  topicsDiscussed: string[];

  /** Processing statistics */
  processingStats: ProcessingStats;
}

/**
 * Response from summary generation
 */
export interface GenerateSummaryResponse {
  result: SummaryResult;
  resultIsText: boolean;
  analysisType: string;
  backend: string;
  timestamp: number;
  generationTimeSeconds: number;
}

/**
 * Simple generation request (non-pipeline)
 */
export interface SimpleGenerateRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

/**
 * Simple generation response
 */
export interface SimpleGenerateResponse {
  text: string;
  generationTimeSeconds: number;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'ok' | 'error';
  modelLoaded: boolean;
  modelPath: string | null;
  contextLength: number | null;
  generationCount: number;
  uptimeSeconds: number;
}

/**
 * Model information response
 */
export interface ModelInfoResponse {
  loaded: boolean;
  modelPath: string | null;
  nGpuLayers: number | null;
  nCtx: number | null;
  loadTimeSeconds: number | null;
  generationCount: number;
}

/**
 * Events emitted by the LLM server manager
 */
export interface LLMServerEvents {
  /** Server started */
  started: { port: number };

  /** Server stopped */
  stopped: { code: number | null; signal: string | null };

  /** Server health check passed */
  healthy: { port: number };

  /** Server health check failed */
  unhealthy: { error: string };

  /** Model loaded */
  modelLoaded: { modelPath: string; loadTimeSeconds: number };

  /** Model unloaded */
  modelUnloaded: Record<string, never>;

  /** Generation started */
  generationStarted: { textLength: number };

  /** Generation completed */
  generationCompleted: { timeSeconds: number };

  /** Generation failed */
  generationFailed: { error: string };

  /** Server error */
  error: { error: Error | string };

  /** Server restarting */
  restarting: { attempt: number; maxAttempts: number; delayMs: number };
}

/**
 * Server status
 */
export type LLMServerStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'loading_model'
  | 'ready'
  | 'generating'
  | 'error';

/**
 * Detailed server state
 */
export interface LLMServerState {
  status: LLMServerStatus;
  port: number | null;
  modelPath: string | null;
  modelLoaded: boolean;
  contextLength: number | null;
  generationCount: number;
  lastError: string | null;
}
