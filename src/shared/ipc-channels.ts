/**
 * Non-semantic IPC channel identifiers.
 *
 * Both the preload bridge and main-process handlers import from this
 * single source of truth, so a mismatch is caught at compile time.
 *
 * Naming convention: <category-prefix>:<short-hash>
 *   s  = storage      se = settings     u  = user
 *   t  = transcription sm = summary      c  = calendar
 *   l  = license      hb = heartbeat    up = update
 *   a  = auth         w  = window       lg = log
 *   mr = meetingReminder  sy = sync      sa = systemAudio
 *   tg = tags         sc = security     ex = export
 *   cp = components   lm = llm          pt = promptTemplates
 *   g  = gpu          ev = events (renderer push-events)
 *   d  = diagnostics  m  = menu
 */

export const IPC = {
  // ── Storage ───────────────────────────────────────────────────────
  STORAGE_CREATE_NOTE: 's:0a',
  STORAGE_SAVE_NOTE: 's:0b',
  STORAGE_GET_NOTE: 's:0c',
  STORAGE_LIST_NOTES_BY_BINDER: 's:0d',
  STORAGE_LIST_UNASSIGNED_NOTES: 's:0e',
  STORAGE_LIST_ALL_NOTES: 's:0f',
  STORAGE_LIST_NOTES_BY_CREATED: 's:0g',
  STORAGE_LIST_DELETED_NOTES: 's:0h',
  STORAGE_EMPTY_TRASH: 's:0i',
  STORAGE_DELETE_NOTE: 's:0j',
  STORAGE_MOVE_NOTE: 's:0k',
  STORAGE_SET_STARRED: 's:0l',
  STORAGE_LIST_STARRED_NOTES: 's:0m',
  STORAGE_SET_ARCHIVED: 's:0n',
  STORAGE_LIST_ARCHIVED_NOTES: 's:0o',
  STORAGE_SEARCH: 's:0p',
  STORAGE_LIST_BINDERS: 's:0q',
  STORAGE_GET_DEFAULT_BINDER_ID: 's:0r',
  STORAGE_CREATE_BINDER: 's:0s',
  STORAGE_RENAME_BINDER: 's:0t',
  STORAGE_UPDATE_BINDER: 's:0u',
  STORAGE_DELETE_BINDER: 's:0v',
  STORAGE_REORDER_BINDERS: 's:0w',
  STORAGE_LIST_CONFLICTS: 's:1a',
  STORAGE_COUNT_CONFLICTS: 's:1b',
  STORAGE_GET_CONFLICTS_FOR_NOTE: 's:1c',
  STORAGE_GET_NOTES_WITH_CONFLICTS: 's:1d',
  STORAGE_GET_NOTE_WITH_CONFLICT_META: 's:1e',
  STORAGE_RESOLVE_USE_CONFLICT: 's:1f',
  STORAGE_RESOLVE_KEEP_CANONICAL: 's:1g',
  STORAGE_GET_CONFLICTS_BINDER: 's:1h',
  STORAGE_HAS_UNRESOLVED_CONFLICTS: 's:1i',
  STORAGE_LIST_BINDERS_WITH_CONFLICTS: 's:1j',

  // ── Settings ──────────────────────────────────────────────────────
  SETTINGS_GET: 'se:0a',
  SETTINGS_SET: 'se:0b',
  SETTINGS_LIST_BY_PREFIX: 'se:0c',
  SETTINGS_BROADCAST: 'se:0d',

  // ── User ──────────────────────────────────────────────────────────
  USER_GET_PROFILE: 'u:0a',
  USER_SAVE_PROFILE: 'u:0b',

  // ── Transcription ─────────────────────────────────────────────────
  TRANSCRIPTION_START_SESSION: 't:0a',
  TRANSCRIPTION_APPEND_FINAL_TEXT: 't:0b',
  TRANSCRIPTION_COMPLETE_SESSION: 't:0c',
  TRANSCRIPTION_APPLY_REFINEMENT: 't:0d',
  TRANSCRIPTION_LIST_BY_NOTE: 't:0e',
  TRANSCRIPTION_GET: 't:0f',
  TRANSCRIPTION_EXPORT_SESSION: 't:0g',
  TRANSCRIPTION_LIST_MODELS: 't:0h',
  TRANSCRIPTION_RESTART_SERVER: 't:0i',
  TRANSCRIPTION_GET_SERVER_PORT: 't:0j',
  TRANSCRIPTION_SAVE_RECORDING: 't:0k',
  TRANSCRIPTION_GET_RECORDING_PATH: 't:0l',
  TRANSCRIPTION_GET_RECORDING_META: 't:0m',
  TRANSCRIPTION_REFINE: 't:0n',
  TRANSCRIPTION_SAVE_CORRECTION: 't:0o',
  TRANSCRIPTION_SAVE_SEGMENTS: 't:0p',
  TRANSCRIPTION_GET_SEGMENTS: 't:0q',
  TRANSCRIPTION_MARK_SEGMENT_EDITED: 't:0r',
  TRANSCRIPTION_LIST_ALL_WITH_DETAILS: 't:0s',
  TRANSCRIPTION_CREATE_DEV_SESSION: 't:0t',
  TRANSCRIPTION_GET_MODELS_STATUS: 't:0u',
  TRANSCRIPTION_DOWNLOAD_MODEL: 't:0v',
  TRANSCRIPTION_DELETE_MODEL: 't:0w',
  TRANSCRIPTION_SET_DEFAULT_MODEL: 't:0x',
  TRANSCRIPTION_GET_DEFAULT_MODEL: 't:0y',
  TRANSCRIPTION_REPLACE_FULL_TEXT: 't:1b',
  TRANSCRIPTION_GET_SETTINGS: 't:0z',
  TRANSCRIPTION_SET_SETTINGS: 't:1a',

  // ── Summary ───────────────────────────────────────────────────────
  SUMMARY_GENERATE: 'sm:0a',
  SUMMARY_GET: 'sm:0b',
  SUMMARY_GET_BY_TRANSCRIPTION: 'sm:0c',
  SUMMARY_DELETE: 'sm:0d',
  SUMMARY_LIST: 'sm:0e',
  SUMMARY_CHECK_SERVER_EXISTS: 'sm:0f',
  SUMMARY_UPDATE_TEXT: 'sm:0g',

  // ── Calendar ──────────────────────────────────────────────────────
  CALENDAR_GET_STATUS: 'c:0a',
  CALENDAR_LIST_EVENTS: 'c:0b',
  CALENDAR_GET_CONNECT_URL: 'c:0c',
  CALENDAR_START_CONNECT: 'c:0d',
  CALENDAR_DISCONNECT: 'c:0e',

  // ── License ───────────────────────────────────────────────────────
  LICENSE_GET_CURRENT: 'l:0a',
  LICENSE_VALIDATE: 'l:0b',
  LICENSE_CLEAR_CACHE: 'l:0c',
  LICENSE_GET_FEATURES: 'l:0d',
  LICENSE_HAS_FEATURE: 'l:0e',
  LICENSE_MANUAL_CHECK: 'l:0f',
  LICENSE_CHECK_SERVER_HEALTH: 'l:0g',
  LICENSE_SET_API_URL: 'l:0h',
  LICENSE_GET_API_URL: 'l:0i',
  LICENSE_FETCH_CURRENT: 'l:0j',
  LICENSE_GET_DIAGNOSTICS: 'l:0k',
  LICENSE_EXPORT_DIAGNOSTICS: 'l:0l',
  LICENSE_CLEAR_VALIDATION_HISTORY: 'l:0m',
  LICENSE_START_UPGRADE_POLLING: 'l:0n',
  LICENSE_STOP_UPGRADE_POLLING: 'l:0o',
  LICENSE_GET_UPGRADE_POLLING_STATUS: 'l:0p',
  LICENSE_ACTIVATE: 'l:0q',
  LICENSE_IS_ACTIVATED: 'l:0r',
  LICENSE_GET_ACTIVATION_DETAILS: 'l:0s',
  LICENSE_REVALIDATE_ACTIVATION: 'l:0t',
  LICENSE_DEACTIVATE: 'l:0u',

  // ── Heartbeat ─────────────────────────────────────────────────────
  HEARTBEAT_GET_STATUS: 'hb:0a',

  // ── Update ────────────────────────────────────────────────────────
  UPDATE_CHECK: 'up:0a',
  UPDATE_GET_CACHED: 'up:0b',
  UPDATE_OPEN_DOWNLOAD: 'up:0c',
  UPDATE_DISMISS: 'up:0d',
  UPDATE_IS_DISMISSED: 'up:0e',
  UPDATE_GET_VERSION: 'up:0f',
  UPDATE_START_DOWNLOAD: 'up:0g',
  UPDATE_GET_DOWNLOAD_STATUS: 'up:0h',
  UPDATE_IS_DOWNLOAD_READY: 'up:0i',
  UPDATE_INSTALL_AND_RESTART: 'up:0j',
  UPDATE_CANCEL_DOWNLOAD: 'up:0k',
  UPDATE_RESET_DOWNLOAD: 'up:0l',

  // ── Auth ──────────────────────────────────────────────────────────
  AUTH_BEGIN_MICROSOFT_LOGIN: 'a:0a',
  AUTH_PASSWORD_LOGIN: 'a:0b',
  AUTH_START_WEB_LOGIN: 'a:0c',
  AUTH_LINK_ACCOUNT: 'a:0d',
  AUTH_LOGOUT: 'a:0e',
  AUTH_GET_STATUS: 'a:0f',

  // ── Window / App ──────────────────────────────────────────────────
  WINDOW_CONTROL: 'w:0a',
  WINDOW_OPEN_EXTERNAL: 'w:0b',
  WINDOW_SET_TITLEBAR_OVERLAY: 'w:0c',
  APP_GET_VERSION: 'w:0d',
  APP_IS_DEVELOPMENT: 'w:0e',
  RENDERER_READY: 'w:0f',

  // ── Log ───────────────────────────────────────────────────────────
  LOG_SET_LEVEL: 'lg:0a',
  LOG_INFO: 'lg:0b',
  LOG_WARN: 'lg:0c',
  LOG_ERROR: 'lg:0d',
  LOG_DEBUG: 'lg:0e',

  // ── Meeting Reminder ──────────────────────────────────────────────
  MEETING_REMINDER_GET_STATE: 'mr:0a',
  MEETING_REMINDER_SET_ENABLED: 'mr:0b',
  MEETING_REMINDER_SET_MUTE_UNTIL: 'mr:0c',
  MEETING_REMINDER_CLEAR_MUTE: 'mr:0d',
  MEETING_REMINDER_SNOOZE: 'mr:0e',
  MEETING_REMINDER_CLEAR_SNOOZE: 'mr:0f',
  MEETING_REMINDER_REFRESH: 'mr:0g',
  MEETING_REMINDER_DISMISS: 'mr:0h',
  MEETING_REMINDER_TEST_TRIGGER: 'mr:0i',
  MEETING_REMINDER_START_RECORDING: 'mr:0j',

  // ── Sync ──────────────────────────────────────────────────────────
  SYNC_PUSH: 'sy:0a',
  SYNC_GET_STATUS: 'sy:0b',
  SYNC_GET_HEALTH_METRICS: 'sy:0c',
  SYNC_GET_HEALTH_STATUS: 'sy:0d',
  SYNC_GET_SERVER_STATS: 'sy:0e',
  SYNC_V2_GET_STATUS: 'sy:1a',
  SYNC_V2_PERFORM_SYNC: 'sy:1b',
  SYNC_V2_RESET_RETRY_STATE: 'sy:1c',
  SYNC_V2_GET_CONFLICTS: 'sy:1d',
  SYNC_V2_CLEAR_CONFLICTS: 'sy:1e',
  SYNC_V2_RECOMPUTE_TREE: 'sy:1f',
  SYNC_V2_GET_MEMORY_STATS: 'sy:1g',
  SYNC_V2_CLEANUP_MEMORY: 'sy:1h',

  // ── System Audio ──────────────────────────────────────────────────
  SYSTEM_AUDIO_IS_SUPPORTED: 'sa:0a',
  SYSTEM_AUDIO_GET_INIT_ERROR: 'sa:0b',

  // ── Tags ──────────────────────────────────────────────────────────
  TAGS_CREATE: 'tg:0a',
  TAGS_LIST: 'tg:0b',
  TAGS_GET: 'tg:0c',
  TAGS_UPDATE: 'tg:0d',
  TAGS_DELETE: 'tg:0e',
  TAGS_REORDER: 'tg:0f',
  TAGS_ADD_TO_NOTE: 'tg:0g',
  TAGS_REMOVE_FROM_NOTE: 'tg:0h',
  TAGS_SET_NOTE_TAGS: 'tg:0i',
  TAGS_GET_BY_NOTE: 'tg:0j',
  TAGS_GET_NOTES_BY_TAG: 'tg:0k',

  // ── Security ──────────────────────────────────────────────────────
  SECURITY_GET_PASSWORD_STATUS: 'sc:0a',
  SECURITY_ENABLE_PASSWORD: 'sc:0b',
  SECURITY_DISABLE_PASSWORD: 'sc:0c',
  SECURITY_VERIFY_PASSWORD: 'sc:0d',
  SECURITY_CHANGE_PASSWORD: 'sc:0e',
  SECURITY_LOCK: 'sc:0f',
  SECURITY_CLEAR_REMEMBER: 'sc:0g',
  SECURITY_EXPORT_RECOVERY_KEY: 'sc:0h',
  SECURITY_IMPORT_RECOVERY_KEY: 'sc:0i',
  SECURITY_MARK_RECOVERY_KEY_SHOWN: 'sc:0j',
  SECURITY_RESET_WITH_RECOVERY: 'sc:0k',

  // ── Export ────────────────────────────────────────────────────────
  EXPORT_NOTE: 'ex:0a',

  // ── Components ────────────────────────────────────────────────────
  COMPONENTS_CHECK_ALL: 'cp:0a',
  COMPONENTS_DOWNLOAD: 'cp:0b',
  COMPONENTS_DOWNLOAD_ALL: 'cp:0c',
  COMPONENTS_CANCEL_DOWNLOAD: 'cp:0d',
  COMPONENTS_VERIFY: 'cp:0e',
  COMPONENTS_REPAIR: 'cp:0f',
  COMPONENTS_GET_INFO: 'cp:0g',
  COMPONENTS_ARE_ALL_READY: 'cp:0h',
  COMPONENTS_GET_SETUP_STATUS: 'cp:0i',
  COMPONENTS_SETUP_RETRY_COMPLETE: 'cp:0j',

  // ── LLM ───────────────────────────────────────────────────────────
  LLM_GET_STATUS: 'lm:0a',
  LLM_LOAD_MODEL: 'lm:0b',
  LLM_UNLOAD_MODEL: 'lm:0c',
  LLM_GET_LOADED_MODEL: 'lm:0d',
  LLM_GET_AVAILABLE_MODELS: 'lm:0e',
  LLM_GET_DOWNLOADED_MODELS: 'lm:0f',
  LLM_DOWNLOAD_MODEL: 'lm:0g',
  LLM_DELETE_MODEL: 'lm:0h',
  LLM_CANCEL_DOWNLOAD: 'lm:0i',
  LLM_GENERATE_SUMMARY: 'lm:0j',
  LLM_GET_GPU_INFO: 'lm:0k',
  LLM_GET_RECOMMENDED_MODELS: 'lm:0l',
  LLM_GET_MODEL_PARAMETERS: 'lm:0m',
  LLM_SET_MODEL_PARAMETERS: 'lm:0n',
  LLM_GET_DEFAULT_MODEL: 'lm:0o',
  LLM_SET_DEFAULT_MODEL: 'lm:0p',
  LLM_SET_HF_TOKEN: 'lm:0q',
  LLM_GET_HF_TOKEN: 'lm:0r',
  LLM_VALIDATE_HF_TOKEN: 'lm:0s',
  LLM_CLEAR_HF_TOKEN: 'lm:0t',
  LLM_HAS_HF_TOKEN: 'lm:0u',
  LLM_GET_PROMPTS: 'lm:0v',
  LLM_SET_PROMPTS: 'lm:0w',
  LLM_RESET_PROMPTS: 'lm:0x',
  LLM_START_SERVER: 'lm:0y',
  LLM_STOP_SERVER: 'lm:0z',
  LLM_RESTART_SERVER: 'lm:1a',
  LLM_GET_DISK_USAGE: 'lm:1b',
  LLM_PARSE_HF_URL: 'lm:1c',
  LLM_DOWNLOAD_CUSTOM_MODEL: 'lm:1d',
  LLM_REMOVE_CUSTOM_MODEL: 'lm:1e',
  LLM_VALIDATE_CATALOG_URLS: 'lm:1f',
  LLM_OPEN_MODELS_DIRECTORY: 'lm:1g',
  LLM_REFRESH_MODELS: 'lm:1h',

  // ── Menu (macOS native menu bar) ─────────────────────────────────
  MENU_NAVIGATE: 'm:0a',
  MENU_OPEN_TRANSCRIPTIONS: 'm:0b',
  MENU_EXPORT: 'm:0c',
  MENU_FONT_ZOOM_IN: 'm:0d',
  MENU_FONT_ZOOM_OUT: 'm:0e',
  MENU_FONT_ZOOM_RESET: 'm:0f',
  MENU_NEW_NOTE: 'm:0g',
  MENU_UPDATE_STATE: 'm:0h',

  // ── Diagnostics ──────────────────────────────────────────────────
  DIAGNOSTICS_EXPORT: 'd:01',

  // ── Prompt Templates ──────────────────────────────────────────────
  PROMPT_TEMPLATES_LIST: 'pt:0a',
  PROMPT_TEMPLATES_GET: 'pt:0b',
  PROMPT_TEMPLATES_CREATE: 'pt:0c',
  PROMPT_TEMPLATES_UPDATE: 'pt:0d',
  PROMPT_TEMPLATES_DELETE: 'pt:0e',
  PROMPT_TEMPLATES_GET_ACTIVE: 'pt:0f',
  PROMPT_TEMPLATES_SET_ACTIVE: 'pt:0g',

  // ══════════════════════════════════════════════════════════════════
  // Push-events: main → renderer  (webContents.send / ipcRenderer.on)
  // ══════════════════════════════════════════════════════════════════

  // Auth events
  EVT_AUTH_COMPLETED: 'ev:a0',
  EVT_DEEP_LINK: 'ev:a1',

  // Settings events
  EVT_SETTINGS_CHANGED: 'ev:se0',
  EVT_SETTINGS_HYDRATE: 'ev:se1',

  // User events
  EVT_PROFILE_CHANGED: 'ev:u0',

  // Notes events
  EVT_NOTES_CHANGED: 'ev:n0',

  // Summary events
  EVT_SUMMARY_NOTIFICATION: 'ev:sm0',
  EVT_SUMMARY_PROGRESS: 'ev:sm1',

  // Navigation events
  EVT_NAVIGATE_TO_TRANSCRIPTION: 'ev:nav0',

  // Sync events
  EVT_SYNC_START: 'ev:sy0',
  EVT_SYNC_PROGRESS: 'ev:sy1',
  EVT_SYNC_COMPLETE: 'ev:sy2',
  EVT_SYNC_ERROR: 'ev:sy3',
  EVT_SYNC_CONFLICT: 'ev:sy4',

  // Calendar events
  EVT_CALENDAR_CONNECT_RESULT: 'ev:c0',

  // License events
  EVT_LICENSE_CHANGED: 'ev:l0',
  EVT_LICENSE_FEATURES_CHANGED: 'ev:l1',
  EVT_LICENSE_VALIDATED: 'ev:l2',
  EVT_LICENSE_EXPIRED: 'ev:l3',
  EVT_LICENSE_WARNING: 'ev:l4',
  EVT_LICENSE_UPGRADE_POLLING_STATUS: 'ev:l5',
  EVT_LICENSE_UPGRADE_SUCCESS: 'ev:l6',

  // Heartbeat events
  EVT_HEARTBEAT_LIMIT_EXCEEDED: 'ev:hb0',

  // Update events
  EVT_UPDATE_AVAILABLE: 'ev:up0',
  EVT_UPDATE_DISMISSED: 'ev:up1',
  EVT_UPDATE_DOWNLOAD_STARTED: 'ev:up2',
  EVT_UPDATE_DOWNLOAD_PROGRESS: 'ev:up3',
  EVT_UPDATE_DOWNLOAD_COMPLETE: 'ev:up4',
  EVT_UPDATE_DOWNLOAD_ERROR: 'ev:up5',

  // Meeting Reminder events
  EVT_MEETING_REMINDER_DUE: 'ev:mr0',
  EVT_MEETING_REMINDER_STATE_CHANGED: 'ev:mr1',
  EVT_MEETING_REMINDER_RECORD_CMD: 'ev:mr2',

  // Tags events
  EVT_TAGS_CHANGED: 'ev:tg0',
  EVT_NOTE_TAGS_CHANGED: 'ev:tg1',

  // Security events
  EVT_SECURITY_STATUS_CHANGED: 'ev:sc0',
  EVT_SECURITY_CERT_PIN_FAILED: 'ev:sc1',

  // Components events
  EVT_COMPONENTS_STATUS_CHANGED: 'ev:cp0',
  EVT_COMPONENTS_DOWNLOAD_PROGRESS: 'ev:cp1',
  EVT_COMPONENTS_DOWNLOAD_COMPLETE: 'ev:cp2',
  EVT_COMPONENTS_DOWNLOAD_ERROR: 'ev:cp3',
  EVT_COMPONENTS_ALL_READY: 'ev:cp4',
  EVT_COMPONENTS_SETUP_STATUS: 'ev:cp5',

  // LLM events
  EVT_LLM_DOWNLOAD_PROGRESS: 'ev:lm0',
  EVT_LLM_DOWNLOAD_STARTED: 'ev:lm1',
  EVT_LLM_DOWNLOAD_COMPLETED: 'ev:lm2',
  EVT_LLM_DOWNLOAD_FAILED: 'ev:lm3',
  EVT_LLM_DOWNLOAD_CANCELLED: 'ev:lm4',
  EVT_LLM_MODEL_LOADED: 'ev:lm5',
  EVT_LLM_MODEL_UNLOADED: 'ev:lm6',
  EVT_LLM_GENERATION_STARTED: 'ev:lm7',
  EVT_LLM_GENERATION_COMPLETED: 'ev:lm8',
  EVT_LLM_ERROR: 'ev:lm9',
} as const;

export type IPCChannel = (typeof IPC)[keyof typeof IPC];
