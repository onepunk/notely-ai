-- Notely Desktop v3 - Baseline Schema
-- Generated: December 2025
-- This replaces migrations 001-030 for fresh installations
-- Uses cursor-based sync (replaces legacy Merkle sync)

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = 10000;
PRAGMA temp_store = memory;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Binders table
CREATE TABLE IF NOT EXISTS binders (
  id TEXT PRIMARY KEY,
  user_profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_index INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  icon TEXT,
  is_team_shared INTEGER NOT NULL DEFAULT 0,
  remote_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  binder_type TEXT NOT NULL DEFAULT 'USER' CHECK (binder_type IN ('USER', 'SYSTEM')),
  is_conflicts INTEGER NOT NULL DEFAULT 0,
  -- Sync metadata
  sync_version INTEGER DEFAULT 1,
  sync_checksum TEXT,
  server_updated_at INTEGER
);

-- Notes table
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  binder_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  -- Conflict tracking
  is_conflict INTEGER NOT NULL DEFAULT 0,
  conflict_of_id TEXT,
  conflict_created_at INTEGER,
  -- Sync metadata
  sync_version INTEGER DEFAULT 1,
  sync_checksum TEXT,
  server_updated_at INTEGER,
  FOREIGN KEY (binder_id) REFERENCES binders(id) ON UPDATE CASCADE
);

-- Note content tracking
CREATE TABLE IF NOT EXISTS note_content_head (
  note_id TEXT PRIMARY KEY,
  revision_id INTEGER NOT NULL
);

-- Note revisions
CREATE TABLE IF NOT EXISTS note_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL,
  lexical_json TEXT NOT NULL,
  plaintext TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sync_version INTEGER DEFAULT 1,
  server_updated_at INTEGER
);

-- Transcription sessions
CREATE TABLE IF NOT EXISTS transcription_sessions (
  id TEXT PRIMARY KEY,
  binder_id TEXT NOT NULL REFERENCES binders(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('recording','completing','completed')),
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration_ms INTEGER,
  char_count INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  full_text TEXT NOT NULL DEFAULT '',
  original_text TEXT,
  user_edited INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER DEFAULT 1,
  sync_checksum TEXT,
  server_updated_at INTEGER
);

-- Audio recordings (local-only, not synced)
CREATE TABLE IF NOT EXISTS audio_recordings (
  id TEXT PRIMARY KEY,
  transcription_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER,
  duration_ms INTEGER,
  mime_type TEXT DEFAULT 'audio/webm',
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (transcription_id) REFERENCES transcription_sessions(id) ON DELETE CASCADE
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- User profile table
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  avatar_path TEXT,
  updated_at INTEGER NOT NULL
);

-- Sync configuration
CREATE TABLE IF NOT EXISTS sync_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_push_at INTEGER,
  last_pull_at INTEGER,
  cursor INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Sync items queue (cursor-based sync)
CREATE TABLE IF NOT EXISTS sync_items (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('binders', 'notes', 'transcriptions', 'summaries', 'tags', 'note_tags')),
  entity_id TEXT NOT NULL,
  sync_time INTEGER NOT NULL DEFAULT 0,
  pending_mutation_id TEXT,
  sync_disabled INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

-- Sync operation log
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL CHECK (operation IN ('push','pull','link','restore','sync')),
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
  entity_type TEXT,
  entity_count INTEGER DEFAULT 0,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  session_id TEXT
);

-- ============================================================================
-- FULL-TEXT SEARCH TABLES
-- ============================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  note_id UNINDEXED,
  title,
  content
);

CREATE VIRTUAL TABLE IF NOT EXISTS transcriptions_fts USING fts5(
  session_id UNINDEXED,
  content
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Binder indexes
CREATE INDEX IF NOT EXISTS idx_binders_sort ON binders(deleted, sort_index, created_at);
CREATE INDEX IF NOT EXISTS idx_binders_type ON binders(binder_type);
CREATE INDEX IF NOT EXISTS idx_binders_user_type ON binders(user_profile_id, binder_type);
CREATE INDEX IF NOT EXISTS idx_binders_sync_version ON binders(sync_version, server_updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_binders_conflicts_unique ON binders(user_profile_id) WHERE is_conflicts = 1 AND deleted = 0;

-- Note indexes
CREATE INDEX IF NOT EXISTS idx_notes_by_binder ON notes(binder_id, deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_sync_version ON notes(sync_version, server_updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_conflicts ON notes(is_conflict) WHERE is_conflict = 1;
CREATE INDEX IF NOT EXISTS idx_notes_conflict_of ON notes(conflict_of_id) WHERE conflict_of_id IS NOT NULL;

-- Revision indexes
CREATE INDEX IF NOT EXISTS idx_revisions_sync_version ON note_revisions(sync_version, server_updated_at);

-- Transcription indexes
CREATE INDEX IF NOT EXISTS idx_trans_sessions_note ON transcription_sessions(note_id);
CREATE INDEX IF NOT EXISTS idx_trans_sessions_binder ON transcription_sessions(binder_id);
CREATE INDEX IF NOT EXISTS idx_trans_sessions_status ON transcription_sessions(status);
CREATE INDEX IF NOT EXISTS idx_transcriptions_sync_version ON transcription_sessions(sync_version, server_updated_at);
CREATE INDEX IF NOT EXISTS idx_transcription_sessions_edited ON transcription_sessions(user_edited) WHERE user_edited = 1;

-- Audio recording indexes
CREATE INDEX IF NOT EXISTS idx_audio_recordings_transcription ON audio_recordings(transcription_id);
CREATE INDEX IF NOT EXISTS idx_audio_recordings_deleted ON audio_recordings(deleted) WHERE deleted = 0;

-- Sync item indexes
CREATE INDEX IF NOT EXISTS idx_sync_items_pending ON sync_items(sync_time) WHERE sync_time = 0;
CREATE INDEX IF NOT EXISTS idx_sync_items_type ON sync_items(entity_type, sync_time);
CREATE INDEX IF NOT EXISTS idx_sync_items_updated ON sync_items(updated_at);

-- Sync log indexes
CREATE INDEX IF NOT EXISTS idx_sync_log_operation ON sync_log(operation, started_at DESC);

-- ============================================================================
-- INITIAL DATA SEEDING
-- ============================================================================

INSERT OR IGNORE INTO user_profile(id, first_name, last_name, email, avatar_path, updated_at)
VALUES (1, NULL, NULL, NULL, NULL, strftime('%s', 'now') * 1000);

INSERT OR IGNORE INTO sync_config (
  id, cursor, created_at, updated_at
) VALUES (1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- Record baseline schema version for migration runner compatibility
INSERT OR REPLACE INTO settings(key, value) VALUES('schema_version', '30');
