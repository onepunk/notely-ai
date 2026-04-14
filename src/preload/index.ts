import { contextBridge, ipcRenderer } from 'electron';

import type {
  MeetingReminderState,
  MeetingReminderTriggerPayload,
  MeetingReminderRecordCommand,
  MeetingReminderRecordResponse,
} from '../common/meetingReminder';
import { IPC } from '../shared/ipc-channels';
import type {
  ComponentInfo,
  DownloadProgress,
  DownloadResult,
  SetupStatusEvent,
  VerificationResult,
} from '../shared/types/components';
import type {
  LicensePayload,
  HeartbeatStatus,
  HeartbeatLimitExceeded,
  LicenseWarning,
  LicenseValidatedEvent,
  LicenseExpiredEvent,
  UpgradePollingStatus,
} from '../shared/types/license';

export type BinderSummary = {
  id: string;
  name: string;
  sort_index: number;
  color?: string | null;
  icon?: string | null;
  is_team_shared: number;
  remote_id?: string | null;
  user_profile_id?: string | null;
};

export type NoteListItem = {
  id: string;
  title: string;
  binder_id: string;
  created_at: number;
  updated_at: number;
  deleted: number;
  pinned: number;
  starred?: number;
  archived?: number;
};

// Update info type
export type UpdateInfo = {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  downloadUrl: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  forceUpdate: boolean;
  platform: string;
};

// Download state type
export type DownloadState = 'idle' | 'downloading' | 'complete' | 'error';

// Download status type
export type DownloadStatus = {
  state: DownloadState;
  progress: number;
  downloadPath: string | null;
  error: string | null;
};

// ============================================================================
// LLM Types (Standalone Edition)
// ============================================================================

// Model quality tiers
export type ModelQuality = 'basic' | 'good' | 'excellent';

// GPU vendors
export type GPUVendor = 'nvidia' | 'apple' | 'amd' | 'intel' | 'unknown';

// LLM server status
export type LLMServerStatus = 'stopped' | 'starting' | 'ready' | 'error' | 'loading_model';

// Model catalog entry
export type ModelCatalogEntry = {
  id: string;
  name: string;
  description: string;
  size: string;
  sizeBytes: number;
  vramRequired: number;
  vramMinimum: number;
  quality: ModelQuality;
  huggingFaceRepo: string;
  filename: string;
  requiresAuth: boolean;
  contextWindow: number;
  quantization: string;
  parameterCount: number;
  license: string;
  tags: string[];
  sha256?: string;
  isCustom?: boolean;
  source?: 'catalog' | 'custom-hf' | 'custom-local';
};

// Downloaded model info
export type DownloadedModel = {
  id: string;
  path: string;
  sizeBytes: number;
  downloadedAt: Date;
  verified: boolean;
  catalogEntry?: ModelCatalogEntry;
};

// LLM server state
export type LLMServerState = {
  status: LLMServerStatus;
  port: number | null;
  modelPath: string | null;
  modelLoaded: boolean;
  contextLength: number | null;
  generationCount: number;
  lastError: string | null;
};

// LLM status (comprehensive)
export type LLMStatus = {
  serverStatus: LLMServerState;
  modelLoaded: boolean;
  modelId: string | null;
  modelName: string | null;
  gpuCapabilities: GPUCapabilities | null;
};

// GPU info
export type GPUInfo = {
  vendor: GPUVendor;
  name: string;
  vramMB: number;
  driverVersion?: string;
  computeCapability?: string;
  cudaVersion?: string;
  metalSupport?: boolean;
  metalVersion?: string;
  isDiscrete?: boolean;
};

// GPU capabilities
export type GPUCapabilities = {
  supported: boolean;
  reason?: string;
  gpu: GPUInfo | null;
  maxModelSizeGB: number;
  vramBudgetMB: number;
  recommendedModelId: string | null;
  backends: string[];
  performanceOK: boolean;
  warnings: string[];
};

// GPU info result
export type GPUInfoResult = {
  success: boolean;
  gpu: GPUInfo | null;
  capabilities: GPUCapabilities | null;
  error?: string;
};

// Model parameters
export type ModelParameters = {
  temperatureExtract: number;
  temperatureRefine: number;
  maxTokens: number;
  topP: number;
  contextWindow: number;
  nGpuLayers: number;
};

// Prompts configuration
export type PromptsConfig = {
  systemPrompt: string;
  structure: Record<string, unknown>;
};

// HuggingFace user info
export type HFUserInfo = {
  name: string;
  email?: string;
  avatarUrl?: string;
};

// LLM download progress
export type LLMDownloadProgress = {
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
  speed: number;
  eta: number;
  resumable: boolean;
};

// Parsed HuggingFace URL result
export type ParsedHuggingFaceUrl = {
  repo: string;
  filename: string | null;
  branch: string;
  downloadUrl: string | null;
  isValid: boolean;
  isRepoUrl: boolean;
  ggufFiles?: HuggingFaceRepoFile[];
  error?: string;
};

// HuggingFace repo file info
export type HuggingFaceRepoFile = {
  filename: string;
  size: number;
  downloadUrl: string;
};

// Disk usage result
export type DiskUsageResult = {
  totalBytes: number;
  modelCount: number;
  modelsDir: string;
  models: Array<{
    id: string;
    name: string;
    sizeBytes: number;
  }>;
};

// Prompt template
export type PromptTemplate = {
  id: string;
  name: string;
  systemPrompt: string;
  outputStructure: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
};

// Catalog health result
export type CatalogHealthResult = {
  modelId: string;
  reachable: boolean;
  error?: string;
};

// LLM generate summary result
export type LLMGenerateSummaryResult = {
  result: {
    summary?: string;
    keyPoints?: Array<{ topic: string; summary: string }>;
    actionItems?: Array<{ text: string; owner?: string; dueDate?: string }>;
    decisions?: Array<{ text: string }>;
    participants?: string[];
  };
  resultIsText: boolean;
  backend: string;
  promptTokens?: number;
  completionTokens?: number;
  timeSeconds?: number;
};

// Legacy type for backwards compatibility
export type LicenseIpcPayload = {
  status?: string;
  type?: string;
  validationMode?: string;
  expiresAt?: string | null;
  lastValidatedAt?: string | null;
  nextValidationAt?: string | null;
  features?: string[];
  issuedTo?: string | null;
  statusMessage?: string | null;
  warning?: string | null;
  [key: string]: unknown;
};

export type StorageApi = {
  // Notes
  createNote: (binderId: string) => Promise<string>;
  saveNote: (input: {
    noteId: string;
    lexicalJson: string;
    plainText: string;
    title?: string;
  }) => Promise<void>;
  getNote: (noteId: string) => Promise<{
    meta: {
      id: string;
      binderId: string;
      title: string;
      createdAt: Date;
      updatedAt: Date;
      deleted: boolean;
      pinned: boolean;
    };
    content: { lexicalJson: string; plainText: string };
  }>;
  listNotesByBinder: (binderId: string) => Promise<NoteListItem[]>;
  listUnassignedNotes: () => Promise<NoteListItem[]>;
  listAllNotes: () => Promise<NoteListItem[]>;
  listNotesByCreatedBetween: (start: number, end: number) => Promise<NoteListItem[]>;
  listDeletedNotes: () => Promise<NoteListItem[]>;
  emptyTrash: () => Promise<{ removed: number }>;
  deleteNote: (noteId: string) => Promise<void>;
  moveNote: (noteId: string, binderId: string) => Promise<void>;
  setStarred: (noteId: string, starred: boolean) => Promise<void>;
  listStarredNotes: () => Promise<NoteListItem[]>;
  setArchived: (noteId: string, archived: boolean) => Promise<void>;
  listArchivedNotes: () => Promise<NoteListItem[]>;
  search: (q: string) => Promise<
    Array<{
      type: 'note' | 'transcription' | 'tag';
      id: string;
      noteId: string | null;
      binderId: string | null;
      title: string;
      snippet: string;
      updatedAt: number;
      tagColor?: string | null;
      tagNoteCount?: number;
    }>
  >;
  // Binders
  listBinders: () => Promise<BinderSummary[]>;
  getDefaultBinderId: (binderName?: string) => Promise<string>;
  createBinder: (name: string, user_profile_id?: string | null) => Promise<string>;
  renameBinder: (id: string, name: string) => Promise<void>;
  updateBinder: (input: {
    id: string;
    name?: string;
    color?: string | null;
    icon?: string | null;
    is_team_shared?: number;
  }) => Promise<void>;
  deleteBinder: (id: string) => Promise<void>;
  reorderBinders: (order: string[]) => Promise<void>;
  // Conflicts (Phase 5)
  listConflicts: () => Promise<NoteListItem[]>;
  countConflicts: () => Promise<{ count: number }>;
  getConflictsForNote: (noteId: string) => Promise<NoteListItem[]>;
  getNotesWithConflicts: () => Promise<string[]>;
  getNoteWithConflictMeta: (noteId: string) => Promise<{
    meta: {
      id: string;
      binderId: string;
      title: string;
      createdAt: Date;
      updatedAt: Date;
      deleted: boolean;
      pinned: boolean;
      starred: boolean;
      archived: boolean;
      isConflict: boolean;
      conflictOfId: string | null;
      conflictCreatedAt: number | null;
    };
    content: { lexicalJson: string; plainText: string };
    conflictCopies: NoteListItem[];
  }>;
  resolveConflictUseConflictVersion: (
    conflictNoteId: string,
    canonicalNoteId: string
  ) => Promise<void>;
  resolveConflictKeepCanonical: (conflictNoteId: string) => Promise<void>;
  getConflictsBinder: () => Promise<BinderSummary | null>;
  hasUnresolvedConflicts: () => Promise<{ hasConflicts: boolean }>;
  listBindersWithConflicts: () => Promise<BinderSummary[]>;
};

