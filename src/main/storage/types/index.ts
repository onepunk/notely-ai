/**
 * Type definitions exports
 */

// Database row types
export type {
  BinderRow,
  NoteMetaRow,
  NoteContentRow,
  NoteRevisionRow,
  NoteContentHeadRow,
  SettingsRow,
  UserProfileRow,
  TranscriptionSessionRow,
  NoteFtsRow,
  TranscriptionFtsRow,
  SyncConfigRow,
  SyncLogRow,
} from './database';

// Domain entity types
export type {
  Binder,
  NoteSummary,
  NoteMeta,
  NoteContent,
  NoteFull,
  NoteRevision,
  UserProfile,
  TranscriptionSession,
  SearchResult,
  Setting,
  CreateNoteInput,
  SaveNoteInput,
  UpdateBinderInput,
  UpdateUserProfileInput,
} from './entities';

// Sync types
export type {
  SyncConfig,
  SyncOperation,
  SyncStatus,
  SyncEntityType,
  SyncLogEntry,
  SyncLogOptions,
  SyncMetadataOptions,
  UpdateSyncConfigInput,
  SyncMetadata,
  SyncableEntity,
} from './sync';

// Tag types
export type { TagRow, NoteTagRow, Tag, NoteTag, CreateTagInput, UpdateTagInput } from './tags';
