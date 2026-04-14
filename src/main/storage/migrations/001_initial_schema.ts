import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { Migration } from './MigrationRunner';

/**
 * Migration 001: Initial Schema
 * Creates the base tables and initial indices
 */
export const migration001: Migration = {
  version: 1,
  description: 'Create initial schema and base indices',

  up: (db: DatabaseInstance) => {
    // Create initial tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS binders (
        id TEXT PRIMARY KEY,
        user_profile_id TEXT,
        name TEXT NOT NULL,
        sort_index INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        icon TEXT,
        is_team_shared INTEGER NOT NULL DEFAULT 0,
        remote_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        binder_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (binder_id) REFERENCES binders(id) ON UPDATE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS note_content_head (
        note_id TEXT PRIMARY KEY,
        revision_id INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS note_revisions (
        revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id TEXT NOT NULL,
        lexical_json TEXT NOT NULL,
        plaintext TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        note_id UNINDEXED,
        title,
        content
      );
      
      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        avatar_path TEXT,
        updated_at INTEGER NOT NULL
      );
    `);

    // Create initial indices
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_binders_sort ON binders(deleted, sort_index, created_at);
      CREATE INDEX IF NOT EXISTS idx_notes_by_binder ON notes(binder_id, deleted, updated_at DESC);
    `);
  },

  down: (db: DatabaseInstance) => {
    // Drop indices first
    db.exec(`
      DROP INDEX IF EXISTS idx_notes_by_binder;
      DROP INDEX IF EXISTS idx_binders_sort;
    `);

    // Drop tables (in reverse dependency order)
    db.exec(`
      DROP TABLE IF EXISTS notes_fts;
      DROP TABLE IF EXISTS note_revisions;
      DROP TABLE IF EXISTS note_content_head;
      DROP TABLE IF EXISTS notes;
      DROP TABLE IF EXISTS binders;
      DROP TABLE IF EXISTS user_profile;
      DROP TABLE IF EXISTS settings;
    `);
  },
};
