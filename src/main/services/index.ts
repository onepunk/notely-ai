/**
 * Main application services
 *
 * These services handle application-level concerns that are separate from
 * storage operations (which are in ./storage/services/).
 */

export {
  MeetingReminderManager,
  type MeetingReminderManagerDependencies,
  type MeetingReminderManagerEvents,
} from './MeetingReminderManager';
export type {
  MeetingReminderTarget,
  MeetingReminderTriggerPayload,
  MeetingReminderState,
} from '../../common/meetingReminder';
export { LicenseService, type LicensePayload } from './license/LicenseService';
export { ComponentManager, type ComponentManagerEvents } from './components';

// GPU Detection
export { GPUDetectionService, detectGPU } from './gpu/GPUDetectionService';
export type {
  GPUInfo,
  GPUCapabilities,
  GPUDetectionResult,
  GPUVendor,
  ComputeBackend,
} from './gpu/types';

// LLM Service (Standalone edition)
export { LLMServerManager } from './llm';
export type {
  LLMServerOptions,
  LLMServerState,
  LLMServerStatus,
  LoadModelRequest,
  LoadModelResponse,
  GenerateSummaryRequest,
  GenerateSummaryResponse,
  SummaryResult,
  ActionItem,
  Decision,
  KeyPoint,
  HealthResponse as LLMHealthResponse,
  ModelInfoResponse,
} from './llm';

// Model Management (Standalone edition)
export {
  ModelRegistry,
  getModelRegistry,
  MODEL_CATALOG,
  ModelDownloader,
  getModelDownloader,
  HuggingFaceAuth,
  getHuggingFaceAuth,
} from './models';
export type {
  ModelCatalogEntry,
  ModelQuality,
  QuantizationType,
  DownloadedModel,
  DownloadProgress,
  DownloadOptions,
  DownloadResult,
  DeleteResult,
  HuggingFaceUserInfo,
  TokenValidationResult,
} from './models';