export type Api = {
  windowControl: (cmd: 'min' | 'max' | 'close') => void;
  onDeepLink: (cb: (route: string) => void) => () => void;
  onAuthCompleted: (cb: (p: { success: boolean; error?: string }) => void) => () => void;
  onNotesChanged: (cb: () => void) => () => void;
  onSummaryNotification: (
    cb: (notification: {
      id: string;
      type: 'summary-started' | 'summary-completed' | 'summary-failed';
      title: string;
      message: string;
      jobId?: string;
      summaryId?: string;
      transcriptionId?: string;
      timestamp: Date;
    }) => void
  ) => () => void;
  onSummaryProgress: (
    cb: (progress: {
      jobId: string;
      transcriptionId: string;
      progress?: number;
      currentStep?: string;
      timestamp: Date;
    }) => void
  ) => () => void;
  onNavigateToTranscription: (
    cb: (data: { transcriptionId: string; highlightSummary?: boolean }) => void
  ) => () => void;
  rendererReady: () => void;
  platform: NodeJS.Platform;
  isDevelopment: () => Promise<boolean>;
  getVersion: () => Promise<string>;
  setTitlebarOverlay: (options: {
    color?: string;
    symbolColor?: string;
    height?: number;
  }) => Promise<boolean>;
  window: {
    openExternal: (url: string) => Promise<void>;
  };
  log: {
    setLevel: (level: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly') => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
    debug: (message: string, meta?: Record<string, unknown>) => void;
  };
  storage: StorageApi;
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    listByPrefix: (prefix: string) => Promise<Array<{ key: string; value: string }>>;
  };
  user: {
    getProfile: () => Promise<{
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      avatar_path: string | null;
      updated_at: number;
    } | null>;
    saveProfile: (input: {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      avatar_path?: string | null;
    }) => Promise<void>;
  };
  transcription: {
    startSession: (input: {
      binderId: string;
      noteId?: string;
      language: string;
    }) => Promise<{ sessionId: string; noteId: string }>;
    appendFinalText: (input: { sessionId: string; textChunk: string }) => Promise<void>;
    replaceFullText: (input: { sessionId: string; fullText: string }) => Promise<void>;
    completeSession: (input: { sessionId: string; endTime?: number }) => Promise<void>;
    applyRefinement: (input: {
      sessionId: string;
      segmentId: string;
      originalText: string;
      refinedText: string;
      confidenceImprovement?: number;
      timestamp: number;
    }) => Promise<void>;
    listByNote: (noteId: string) => Promise<
      Array<{
        id: string;
        language: string;
        status: string;
        start_time: number;
        end_time?: number;
        duration_ms?: number;
        char_count: number;
        word_count: number;
        updated_at: number;
      }>
    >;
    get: (sessionId: string) => Promise<{
      session: {
        id: string;
        note_id: string;
        binder_id: string;
        language: string;
        status: string;
        start_time: number;
        end_time?: number;
        duration_ms?: number;
        char_count: number;
        word_count: number;
        created_at: number;
        updated_at: number;
      };
      fullText: string;
    }>;
    exportSession: (input: { sessionId: string; targetPath?: string }) => Promise<string>;
    listModels: () => Promise<string[]>;
    restartServer: () => Promise<{ success: boolean; message?: string }>;
    getServerPort: () => Promise<{ port: number }>;
    saveRecording: (input: {
      sessionId: string;
      wavData: string;
    }) => Promise<{ filePath: string; success: boolean; durationMs: number; recordingId: string }>;
    getRecordingPath: (sessionId: string) => Promise<{ filePath: string | null; exists: boolean }>;
    getRecordingWithMeta: (sessionId: string) => Promise<{
      id: string | null;
      filePath: string | null;
      durationMs: number | null;
      exists: boolean;
    }>;
    refine: (
      sessionId: string,
      hints?: string
    ) => Promise<{ text: string; success: boolean; usedHints?: boolean }>;
    saveCorrection: (input: {
      sessionId: string;
      originalText: string;
      correctedText: string;
    }) => Promise<{ success: boolean }>;
    saveSegments: (input: {
      sessionId: string;
      segments: Array<{
        segmentId: string;
        text: string;
        startTime: number;
        endTime: number;
        sequenceOrder: number;
      }>;
    }) => Promise<{ success: boolean; segmentCount: number }>;
    getSegments: (sessionId: string) => Promise<
      Array<{
        id: string;
        segmentId: string;
        text: string;
        startTime: number;
        endTime: number;
        sequenceOrder: number;
        userEdited: boolean;
        originalText: string | null;
      }>
    >;
    markSegmentEdited: (input: {
      sessionId: string;
      segmentId: string;
      newText: string;
    }) => Promise<{ success: boolean }>;
    listAllWithDetails: () => Promise<
      Array<{
        id: string;
        noteId: string;
        binderId: string;
        noteTitle: string;
        startTime: number;
        endTime: number | null;
        durationMs: number | null;
        wordCount: number;
        charCount: number;
        previewText: string;
      }>
    >;
    getContent: (sessionId: string) => Promise<string>;
    createDevSession: (input: {
      binderId: string;
      noteId: string;
      text: string;
    }) => Promise<{ sessionId: string; success: boolean }>;
    // Model management
    getModelsStatus: () => Promise<{
      models: Array<{
        id: string;
        name: string;
        paramsMB: number;
        englishOnly: boolean;
        accuracy: string;
        description?: string;
        downloaded: boolean;
      }>;
      loadedModel: string | null;
      downloads: Record<string, { status: string; progress?: number; error?: string }>;
    }>;
    downloadWhisperModel: (
      modelName: string
    ) => Promise<{ success: boolean; message?: string; error?: string }>;
    deleteWhisperModel: (modelName: string) => Promise<{ success: boolean; error?: string }>;
    setDefaultWhisperModel: (modelName: string) => Promise<{ success: boolean }>;
    getDefaultWhisperModel: () => Promise<{ modelName: string | null }>;
    // Settings persistence
    getTranscriptionSettings: () => Promise<Record<string, string>>;
    setTranscriptionSettings: (settings: Record<string, unknown>) => Promise<{ success: boolean }>;
  };
  summary: {
    generate: (input: {
      transcriptionId: string;
      summaryType?: string;
      forceRegenerate?: boolean;
    }) => Promise<{
      success: boolean;
      summary?: {
        id: string;
        transcriptionId: string;
        summaryText: string;
        summaryType: string;
        processingTimeMs?: number;
        modelUsed?: string;
        backendType?: string;
        pipelineUsed?: boolean;
        createdAt: Date;
        updatedAt: Date;
      };
      error?: string;
    }>;
    get: (summaryId: string) => Promise<{
      success: boolean;
      summary?: {
        id: string;
        transcriptionId: string;
        summaryText: string;
        summaryType: string;
        processingTimeMs?: number;
        modelUsed?: string;
        backendType?: string;
        pipelineUsed?: boolean;
        createdAt: Date;
        updatedAt: Date;
      };
      error?: string;
    }>;
    getByTranscription: (transcriptionId: string) => Promise<{
      success: boolean;
      summaries?: Array<{
        id: string;
        transcriptionId: string;
        summaryText: string;
        summaryType: string;
        processingTimeMs?: number;
        modelUsed?: string;
        backendType?: string;
        pipelineUsed?: boolean;
        createdAt: Date;
        updatedAt: Date;
      }>;
      error?: string;
    }>;
    delete: (summaryId: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    list: () => Promise<{
      success: boolean;
      summaries?: Array<{
        id: string;
        transcriptionId: string;
        summaryText: string;
        summaryType: string;
        processingTimeMs?: number;
        modelUsed?: string;
        backendType?: string;
        pipelineUsed?: boolean;
        createdAt: Date;
        updatedAt: Date;
      }>;
      error?: string;
    }>;
    checkServerSummaryExists: (transcriptionId: string) => Promise<{
      success: boolean;
      exists?: boolean;
      error?: string;
    }>;
    updateSummaryText: (
      summaryId: string,
      summaryText: string
    ) => Promise<{ success: boolean; error?: string }>;
  };
  calendar: {
    getStatus: () => Promise<{
      connected: boolean;
      syncStatus?: string | null;
      lastSyncTime?: string | null;
      errorMessage?: string | null;
    }>;
    listEvents: (input: {
      startTime: string;
      endTime: string;
      timezone?: string;
      maxResults?: number;
      useCache?: boolean;
      forceRefresh?: boolean;
    }) => Promise<unknown[]>;
    getConnectUrl: () => Promise<string>;
    startConnect: () => Promise<boolean>;
    disconnect: () => Promise<boolean>;
    onConnectResult: (
      cb: (result: { success: boolean; error?: string | null; canceled?: boolean }) => void
    ) => () => void;
  };
  license: {
    getCurrent: () => Promise<LicensePayload | null>;
    validate: (key: string) => Promise<LicensePayload | null>;
    clearCache: () => Promise<void>;
    getFeatures: () => Promise<string[]>;
    hasFeature: (key: string) => Promise<boolean>;
    manualCheck: () => Promise<LicensePayload>;
    checkServerHealth: (
      apiUrl?: string
    ) => Promise<{ online: boolean; responseTime: number; error?: string }>;
    setApiUrl: (url: string | null) => Promise<void>;
    getApiUrl: () => Promise<string>;
    fetchCurrent: () => Promise<LicensePayload>;
    getDiagnostics: () => Promise<unknown>;
    exportDiagnostics: () => Promise<{ success: boolean; path?: string; error?: string }>;
    clearValidationHistory: () => Promise<void>;
    onChanged: (cb: (payload: LicensePayload) => void) => () => void;
    onFeaturesChanged: (cb: (features: string[]) => void) => () => void;
    onValidated: (cb: (event: LicenseValidatedEvent) => void) => () => void;
    onExpired: (cb: (event: LicenseExpiredEvent) => void) => () => void;
    onWarning: (cb: (warning: LicenseWarning) => void) => () => void;
    // Upgrade polling
    startUpgradePolling: () => Promise<void>;
    stopUpgradePolling: () => Promise<void>;
    getUpgradePollingStatus: () => Promise<UpgradePollingStatus>;
    onUpgradePollingStatusChanged: (cb: (status: UpgradePollingStatus) => void) => () => void;
    onUpgradeSuccess: (cb: (license: LicensePayload) => void) => () => void;
    // Activation for na- (Notely AI) licenses
    activate: (
      licenseKey: string,
      email: string
    ) => Promise<
      | {
          success: true;
          activationId: string;
          email: string;
          tierKey: string;
          tierName: string;
          features: Record<string, boolean>;
          offlineToken: string;
          offlineGraceDeadline: string;
          nextRequiredValidation: string;
        }
      | { success: false; error: { code: string; message: string; existingEmail?: string } }
    >;
    isActivated: () => Promise<boolean>;
    getActivationDetails: () => Promise<{
      activationId: string;
      email: string;
      activatedAt: string;
      offlineGraceDeadline: string | null;
      nextRequiredValidation: string | null;
    } | null>;
    revalidateActivation: () => Promise<LicensePayload>;
    deactivate: () => Promise<boolean>;
  };
  heartbeat: {
    getStatus: () => Promise<HeartbeatStatus>;
    onLimitExceeded: (cb: (event: HeartbeatLimitExceeded) => void) => () => void;
  };
  update: {
    check: (force?: boolean) => Promise<{ success: boolean; data?: UpdateInfo; error?: string }>;
    getCached: () => Promise<UpdateInfo | null>;
    openDownload: () => Promise<boolean>;
    dismiss: (version: string) => Promise<void>;
    isDismissed: (version: string) => Promise<boolean>;
    getVersion: () => Promise<string>;
    // New download methods
    startDownload: () => Promise<{ success: boolean; error?: string }>;
    getDownloadStatus: () => Promise<DownloadStatus>;
    isDownloadReady: () => Promise<boolean>;
    installAndRestart: () => Promise<{ success: boolean; error?: string }>;
    cancelDownload: () => Promise<void>;
    resetDownload: () => Promise<void>;
    // Events
    onAvailable: (cb: (info: UpdateInfo) => void) => () => void;
    onDismissed: (cb: (version: string) => void) => () => void;
    onDownloadStarted: (cb: () => void) => () => void;
    onDownloadProgress: (cb: (progress: number) => void) => () => void;
    onDownloadComplete: (cb: (downloadPath: string) => void) => () => void;
    onDownloadError: (cb: (error: string) => void) => () => void;
  };
  meetingReminder: {
    getState: () => Promise<MeetingReminderState>;
    setEnabled: (enabled: boolean) => Promise<void>;
    setMuteUntil: (muteUntil: number | null) => Promise<void>;
    clearMute: () => Promise<void>;
    snooze: (eventKey: string, snoozeUntil: number) => Promise<void>;
    clearSnooze: (eventKey: string) => Promise<void>;
    refresh: () => Promise<void>;
    dismiss: () => Promise<void>;
    testTrigger: () => Promise<void>;
    onReminderDue: (cb: (payload: MeetingReminderTriggerPayload) => void) => () => void;
    onStateChanged: (cb: (state: MeetingReminderState) => void) => () => void;
    startRecording: (input: {
      payload: MeetingReminderTriggerPayload;
      force?: boolean;
    }) => Promise<MeetingReminderRecordResponse>;
    onRecordCommand: (cb: (command: MeetingReminderRecordCommand) => void) => () => void;
  };
  sync: {
    // Sync is managed by SyncLifecycleManager state machine
    // Manual sync triggers go through push() which uses the state machine
    push: () => Promise<{ success: boolean; error?: string; processed?: number; message?: string }>;
    getStatus: () => Promise<{
      isConfigured: boolean;
      isLinked: boolean;
      isEnabled: boolean;
      lastPush: number | null;
      lastPull: number | null;
      lastSync?: number | null;
      hasValidToken: boolean;
    }>;
    getHealthMetrics: () => Promise<Record<string, unknown>>;
    getHealthStatus: () => Promise<Record<string, unknown>>;
    getServerStats: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };
  auth: {
    beginMicrosoftLogin: () => Promise<{ success: boolean; error?: string }>;
    passwordLogin: (
      email: string,
      password: string
    ) => Promise<{
      success: boolean;
      error?: string;
    }>;
    startWebLogin: () => Promise<boolean>;
    linkAccount: () => Promise<{ success: boolean; error?: string }>;
    logout: () => Promise<{ success: boolean; error?: string }>;
    getStatus: () => Promise<{
      isConfigured: boolean;
      isLinked: boolean;
      hasValidAccessToken: boolean;
      tokenExpiresAt: string | null;
      userId: string | null;
      deviceId: string | null;
    }>;
  };
  onSettingsChanged: (cb: (key: string, value: string) => void) => () => void;
  onSettingsHydrate: (cb: (rows: Array<{ key: string; value: string }>) => void) => () => void;
  onProfileChanged?: (cb: () => void) => () => void;
  // Sync lifecycle events (emitted by SyncLifecycleManager state machine)
  onSyncStart: (cb: (data: object) => void) => () => void;
  onSyncProgress: (cb: (data: unknown) => void) => () => void;
  onSyncComplete: (cb: (data: unknown) => void) => () => void;
  onSyncError: (cb: (data: unknown) => void) => () => void;
  onSyncConflict: (cb: (data: unknown) => void) => () => void;
  systemAudio: {
    isSupported: () => Promise<boolean>;
    getInitError: () => Promise<string | null>;
    getLoopbackStream: () => Promise<MediaStream>;
  };
  tags: {
    create: (input: { name: string; color?: string }) => Promise<string>;
    list: () => Promise<
      Array<{
        id: string;
        userId: string | null;
        name: string;
        color: string | null;
        sortIndex: number;
        createdAt: Date;
        updatedAt: Date;
        deleted: boolean;
        noteCount?: number;
      }>
    >;
    get: (id: string) => Promise<{
      id: string;
      userId: string | null;
      name: string;
      color: string | null;
      sortIndex: number;
      createdAt: Date;
      updatedAt: Date;
      deleted: boolean;
      noteCount?: number;
    } | null>;
    update: (input: { id: string; name?: string; color?: string | null }) => Promise<void>;
    delete: (id: string) => Promise<void>;
    reorder: (ids: string[]) => Promise<void>;
    addToNote: (noteId: string, tagId: string) => Promise<string>;
    removeFromNote: (noteId: string, tagId: string) => Promise<void>;
    setNoteTags: (noteId: string, tagIds: string[]) => Promise<void>;
    getByNote: (noteId: string) => Promise<
      Array<{
        id: string;
        userId: string | null;
        name: string;
        color: string | null;
        sortIndex: number;
        createdAt: Date;
        updatedAt: Date;
        deleted: boolean;
        noteCount?: number;
      }>
    >;
    getNotesByTag: (tagId: string) => Promise<NoteListItem[]>;
  };
  onTagsChanged: (cb: () => void) => () => void;
  onNoteTagsChanged: (cb: () => void) => () => void;
  // Password protection / security
  security: {
    getPasswordStatus: () => Promise<{
      enabled: boolean;
      locked: boolean;
      rememberActive: boolean;
      rememberUntil: string | null;
      recoveryKeyShown: boolean;
      passwordChangedAt: string | null;
    }>;
    enablePassword: (input: {
      password: string;
      confirmPassword: string;
    }) => Promise<{ success: boolean; error?: string }>;
    disablePassword: (input: { password: string }) => Promise<{ success: boolean; error?: string }>;
    verifyPassword: (input: {
      password: string;
      remember?: boolean;
    }) => Promise<{ success: boolean; error?: string }>;
    changePassword: (input: {
      currentPassword: string;
      newPassword: string;
      confirmPassword: string;
    }) => Promise<{ success: boolean; error?: string }>;
    lock: () => Promise<{ success: boolean }>;
    clearRemember: () => Promise<{ success: boolean }>;
    exportRecoveryKey: () => Promise<string>;
    importRecoveryKey: (input: {
      recoveryKey: string;
    }) => Promise<{ success: boolean; error?: string }>;
    markRecoveryKeyShown: () => Promise<{ success: boolean }>;
    resetPasswordWithRecoveryKey: (input: {
      recoveryKey: string;
      newPassword: string;
      confirmPassword: string;
    }) => Promise<{ success: boolean; error?: string }>;
    onStatusChanged: (
      cb: (status: {
        enabled: boolean;
        locked: boolean;
        rememberActive: boolean;
        rememberUntil: string | null;
        recoveryKeyShown: boolean;
        passwordChangedAt: string | null;
      }) => void
    ) => () => void;
  };
  // Note export functionality
  export: {
    note: (
      noteId: string,
      format: 'txt' | 'md' | 'docx' | 'rtf' | 'pdf'
    ) => Promise<{
      success: boolean;
      filePath?: string;
      error?: string;
    }>;
  };
  // Component download functionality
  components: {
    checkAll: () => Promise<ComponentInfo[]>;
    download: (componentId: string) => Promise<DownloadResult>;
    downloadAll: () => Promise<{ success: boolean; results: DownloadResult[] }>;
    cancelDownload: () => Promise<void>;
    verify: (componentId: string) => Promise<VerificationResult>;
    repair: (componentId: string) => Promise<DownloadResult>;
    getInfo: (componentId: string) => Promise<ComponentInfo>;
    areAllReady: () => Promise<boolean>;
    // Event listeners
    onStatusChanged: (cb: (info: ComponentInfo) => void) => () => void;
    onDownloadProgress: (cb: (progress: DownloadProgress) => void) => () => void;
    onDownloadComplete: (cb: (componentId: string) => void) => () => void;
    onDownloadError: (cb: (data: { componentId: string; error: string }) => void) => () => void;
    onAllReady: (cb: () => void) => () => void;
    // Setup status (main process Phase 2.5 progress)
    getSetupStatus: () => Promise<SetupStatusEvent | null>;
    setupRetryComplete: () => Promise<void>;
    onSetupStatus: (cb: (status: SetupStatusEvent) => void) => () => void;
  };
  // Local LLM functionality (Standalone Edition)
  llm: {
    // Status and lifecycle
    getStatus: () => Promise<LLMStatus>;
    loadModel: (input: {
      modelId: string;
      nGpuLayers?: number;
      nCtx?: number;
    }) => Promise<{ success: boolean; error?: string }>;
    unloadModel: () => Promise<{ success: boolean; error?: string }>;
    getLoadedModel: () => Promise<{
      loaded: boolean;
      modelId: string | null;
      modelInfo: ModelCatalogEntry | null;
      modelPath: string | null;
    }>;
    // Model catalog
    getAvailableModels: () => Promise<ModelCatalogEntry[]>;
    getDownloadedModels: () => Promise<DownloadedModel[]>;
    downloadModel: (input: {
      modelId: string;
      hfToken?: string;
    }) => Promise<{ success: boolean; path?: string; error?: string }>;
    deleteModel: (input: { modelId: string }) => Promise<{ success: boolean; error?: string }>;
    cancelDownload: (input: { modelId: string }) => Promise<{ success: boolean }>;
    // Inference
    generateSummary: (input: {
      transcriptionId: string;
      text: string;
      analysisType?: string;
      skipRefinement?: boolean;
    }) => Promise<{ success: boolean; result?: LLMGenerateSummaryResult; error?: string }>;
    // GPU
    getGPUInfo: () => Promise<GPUInfoResult>;
    getRecommendedModels: () => Promise<ModelCatalogEntry[]>;
    // Settings
    getModelParameters: () => Promise<ModelParameters>;
    setModelParameters: (input: {
      temperatureExtract?: number;
      temperatureRefine?: number;
      maxTokens?: number;
      topP?: number;
      contextWindow?: number;
      nGpuLayers?: number;
    }) => Promise<{ success: boolean; error?: string }>;
    getDefaultModel: () => Promise<string | null>;
    setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
    // HuggingFace
    setHuggingFaceToken: (input: {
      token: string;
    }) => Promise<{ success: boolean; user?: { name: string }; error?: string }>;
    getHuggingFaceToken: () => Promise<{
      hasToken: boolean;
      maskedToken: string | null;
      user: { name: string } | null;
    }>;
    validateHuggingFaceToken: () => Promise<{ valid: boolean; error?: string; user?: HFUserInfo }>;
    clearHuggingFaceToken: () => Promise<{ success: boolean }>;
    hasHuggingFaceToken: () => Promise<boolean>;
    // Prompts
    getPrompts: () => Promise<PromptsConfig>;
    setPrompts: (input: {
      systemPrompt?: string;
      structure?: Record<string, unknown>;
    }) => Promise<{ success: boolean; error?: string }>;
    resetPrompts: () => Promise<{ success: boolean }>;
    // Server management
    startServer: () => Promise<{ success: boolean; port?: number; error?: string }>;
    stopServer: () => Promise<{ success: boolean; error?: string }>;
    restartServer: () => Promise<{ success: boolean; port?: number; error?: string }>;
    // Custom model management
    getDiskUsage: () => Promise<DiskUsageResult>;
    parseHuggingFaceUrl: (input: { url: string }) => Promise<ParsedHuggingFaceUrl>;
    downloadCustomModel: (input: {
      url: string;
      filename: string;
      modelId: string;
      repo?: string;
      name?: string;
    }) => Promise<{ success: boolean; path?: string; error?: string }>;
    removeCustomModel: (input: {
      modelId: string;
    }) => Promise<{ success: boolean; error?: string }>;
    validateCatalogUrls: (input?: { modelIds?: string[] }) => Promise<CatalogHealthResult[]>;
    openModelsDirectory: () => Promise<{ success: boolean; error?: string }>;
    refreshModels: () => Promise<{
      downloadedModels: DownloadedModel[];
      diskUsage: DiskUsageResult;
    }>;
    // Event listeners
    onDownloadProgress: (cb: (progress: LLMDownloadProgress) => void) => () => void;
    onDownloadStarted: (cb: (data: { modelId: string; totalBytes: number }) => void) => () => void;
    onDownloadCompleted: (cb: (data: { modelId: string; path: string }) => void) => () => void;
    onDownloadFailed: (cb: (data: { modelId: string; error: string }) => void) => () => void;
    onDownloadCancelled: (cb: (data: { modelId: string }) => void) => () => void;
    onModelLoaded: (
      cb: (data: { modelPath: string; loadTimeSeconds: number }) => void
    ) => () => void;
    onModelUnloaded: (cb: () => void) => () => void;
    onGenerationStarted: (cb: (data: { textLength: number }) => void) => () => void;
    onGenerationCompleted: (cb: (data: { timeSeconds: number }) => void) => () => void;
    onError: (cb: (data: { error: string }) => void) => () => void;
  };
  // GPU detection (Standalone Edition)
  gpu: {
    detect: () => Promise<GPUInfoResult>;
    getCapabilities: () => Promise<GPUInfoResult>;
    getRecommendedModels: () => Promise<ModelCatalogEntry[]>;
  };
  // Prompt templates
  promptTemplates: {
    list: () => Promise<PromptTemplate[]>;
    get: (id: string) => Promise<PromptTemplate | null>;
    create: (input: {
      name: string;
      systemPrompt?: string;
      outputStructure?: string;
      cloneFromId?: string;
    }) => Promise<{ success: boolean; template?: PromptTemplate; error?: string }>;
    update: (input: {
      id: string;
      name?: string;
      systemPrompt?: string;
      outputStructure?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    getActive: () => Promise<string>;
    setActive: (id: string) => Promise<{ success: boolean; error?: string }>;
  };
  // Diagnostics
  diagnostics: {
    export: () => Promise<{ success: boolean; path?: string; error?: string }>;
  };
  // Native menu events (macOS)
  menu: {
    onNavigate: (cb: (route: string) => void) => () => void;
    onOpenTranscriptions: (cb: () => void) => () => void;
    onExport: (cb: (format: string) => void) => () => void;
    onFontZoomIn: (cb: () => void) => () => void;
    onFontZoomOut: (cb: () => void) => () => void;
    onFontZoomReset: (cb: () => void) => () => void;
    onNewNote: (cb: () => void) => () => void;
    updateState: (state: { noteId: string | null }) => void;
  };
};

const storage: StorageApi = {
  createNote: (binderId) => ipcRenderer.invoke(IPC.STORAGE_CREATE_NOTE, { binderId }),
  saveNote: (input) => ipcRenderer.invoke(IPC.STORAGE_SAVE_NOTE, input),
  getNote: (noteId) => ipcRenderer.invoke(IPC.STORAGE_GET_NOTE, { noteId }),
  listNotesByBinder: (binderId) =>
    ipcRenderer.invoke(IPC.STORAGE_LIST_NOTES_BY_BINDER, { binderId }),
  listUnassignedNotes: () => ipcRenderer.invoke(IPC.STORAGE_LIST_UNASSIGNED_NOTES),
  listAllNotes: () => ipcRenderer.invoke(IPC.STORAGE_LIST_ALL_NOTES),
  listNotesByCreatedBetween: (start, end) =>
    ipcRenderer.invoke(IPC.STORAGE_LIST_NOTES_BY_CREATED, { start, end }),
  listDeletedNotes: () => ipcRenderer.invoke(IPC.STORAGE_LIST_DELETED_NOTES),
  emptyTrash: () => ipcRenderer.invoke(IPC.STORAGE_EMPTY_TRASH),
  deleteNote: (noteId) => ipcRenderer.invoke(IPC.STORAGE_DELETE_NOTE, { noteId }),
  moveNote: (noteId, binderId) => ipcRenderer.invoke(IPC.STORAGE_MOVE_NOTE, { noteId, binderId }),
  setStarred: (noteId, starred) => ipcRenderer.invoke(IPC.STORAGE_SET_STARRED, { noteId, starred }),
  listStarredNotes: () => ipcRenderer.invoke(IPC.STORAGE_LIST_STARRED_NOTES),
  setArchived: (noteId, archived) =>
    ipcRenderer.invoke(IPC.STORAGE_SET_ARCHIVED, { noteId, archived }),
  listArchivedNotes: () => ipcRenderer.invoke(IPC.STORAGE_LIST_ARCHIVED_NOTES),
  search: (q) => ipcRenderer.invoke(IPC.STORAGE_SEARCH, { q }),
  listBinders: () => ipcRenderer.invoke(IPC.STORAGE_LIST_BINDERS),
  getDefaultBinderId: (binderName) =>
    ipcRenderer.invoke(IPC.STORAGE_GET_DEFAULT_BINDER_ID, binderName),
  createBinder: (name, user_profile_id = null) =>
    ipcRenderer.invoke(IPC.STORAGE_CREATE_BINDER, { name, user_profile_id }),
  renameBinder: (id, name) => ipcRenderer.invoke(IPC.STORAGE_RENAME_BINDER, { id, name }),
  updateBinder: (input) => ipcRenderer.invoke(IPC.STORAGE_UPDATE_BINDER, input),
  deleteBinder: (id) => ipcRenderer.invoke(IPC.STORAGE_DELETE_BINDER, { id }),
  reorderBinders: (order) => ipcRenderer.invoke(IPC.STORAGE_REORDER_BINDERS, { order }),
  // Conflicts (Phase 5)
  listConflicts: () => ipcRenderer.invoke(IPC.STORAGE_LIST_CONFLICTS),
  countConflicts: () => ipcRenderer.invoke(IPC.STORAGE_COUNT_CONFLICTS),
  getConflictsForNote: (noteId) =>
    ipcRenderer.invoke(IPC.STORAGE_GET_CONFLICTS_FOR_NOTE, { noteId }),
  getNotesWithConflicts: () => ipcRenderer.invoke(IPC.STORAGE_GET_NOTES_WITH_CONFLICTS),
  getNoteWithConflictMeta: (noteId) =>
    ipcRenderer.invoke(IPC.STORAGE_GET_NOTE_WITH_CONFLICT_META, { noteId }),
  resolveConflictUseConflictVersion: (conflictNoteId, canonicalNoteId) =>
    ipcRenderer.invoke(IPC.STORAGE_RESOLVE_USE_CONFLICT, {
      conflictNoteId,
      canonicalNoteId,
    }),
  resolveConflictKeepCanonical: (conflictNoteId) =>
    ipcRenderer.invoke(IPC.STORAGE_RESOLVE_KEEP_CANONICAL, { conflictNoteId }),
  getConflictsBinder: () => ipcRenderer.invoke(IPC.STORAGE_GET_CONFLICTS_BINDER),
  hasUnresolvedConflicts: () => ipcRenderer.invoke(IPC.STORAGE_HAS_UNRESOLVED_CONFLICTS),
  listBindersWithConflicts: () => ipcRenderer.invoke(IPC.STORAGE_LIST_BINDERS_WITH_CONFLICTS),
};

const api = {
  windowControl: (cmd: 'min' | 'max' | 'close') => ipcRenderer.send(IPC.WINDOW_CONTROL, cmd),
  onDeepLink: (cb: (route: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, route: string) => cb(route);
    ipcRenderer.on(IPC.EVT_DEEP_LINK, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_DEEP_LINK, handler);
  },
  onAuthCompleted: (cb: (p: { success: boolean; error?: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: { success: boolean; error?: string }) =>
      cb(p);
    ipcRenderer.on(IPC.EVT_AUTH_COMPLETED, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_AUTH_COMPLETED, handler);
  },
  meetingReminder: {
    getState: (): Promise<MeetingReminderState> =>
      ipcRenderer.invoke(IPC.MEETING_REMINDER_GET_STATE),
    setEnabled: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.MEETING_REMINDER_SET_ENABLED, { enabled }),
    setMuteUntil: (muteUntil: number | null): Promise<void> =>
      ipcRenderer.invoke(IPC.MEETING_REMINDER_SET_MUTE_UNTIL, { muteUntil }),
    clearMute: (): Promise<void> => ipcRenderer.invoke(IPC.MEETING_REMINDER_CLEAR_MUTE),
    snooze: (eventKey: string, snoozeUntil: number): Promise<void> =>
      ipcRenderer.invoke(IPC.MEETING_REMINDER_SNOOZE, { eventKey, snoozeUntil }),
    clearSnooze: (eventKey: string): Promise<void> =>
      ipcRenderer.invoke(IPC.MEETING_REMINDER_CLEAR_SNOOZE, { eventKey }),
    refresh: (): Promise<void> => ipcRenderer.invoke(IPC.MEETING_REMINDER_REFRESH),
    dismiss: (): Promise<void> => ipcRenderer.invoke(IPC.MEETING_REMINDER_DISMISS),
    testTrigger: (): Promise<void> => ipcRenderer.invoke(IPC.MEETING_REMINDER_TEST_TRIGGER),
    onReminderDue: (cb: (payload: MeetingReminderTriggerPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: MeetingReminderTriggerPayload) =>
        cb(payload);
      ipcRenderer.on(IPC.EVT_MEETING_REMINDER_DUE, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_MEETING_REMINDER_DUE, handler);
    },
    onStateChanged: (cb: (state: MeetingReminderState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: MeetingReminderState) => cb(state);
      ipcRenderer.on(IPC.EVT_MEETING_REMINDER_STATE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_MEETING_REMINDER_STATE_CHANGED, handler);
    },
    startRecording: (input: {
      payload: MeetingReminderTriggerPayload;
      force?: boolean;
    }): Promise<MeetingReminderRecordResponse> =>
      ipcRenderer.invoke(IPC.MEETING_REMINDER_START_RECORDING, input),
    onRecordCommand: (cb: (command: MeetingReminderRecordCommand) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, command: MeetingReminderRecordCommand) =>
        cb(command);
      ipcRenderer.on(IPC.EVT_MEETING_REMINDER_RECORD_CMD, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_MEETING_REMINDER_RECORD_CMD, handler);
    },
  },
  rendererReady: () => ipcRenderer.send(IPC.RENDERER_READY),
  platform: process.platform,
  isDevelopment: () => ipcRenderer.invoke(IPC.APP_IS_DEVELOPMENT),
  getVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION),
  setTitlebarOverlay: (options: { color?: string; symbolColor?: string; height?: number }) =>
    ipcRenderer.invoke(IPC.WINDOW_SET_TITLEBAR_OVERLAY, options),
  window: {
    openExternal: (url: string) => ipcRenderer.invoke(IPC.WINDOW_OPEN_EXTERNAL, url),
  },
  log: {
    setLevel: (level: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly') =>
      ipcRenderer.send(IPC.LOG_SET_LEVEL, level),
    info: (message: string, meta?: Record<string, unknown>) =>
      ipcRenderer.send(IPC.LOG_INFO, { message, meta }),
    warn: (message: string, meta?: Record<string, unknown>) =>
      ipcRenderer.send(IPC.LOG_WARN, { message, meta }),
    error: (message: string, meta?: Record<string, unknown>) =>
      ipcRenderer.send(IPC.LOG_ERROR, { message, meta }),
    debug: (message: string, meta?: Record<string, unknown>) =>
      ipcRenderer.send(IPC.LOG_DEBUG, { message, meta }),
  },
  storage,
  settings: {
    get: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_GET, { key }),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC.SETTINGS_SET, { key, value }),
    listByPrefix: (prefix: string) => ipcRenderer.invoke(IPC.SETTINGS_LIST_BY_PREFIX, { prefix }),
  },
  user: {
    getProfile: () => ipcRenderer.invoke(IPC.USER_GET_PROFILE),
    saveProfile: (input) => ipcRenderer.invoke(IPC.USER_SAVE_PROFILE, input),
  },
  transcription: {
    startSession: (input: { binderId: string; noteId?: string; language: string }) =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_START_SESSION, input),
    appendFinalText: (input: { sessionId: string; textChunk: string }) =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_APPEND_FINAL_TEXT, input),
    replaceFullText: (input: { sessionId: string; fullText: string }) =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_REPLACE_FULL_TEXT, input),
    completeSession: (input: { sessionId: string; endTime?: number }) =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_COMPLETE_SESSION, input),
    applyRefinement: (input: {
      sessionId: string;
      segmentId: string;
      originalText: string;
      refinedText: string;
      confidenceImprovement?: number;
      timestamp: number;
    }) => ipcRenderer.invoke(IPC.TRANSCRIPTION_APPLY_REFINEMENT, input),
    listByNote: (noteId: string) => ipcRenderer.invoke(IPC.TRANSCRIPTION_LIST_BY_NOTE, { noteId }),
    get: (sessionId: string) => ipcRenderer.invoke(IPC.TRANSCRIPTION_GET, { sessionId }),
    // Convenience bridge for content preview in UI
    getContent: async (sessionId: string): Promise<string> => {
      const result = await ipcRenderer.invoke(IPC.TRANSCRIPTION_GET, { sessionId });
      // result is { session, fullText }
      return result?.fullText ?? '';
    },
    exportSession: (input: { sessionId: string; targetPath?: string }) =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_EXPORT_SESSION, input),
    listModels: (): Promise<string[]> => ipcRenderer.invoke(IPC.TRANSCRIPTION_LIST_MODELS),
    restartServer: (): Promise<{ success: boolean; message?: string }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_RESTART_SERVER),
    getServerPort: (): Promise<{ port: number }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_GET_SERVER_PORT),
    saveRecording: (input: {
      sessionId: string;
      wavData: string;
    }): Promise<{ filePath: string; success: boolean; durationMs: number; recordingId: string }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_SAVE_RECORDING, input),
    getRecordingPath: (sessionId: string): Promise<{ filePath: string | null; exists: boolean }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_GET_RECORDING_PATH, { sessionId }),
    getRecordingWithMeta: (
      sessionId: string
    ): Promise<{
      id: string | null;
      filePath: string | null;
      durationMs: number | null;
      exists: boolean;
    }> => ipcRenderer.invoke(IPC.TRANSCRIPTION_GET_RECORDING_META, { sessionId }),
    refine: (
      sessionId: string,
      hints?: string
    ): Promise<{ text: string; success: boolean; usedHints?: boolean }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_REFINE, { sessionId, hints }),
    saveCorrection: (input: {
      sessionId: string;
      originalText: string;
      correctedText: string;
    }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_SAVE_CORRECTION, input),
    saveSegments: (input: {
      sessionId: string;
      segments: Array<{
        segmentId: string;
        text: string;
        startTime: number;
        endTime: number;
        sequenceOrder: number;
      }>;
    }): Promise<{ success: boolean; segmentCount: number }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_SAVE_SEGMENTS, input),
    getSegments: (
      sessionId: string
    ): Promise<
      Array<{
        id: string;
        segmentId: string;
        text: string;
        startTime: number;
        endTime: number;
        sequenceOrder: number;
        userEdited: boolean;
        originalText: string | null;
      }>
    > => ipcRenderer.invoke(IPC.TRANSCRIPTION_GET_SEGMENTS, { sessionId }),
    markSegmentEdited: (input: {
      sessionId: string;
      segmentId: string;
      newText: string;
    }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_MARK_SEGMENT_EDITED, input),
    listAllWithDetails: (): Promise<
      Array<{
        id: string;
        noteId: string;
        binderId: string;
        noteTitle: string;
        startTime: number;
        endTime: number | null;
        durationMs: number | null;
        wordCount: number;
        charCount: number;
        previewText: string;
      }>
    > => ipcRenderer.invoke(IPC.TRANSCRIPTION_LIST_ALL_WITH_DETAILS),
    // DEV ONLY: Create a transcription with pasted text
    createDevSession: (input: { binderId: string; noteId: string; text: string }) =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_CREATE_DEV_SESSION, input),
    // Model management
    getModelsStatus: () => ipcRenderer.invoke(IPC.TRANSCRIPTION_GET_MODELS_STATUS),
    downloadWhisperModel: (modelName: string) =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_DOWNLOAD_MODEL, { modelName }),
    deleteWhisperModel: (modelName: string) =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_DELETE_MODEL, { modelName }),
    setDefaultWhisperModel: (modelName: string) =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_SET_DEFAULT_MODEL, { modelName }),
    getDefaultWhisperModel: (): Promise<{ modelName: string | null }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_GET_DEFAULT_MODEL),
    // Settings persistence
    getTranscriptionSettings: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_GET_SETTINGS),
    setTranscriptionSettings: (settings: Record<string, unknown>): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPTION_SET_SETTINGS, settings),
  },
  summary: {
    generate: (input: {
      transcriptionId: string;
      summaryType?: string;
      forceRegenerate?: boolean;
    }) => ipcRenderer.invoke(IPC.SUMMARY_GENERATE, input),
    get: (summaryId: string) => ipcRenderer.invoke(IPC.SUMMARY_GET, { summaryId }),
    getByTranscription: (transcriptionId: string) =>
      ipcRenderer.invoke(IPC.SUMMARY_GET_BY_TRANSCRIPTION, { transcriptionId }),
    delete: (summaryId: string) => ipcRenderer.invoke(IPC.SUMMARY_DELETE, { summaryId }),
    list: () => ipcRenderer.invoke(IPC.SUMMARY_LIST),
    checkServerSummaryExists: (transcriptionId: string) =>
      ipcRenderer.invoke(IPC.SUMMARY_CHECK_SERVER_EXISTS, transcriptionId),
    updateSummaryText: (summaryId: string, summaryText: string) =>
      ipcRenderer.invoke(IPC.SUMMARY_UPDATE_TEXT, { summaryId, summaryText }),
  },
  calendar: {
    getStatus: () => ipcRenderer.invoke(IPC.CALENDAR_GET_STATUS),
    listEvents: (input) => ipcRenderer.invoke(IPC.CALENDAR_LIST_EVENTS, input),
    getConnectUrl: () => ipcRenderer.invoke(IPC.CALENDAR_GET_CONNECT_URL),
    startConnect: () => ipcRenderer.invoke(IPC.CALENDAR_START_CONNECT),
    disconnect: () => ipcRenderer.invoke(IPC.CALENDAR_DISCONNECT),
    onConnectResult: (cb) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { success: boolean; error?: string | null; canceled?: boolean }
      ) => {
        cb(payload);
      };
      ipcRenderer.on(IPC.EVT_CALENDAR_CONNECT_RESULT, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_CALENDAR_CONNECT_RESULT, handler);
      };
    },
  },
  license: {
    getCurrent: () => ipcRenderer.invoke(IPC.LICENSE_GET_CURRENT),
    validate: (key: string) => ipcRenderer.invoke(IPC.LICENSE_VALIDATE, { key }),
    clearCache: () => ipcRenderer.invoke(IPC.LICENSE_CLEAR_CACHE),
    getFeatures: () => ipcRenderer.invoke(IPC.LICENSE_GET_FEATURES),
    hasFeature: (key: string) => ipcRenderer.invoke(IPC.LICENSE_HAS_FEATURE, key),
    manualCheck: () => ipcRenderer.invoke(IPC.LICENSE_MANUAL_CHECK),
    checkServerHealth: (apiUrl?: string) =>
      ipcRenderer.invoke(IPC.LICENSE_CHECK_SERVER_HEALTH, apiUrl),
    setApiUrl: (url: string | null) => ipcRenderer.invoke(IPC.LICENSE_SET_API_URL, url),
    getApiUrl: () => ipcRenderer.invoke(IPC.LICENSE_GET_API_URL),
    fetchCurrent: () => ipcRenderer.invoke(IPC.LICENSE_FETCH_CURRENT),
    getDiagnostics: () => ipcRenderer.invoke(IPC.LICENSE_GET_DIAGNOSTICS),
    exportDiagnostics: () => ipcRenderer.invoke(IPC.LICENSE_EXPORT_DIAGNOSTICS),
    clearValidationHistory: () => ipcRenderer.invoke(IPC.LICENSE_CLEAR_VALIDATION_HISTORY),
    // Upgrade polling methods
    startUpgradePolling: () => ipcRenderer.invoke(IPC.LICENSE_START_UPGRADE_POLLING),
    stopUpgradePolling: () => ipcRenderer.invoke(IPC.LICENSE_STOP_UPGRADE_POLLING),
    getUpgradePollingStatus: () =>
      ipcRenderer.invoke(IPC.LICENSE_GET_UPGRADE_POLLING_STATUS) as Promise<UpgradePollingStatus>,
    onUpgradePollingStatusChanged: (cb: (status: UpgradePollingStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpgradePollingStatus) =>
        cb(status);
      ipcRenderer.on(IPC.EVT_LICENSE_UPGRADE_POLLING_STATUS, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_LICENSE_UPGRADE_POLLING_STATUS, handler);
      };
    },
    onUpgradeSuccess: (cb: (license: LicensePayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, license: LicensePayload) => cb(license);
      ipcRenderer.on(IPC.EVT_LICENSE_UPGRADE_SUCCESS, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_LICENSE_UPGRADE_SUCCESS, handler);
      };
    },
    onChanged: (cb: (payload: LicensePayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: LicensePayload) => cb(payload);
      ipcRenderer.on(IPC.EVT_LICENSE_CHANGED, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_LICENSE_CHANGED, handler);
      };
    },
    onFeaturesChanged: (cb: (features: string[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, features: string[]) => cb(features);
      ipcRenderer.on(IPC.EVT_LICENSE_FEATURES_CHANGED, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_LICENSE_FEATURES_CHANGED, handler);
      };
    },
    onValidated: (cb: (event: LicenseValidatedEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: LicenseValidatedEvent) =>
        cb(payload);
      ipcRenderer.on(IPC.EVT_LICENSE_VALIDATED, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_LICENSE_VALIDATED, handler);
      };
    },
    onExpired: (cb: (event: LicenseExpiredEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: LicenseExpiredEvent) =>
        cb(payload);
      ipcRenderer.on(IPC.EVT_LICENSE_EXPIRED, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_LICENSE_EXPIRED, handler);
      };
    },
    onWarning: (cb: (warning: LicenseWarning) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: LicenseWarning) => cb(payload);
      ipcRenderer.on(IPC.EVT_LICENSE_WARNING, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_LICENSE_WARNING, handler);
      };
    },
    // Activation for na- (Notely AI) licenses
    activate: (licenseKey: string, email: string) =>
      ipcRenderer.invoke(IPC.LICENSE_ACTIVATE, { licenseKey, email }),
    isActivated: () => ipcRenderer.invoke(IPC.LICENSE_IS_ACTIVATED),
    getActivationDetails: () => ipcRenderer.invoke(IPC.LICENSE_GET_ACTIVATION_DETAILS),
    revalidateActivation: () => ipcRenderer.invoke(IPC.LICENSE_REVALIDATE_ACTIVATION),
    deactivate: () => ipcRenderer.invoke(IPC.LICENSE_DEACTIVATE),
  },
  heartbeat: {
    getStatus: () => ipcRenderer.invoke(IPC.HEARTBEAT_GET_STATUS),
    onLimitExceeded: (cb: (event: HeartbeatLimitExceeded) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: HeartbeatLimitExceeded) =>
        cb(payload);
      ipcRenderer.on(IPC.EVT_HEARTBEAT_LIMIT_EXCEEDED, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_HEARTBEAT_LIMIT_EXCEEDED, handler);
      };
    },
  },
  update: {
    check: (force?: boolean) => ipcRenderer.invoke(IPC.UPDATE_CHECK, force),
    getCached: () => ipcRenderer.invoke(IPC.UPDATE_GET_CACHED),
    openDownload: () => ipcRenderer.invoke(IPC.UPDATE_OPEN_DOWNLOAD),
    dismiss: (version: string) => ipcRenderer.invoke(IPC.UPDATE_DISMISS, version),
    isDismissed: (version: string) => ipcRenderer.invoke(IPC.UPDATE_IS_DISMISSED, version),
    getVersion: () => ipcRenderer.invoke(IPC.UPDATE_GET_VERSION),
    // New download methods
    startDownload: () => ipcRenderer.invoke(IPC.UPDATE_START_DOWNLOAD),
    getDownloadStatus: () => ipcRenderer.invoke(IPC.UPDATE_GET_DOWNLOAD_STATUS),
    isDownloadReady: () => ipcRenderer.invoke(IPC.UPDATE_IS_DOWNLOAD_READY),
    installAndRestart: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL_AND_RESTART),
    cancelDownload: () => ipcRenderer.invoke(IPC.UPDATE_CANCEL_DOWNLOAD),
    resetDownload: () => ipcRenderer.invoke(IPC.UPDATE_RESET_DOWNLOAD),
    // Events
    onAvailable: (cb: (info: UpdateInfo) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: UpdateInfo) => cb(info);
      ipcRenderer.on(IPC.EVT_UPDATE_AVAILABLE, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_UPDATE_AVAILABLE, handler);
      };
    },
    onDismissed: (cb: (version: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, version: string) => cb(version);
      ipcRenderer.on(IPC.EVT_UPDATE_DISMISSED, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_UPDATE_DISMISSED, handler);
      };
    },
    onDownloadStarted: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.EVT_UPDATE_DOWNLOAD_STARTED, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_UPDATE_DOWNLOAD_STARTED, handler);
      };
    },
    onDownloadProgress: (cb: (progress: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: number) => cb(progress);
      ipcRenderer.on(IPC.EVT_UPDATE_DOWNLOAD_PROGRESS, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_UPDATE_DOWNLOAD_PROGRESS, handler);
      };
    },
    onDownloadComplete: (cb: (downloadPath: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, downloadPath: string) => cb(downloadPath);
      ipcRenderer.on(IPC.EVT_UPDATE_DOWNLOAD_COMPLETE, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_UPDATE_DOWNLOAD_COMPLETE, handler);
      };
    },
    onDownloadError: (cb: (error: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: string) => cb(error);
      ipcRenderer.on(IPC.EVT_UPDATE_DOWNLOAD_ERROR, handler);
      return () => {
        ipcRenderer.removeListener(IPC.EVT_UPDATE_DOWNLOAD_ERROR, handler);
      };
    },
  },
  sync: {
    // Sync is now managed by SyncLifecycleManager state machine
    // Manual sync triggers go through sync:push which uses the state machine
    push: () => ipcRenderer.invoke(IPC.SYNC_PUSH),
    getStatus: () => ipcRenderer.invoke(IPC.SYNC_GET_STATUS),
    getHealthMetrics: () => ipcRenderer.invoke(IPC.SYNC_GET_HEALTH_METRICS),
    getHealthStatus: () => ipcRenderer.invoke(IPC.SYNC_GET_HEALTH_STATUS),
    getServerStats: () => ipcRenderer.invoke(IPC.SYNC_GET_SERVER_STATS),
  },
  auth: {
    beginMicrosoftLogin: () => ipcRenderer.invoke(IPC.AUTH_BEGIN_MICROSOFT_LOGIN),
    passwordLogin: (email: string, password: string) =>
      ipcRenderer.invoke(IPC.AUTH_PASSWORD_LOGIN, email, password),
    startWebLogin: () => ipcRenderer.invoke(IPC.AUTH_START_WEB_LOGIN),
    linkAccount: () => ipcRenderer.invoke(IPC.AUTH_LINK_ACCOUNT),
    logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),
    getStatus: () => ipcRenderer.invoke(IPC.AUTH_GET_STATUS),
  },
  // Expose Sync API for direct usage by renderer
  syncV2: {
    getStatus: () => ipcRenderer.invoke(IPC.SYNC_V2_GET_STATUS),
    performSync: () => ipcRenderer.invoke(IPC.SYNC_V2_PERFORM_SYNC),
    resetRetryState: () => ipcRenderer.invoke(IPC.SYNC_V2_RESET_RETRY_STATE),
    getConflicts: () => ipcRenderer.invoke(IPC.SYNC_V2_GET_CONFLICTS),
    clearConflicts: () => ipcRenderer.invoke(IPC.SYNC_V2_CLEAR_CONFLICTS),
    recomputeTree: () => ipcRenderer.invoke(IPC.SYNC_V2_RECOMPUTE_TREE),
    getMemoryStats: () => ipcRenderer.invoke(IPC.SYNC_V2_GET_MEMORY_STATS),
    cleanupMemory: () => ipcRenderer.invoke(IPC.SYNC_V2_CLEANUP_MEMORY),
  },
  onSettingsChanged: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, p: { key: string; value: string }) =>
      cb(p.key, p.value);
    ipcRenderer.on(IPC.EVT_SETTINGS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_SETTINGS_CHANGED, handler);
  },
  onSettingsHydrate: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, rows: Array<{ key: string; value: string }>) =>
      cb(rows);
    ipcRenderer.on(IPC.EVT_SETTINGS_HYDRATE, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_SETTINGS_HYDRATE, handler);
  },
  onNotesChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.EVT_NOTES_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_NOTES_CHANGED, handler);
  },
  onSummaryNotification: (
    cb: (notification: {
      id: string;
      type: 'summary-started' | 'summary-completed' | 'summary-failed';
      title: string;
      message: string;
      jobId?: string;
      summaryId?: string;
      transcriptionId?: string;
      timestamp: Date;
    }) => void
  ) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      notification: {
        id: string;
        type: 'summary-started' | 'summary-completed' | 'summary-failed';
        title: string;
        message: string;
        jobId?: string;
        summaryId?: string;
        transcriptionId?: string;
        timestamp: Date;
      }
    ) => cb(notification);
    ipcRenderer.on(IPC.EVT_SUMMARY_NOTIFICATION, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_SUMMARY_NOTIFICATION, handler);
  },
  onSummaryProgress: (
    cb: (progress: {
      jobId: string;
      transcriptionId: string;
      progress?: number;
      currentStep?: string;
      timestamp: Date;
    }) => void
  ) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      progress: {
        jobId: string;
        transcriptionId: string;
        progress?: number;
        currentStep?: string;
        timestamp: Date;
      }
    ) => cb(progress);
    ipcRenderer.on(IPC.EVT_SUMMARY_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_SUMMARY_PROGRESS, handler);
  },
  onNavigateToTranscription: (
    cb: (data: { transcriptionId: string; highlightSummary?: boolean }) => void
  ) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      data: { transcriptionId: string; highlightSummary?: boolean }
    ) => cb(data);
    ipcRenderer.on(IPC.EVT_NAVIGATE_TO_TRANSCRIPTION, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_NAVIGATE_TO_TRANSCRIPTION, handler);
  },
  onProfileChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.EVT_PROFILE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_PROFILE_CHANGED, handler);
  },
  // Sync event bridges
  onSyncStart: (cb: (data: object) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: object) => cb(data || {});
    ipcRenderer.on(IPC.EVT_SYNC_START, handler);
    // eslint-disable-next-line no-console
    console.info('[SYNC] preload: onSyncStart handler registered');
    return () => ipcRenderer.removeListener(IPC.EVT_SYNC_START, handler);
  },
  onSyncProgress: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(IPC.EVT_SYNC_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_SYNC_PROGRESS, handler);
  },
  onSyncComplete: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(IPC.EVT_SYNC_COMPLETE, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_SYNC_COMPLETE, handler);
  },
  onSyncError: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(IPC.EVT_SYNC_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_SYNC_ERROR, handler);
  },
  // Optional: conflict channel if emitted by main
  onSyncConflict: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(IPC.EVT_SYNC_CONFLICT, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_SYNC_CONFLICT, handler);
  },
  // System audio capture for transcribing meeting participants
  systemAudio: {
    isSupported: () => ipcRenderer.invoke(IPC.SYSTEM_AUDIO_IS_SUPPORTED),
    getInitError: () => ipcRenderer.invoke(IPC.SYSTEM_AUDIO_GET_INIT_ERROR),
    getLoopbackStream: async () => {
      // getLoopbackAudioMediaStream runs in renderer process per package docs
      const { getLoopbackAudioMediaStream } = await import('electron-audio-loopback');
      return getLoopbackAudioMediaStream();
    },
  },
  // Tags management
  tags: {
    create: (input: { name: string; color?: string }) => ipcRenderer.invoke(IPC.TAGS_CREATE, input),
    list: () => ipcRenderer.invoke(IPC.TAGS_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.TAGS_GET, { id }),
    update: (input: { id: string; name?: string; color?: string | null }) =>
      ipcRenderer.invoke(IPC.TAGS_UPDATE, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.TAGS_DELETE, { id }),
    reorder: (ids: string[]) => ipcRenderer.invoke(IPC.TAGS_REORDER, { ids }),
    addToNote: (noteId: string, tagId: string) =>
      ipcRenderer.invoke(IPC.TAGS_ADD_TO_NOTE, { noteId, tagId }),
    removeFromNote: (noteId: string, tagId: string) =>
      ipcRenderer.invoke(IPC.TAGS_REMOVE_FROM_NOTE, { noteId, tagId }),
    setNoteTags: (noteId: string, tagIds: string[]) =>
      ipcRenderer.invoke(IPC.TAGS_SET_NOTE_TAGS, { noteId, tagIds }),
    getByNote: (noteId: string) => ipcRenderer.invoke(IPC.TAGS_GET_BY_NOTE, { noteId }),
    getNotesByTag: (tagId: string) => ipcRenderer.invoke(IPC.TAGS_GET_NOTES_BY_TAG, { tagId }),
  },
  onTagsChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.EVT_TAGS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_TAGS_CHANGED, handler);
  },
  onNoteTagsChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.EVT_NOTE_TAGS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.EVT_NOTE_TAGS_CHANGED, handler);
  },
  // Security / Password Protection
  security: {
    getPasswordStatus: () => ipcRenderer.invoke(IPC.SECURITY_GET_PASSWORD_STATUS),
    enablePassword: (input: { password: string; confirmPassword: string }) =>
      ipcRenderer.invoke(IPC.SECURITY_ENABLE_PASSWORD, input),
    disablePassword: (input: { password: string }) =>
      ipcRenderer.invoke(IPC.SECURITY_DISABLE_PASSWORD, input),
    verifyPassword: (input: { password: string; remember?: boolean }) =>
      ipcRenderer.invoke(IPC.SECURITY_VERIFY_PASSWORD, input),
    changePassword: (input: {
      currentPassword: string;
      newPassword: string;
      confirmPassword: string;
    }) => ipcRenderer.invoke(IPC.SECURITY_CHANGE_PASSWORD, input),
    lock: () => ipcRenderer.invoke(IPC.SECURITY_LOCK),
    clearRemember: () => ipcRenderer.invoke(IPC.SECURITY_CLEAR_REMEMBER),
    exportRecoveryKey: () => ipcRenderer.invoke(IPC.SECURITY_EXPORT_RECOVERY_KEY),
    importRecoveryKey: (input: { recoveryKey: string }) =>
      ipcRenderer.invoke(IPC.SECURITY_IMPORT_RECOVERY_KEY, input),
    markRecoveryKeyShown: () => ipcRenderer.invoke(IPC.SECURITY_MARK_RECOVERY_KEY_SHOWN),
    resetPasswordWithRecoveryKey: (input: {
      recoveryKey: string;
      newPassword: string;
      confirmPassword: string;
    }) => ipcRenderer.invoke(IPC.SECURITY_RESET_WITH_RECOVERY, input),
    onStatusChanged: (
      cb: (status: {
        enabled: boolean;
        locked: boolean;
        rememberActive: boolean;
        rememberUntil: string | null;
        recoveryKeyShown: boolean;
        passwordChangedAt: string | null;
      }) => void
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        status: {
          enabled: boolean;
          locked: boolean;
          rememberActive: boolean;
          rememberUntil: string | null;
          recoveryKeyShown: boolean;
          passwordChangedAt: string | null;
        }
      ) => cb(status);
      ipcRenderer.on(IPC.EVT_SECURITY_STATUS_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_SECURITY_STATUS_CHANGED, handler);
    },
  },
  // Note export functionality
  export: {
    note: (noteId: string, format: 'txt' | 'md' | 'docx' | 'rtf' | 'pdf') =>
      ipcRenderer.invoke(IPC.EXPORT_NOTE, { noteId, format }),
  },
  // Component download functionality
  components: {
    checkAll: (): Promise<ComponentInfo[]> => ipcRenderer.invoke(IPC.COMPONENTS_CHECK_ALL),
    download: (componentId: string): Promise<DownloadResult> =>
      ipcRenderer.invoke(IPC.COMPONENTS_DOWNLOAD, componentId),
    downloadAll: (): Promise<{ success: boolean; results: DownloadResult[] }> =>
      ipcRenderer.invoke(IPC.COMPONENTS_DOWNLOAD_ALL),
    cancelDownload: (): Promise<void> => ipcRenderer.invoke(IPC.COMPONENTS_CANCEL_DOWNLOAD),
    verify: (componentId: string): Promise<VerificationResult> =>
      ipcRenderer.invoke(IPC.COMPONENTS_VERIFY, componentId),
    repair: (componentId: string): Promise<DownloadResult> =>
      ipcRenderer.invoke(IPC.COMPONENTS_REPAIR, componentId),
    getInfo: (componentId: string): Promise<ComponentInfo> =>
      ipcRenderer.invoke(IPC.COMPONENTS_GET_INFO, componentId),
    areAllReady: (): Promise<boolean> => ipcRenderer.invoke(IPC.COMPONENTS_ARE_ALL_READY),
    onStatusChanged: (cb: (info: ComponentInfo) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: ComponentInfo) => cb(info);
      ipcRenderer.on(IPC.EVT_COMPONENTS_STATUS_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_COMPONENTS_STATUS_CHANGED, handler);
    },
    onDownloadProgress: (cb: (progress: DownloadProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: DownloadProgress) =>
        cb(progress);
      ipcRenderer.on(IPC.EVT_COMPONENTS_DOWNLOAD_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_COMPONENTS_DOWNLOAD_PROGRESS, handler);
    },
    onDownloadComplete: (cb: (componentId: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, componentId: string) => cb(componentId);
      ipcRenderer.on(IPC.EVT_COMPONENTS_DOWNLOAD_COMPLETE, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_COMPONENTS_DOWNLOAD_COMPLETE, handler);
    },
    onDownloadError: (cb: (data: { componentId: string; error: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { componentId: string; error: string }
      ) => cb(data);
      ipcRenderer.on(IPC.EVT_COMPONENTS_DOWNLOAD_ERROR, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_COMPONENTS_DOWNLOAD_ERROR, handler);
    },
    onAllReady: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.EVT_COMPONENTS_ALL_READY, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_COMPONENTS_ALL_READY, handler);
    },
    getSetupStatus: (): Promise<SetupStatusEvent | null> =>
      ipcRenderer.invoke(IPC.COMPONENTS_GET_SETUP_STATUS),
    setupRetryComplete: (): Promise<void> =>
      ipcRenderer.invoke(IPC.COMPONENTS_SETUP_RETRY_COMPLETE),
    onSetupStatus: (cb: (status: SetupStatusEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: SetupStatusEvent) => cb(status);
      ipcRenderer.on(IPC.EVT_COMPONENTS_SETUP_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_COMPONENTS_SETUP_STATUS, handler);
    },
  },
  // Local LLM functionality (Standalone Edition)
  llm: {
    // Status and lifecycle
    getStatus: () => ipcRenderer.invoke(IPC.LLM_GET_STATUS),
    loadModel: (input: { modelId: string; nGpuLayers?: number; nCtx?: number }) =>
      ipcRenderer.invoke(IPC.LLM_LOAD_MODEL, input),
    unloadModel: () => ipcRenderer.invoke(IPC.LLM_UNLOAD_MODEL),
    getLoadedModel: () => ipcRenderer.invoke(IPC.LLM_GET_LOADED_MODEL),
    // Model catalog
    getAvailableModels: () => ipcRenderer.invoke(IPC.LLM_GET_AVAILABLE_MODELS),
    getDownloadedModels: () => ipcRenderer.invoke(IPC.LLM_GET_DOWNLOADED_MODELS),
    downloadModel: (input: { modelId: string; hfToken?: string }) =>
      ipcRenderer.invoke(IPC.LLM_DOWNLOAD_MODEL, input),
    deleteModel: (input: { modelId: string }) => ipcRenderer.invoke(IPC.LLM_DELETE_MODEL, input),
    cancelDownload: (input: { modelId: string }) =>
      ipcRenderer.invoke(IPC.LLM_CANCEL_DOWNLOAD, input),
    // Inference
    generateSummary: (input: {
      transcriptionId: string;
      text: string;
      analysisType?: string;
      skipRefinement?: boolean;
    }) => ipcRenderer.invoke(IPC.LLM_GENERATE_SUMMARY, input),
    // GPU
    getGPUInfo: () => ipcRenderer.invoke(IPC.LLM_GET_GPU_INFO),
    getRecommendedModels: () => ipcRenderer.invoke(IPC.LLM_GET_RECOMMENDED_MODELS),
    // Settings
    getModelParameters: () => ipcRenderer.invoke(IPC.LLM_GET_MODEL_PARAMETERS),
    setModelParameters: (input: {
      temperatureExtract?: number;
      temperatureRefine?: number;
      maxTokens?: number;
      topP?: number;
      contextWindow?: number;
      nGpuLayers?: number;
    }) => ipcRenderer.invoke(IPC.LLM_SET_MODEL_PARAMETERS, input),
    getDefaultModel: () => ipcRenderer.invoke(IPC.LLM_GET_DEFAULT_MODEL),
    setDefaultModel: (modelId: string) => ipcRenderer.invoke(IPC.LLM_SET_DEFAULT_MODEL, modelId),
    // HuggingFace
    setHuggingFaceToken: (input: { token: string }) =>
      ipcRenderer.invoke(IPC.LLM_SET_HF_TOKEN, input),
    getHuggingFaceToken: () => ipcRenderer.invoke(IPC.LLM_GET_HF_TOKEN),
    validateHuggingFaceToken: () => ipcRenderer.invoke(IPC.LLM_VALIDATE_HF_TOKEN),
    clearHuggingFaceToken: () => ipcRenderer.invoke(IPC.LLM_CLEAR_HF_TOKEN),
    hasHuggingFaceToken: () => ipcRenderer.invoke(IPC.LLM_HAS_HF_TOKEN),
    // Prompts
    getPrompts: () => ipcRenderer.invoke(IPC.LLM_GET_PROMPTS),
    setPrompts: (input: { systemPrompt?: string; structure?: Record<string, unknown> }) =>
      ipcRenderer.invoke(IPC.LLM_SET_PROMPTS, input),
    resetPrompts: () => ipcRenderer.invoke(IPC.LLM_RESET_PROMPTS),
    // Server management
    startServer: () => ipcRenderer.invoke(IPC.LLM_START_SERVER),
    stopServer: () => ipcRenderer.invoke(IPC.LLM_STOP_SERVER),
    restartServer: () => ipcRenderer.invoke(IPC.LLM_RESTART_SERVER),
    // Custom model management
    getDiskUsage: () => ipcRenderer.invoke(IPC.LLM_GET_DISK_USAGE),
    parseHuggingFaceUrl: (input: { url: string }) =>
      ipcRenderer.invoke(IPC.LLM_PARSE_HF_URL, input),
    downloadCustomModel: (input: {
      url: string;
      filename: string;
      modelId: string;
      repo?: string;
      name?: string;
    }) => ipcRenderer.invoke(IPC.LLM_DOWNLOAD_CUSTOM_MODEL, input),
    removeCustomModel: (input: { modelId: string }) =>
      ipcRenderer.invoke(IPC.LLM_REMOVE_CUSTOM_MODEL, input),
    validateCatalogUrls: (input?: { modelIds?: string[] }) =>
      ipcRenderer.invoke(IPC.LLM_VALIDATE_CATALOG_URLS, input),
    openModelsDirectory: () => ipcRenderer.invoke(IPC.LLM_OPEN_MODELS_DIRECTORY),
    refreshModels: () => ipcRenderer.invoke(IPC.LLM_REFRESH_MODELS),
    // Event listeners
    onDownloadProgress: (
      cb: (progress: {
        modelId: string;
        bytesDownloaded: number;
        totalBytes: number;
        percentage: number;
        speed: number;
        eta: number;
        resumable: boolean;
      }) => void
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: {
          modelId: string;
          bytesDownloaded: number;
          totalBytes: number;
          percentage: number;
          speed: number;
          eta: number;
          resumable: boolean;
        }
      ) => cb(progress);
      ipcRenderer.on(IPC.EVT_LLM_DOWNLOAD_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_LLM_DOWNLOAD_PROGRESS, handler);
    },
    onDownloadStarted: (cb: (data: { modelId: string; totalBytes: number }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { modelId: string; totalBytes: number }
      ) => cb(data);
      ipcRenderer.on(IPC.EVT_LLM_DOWNLOAD_STARTED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_LLM_DOWNLOAD_STARTED, handler);
    },
    onDownloadCompleted: (cb: (data: { modelId: string; path: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { modelId: string; path: string }
      ) => cb(data);
      ipcRenderer.on(IPC.EVT_LLM_DOWNLOAD_COMPLETED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_LLM_DOWNLOAD_COMPLETED, handler);
    },
    onDownloadFailed: (cb: (data: { modelId: string; error: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { modelId: string; error: string }
      ) => cb(data);
      ipcRenderer.on(IPC.EVT_LLM_DOWNLOAD_FAILED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_LLM_DOWNLOAD_FAILED, handler);
    },
    onDownloadCancelled: (cb: (data: { modelId: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { modelId: string }) => cb(data);
      ipcRenderer.on(IPC.EVT_LLM_DOWNLOAD_CANCELLED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_LLM_DOWNLOAD_CANCELLED, handler);
    },
    onModelLoaded: (cb: (data: { modelPath: string; loadTimeSeconds: number }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { modelPath: string; loadTimeSeconds: number }
      ) => cb(data);
      ipcRenderer.on(IPC.EVT_LLM_MODEL_LOADED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_LLM_MODEL_LOADED, handler);
    },
    onModelUnloaded: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.EVT_LLM_MODEL_UNLOADED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_LLM_MODEL_UNLOADED, handler);
    },
    onGenerationStarted: (cb: (data: { textLength: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { textLength: number }) => cb(data);
      ipcRenderer.on(IPC.EVT_LLM_GENERATION_STARTED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_LLM_GENERATION_STARTED, handler);
    },
    onGenerationCompleted: (cb: (data: { timeSeconds: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { timeSeconds: number }) =>
        cb(data);
      ipcRenderer.on(IPC.EVT_LLM_GENERATION_COMPLETED, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_LLM_GENERATION_COMPLETED, handler);
    },
    onError: (cb: (data: { error: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { error: string }) => cb(data);
      ipcRenderer.on(IPC.EVT_LLM_ERROR, handler);
      return () => ipcRenderer.removeListener(IPC.EVT_LLM_ERROR, handler);
    },
  },
  // GPU detection (Standalone Edition)
  gpu: {
    detect: () => ipcRenderer.invoke(IPC.LLM_GET_GPU_INFO),
    getCapabilities: () => ipcRenderer.invoke(IPC.LLM_GET_GPU_INFO),
    getRecommendedModels: () => ipcRenderer.invoke(IPC.LLM_GET_RECOMMENDED_MODELS),
  },
  // Prompt templates
  promptTemplates: {
    list: () => ipcRenderer.invoke(IPC.PROMPT_TEMPLATES_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.PROMPT_TEMPLATES_GET, { id }),
    create: (input: {
      name: string;
      systemPrompt?: string;
      outputStructure?: string;
      cloneFromId?: string;
    }) => ipcRenderer.invoke(IPC.PROMPT_TEMPLATES_CREATE, input),
    update: (input: {
      id: string;
      name?: string;
      systemPrompt?: string;
      outputStructure?: string;
    }) => ipcRenderer.invoke(IPC.PROMPT_TEMPLATES_UPDATE, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.PROMPT_TEMPLATES_DELETE, { id }),
    getActive: () => ipcRenderer.invoke(IPC.PROMPT_TEMPLATES_GET_ACTIVE),
    setActive: (id: string) => ipcRenderer.invoke(IPC.PROMPT_TEMPLATES_SET_ACTIVE, { id }),
  },
  // Diagnostics
  diagnostics: {
    export: () =>
      ipcRenderer.invoke(IPC.DIAGNOSTICS_EXPORT) as Promise<{
        success: boolean;
        path?: string;
        error?: string;
      }>,
  },
  // Native menu events (macOS)
  menu: {
    onNavigate: (cb: (route: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, route: string) => cb(route);
      ipcRenderer.on(IPC.MENU_NAVIGATE, handler);
      return () => ipcRenderer.removeListener(IPC.MENU_NAVIGATE, handler);
    },
    onOpenTranscriptions: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.MENU_OPEN_TRANSCRIPTIONS, handler);
      return () => ipcRenderer.removeListener(IPC.MENU_OPEN_TRANSCRIPTIONS, handler);
    },
    onExport: (cb: (format: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, format: string) => cb(format);
      ipcRenderer.on(IPC.MENU_EXPORT, handler);
      return () => ipcRenderer.removeListener(IPC.MENU_EXPORT, handler);
    },
    onFontZoomIn: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.MENU_FONT_ZOOM_IN, handler);
      return () => ipcRenderer.removeListener(IPC.MENU_FONT_ZOOM_IN, handler);
    },
    onFontZoomOut: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.MENU_FONT_ZOOM_OUT, handler);
      return () => ipcRenderer.removeListener(IPC.MENU_FONT_ZOOM_OUT, handler);
    },
    onFontZoomReset: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.MENU_FONT_ZOOM_RESET, handler);
      return () => ipcRenderer.removeListener(IPC.MENU_FONT_ZOOM_RESET, handler);
    },
    onNewNote: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.MENU_NEW_NOTE, handler);
      return () => ipcRenderer.removeListener(IPC.MENU_NEW_NOTE, handler);
    },
    updateState: (state: { noteId: string | null }) =>
      ipcRenderer.send(IPC.MENU_UPDATE_STATE, state),
  },
};

contextBridge.exposeInMainWorld('api', api);
export type { Api as PreloadApi };
