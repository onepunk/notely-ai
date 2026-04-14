import Database from 'better-sqlite3-multiple-ciphers';
type DatabaseInstance = InstanceType<typeof Database>;

import { Migration } from './MigrationRunner';

const NEW_ID = 'ab6eb598-eeee-4d13-8dde-3eb2b496e91e';

export const migration014: Migration = {
  version: 14,
  description: 'Unify system Unassigned binder ID with server canonical ID',
  up: (db: DatabaseInstance) => {
    // Ensure tables exist
    // Gather all system binders
    const rows = db
      .prepare(
        "SELECT id, user_profile_id, updated_at FROM binders WHERE binder_type='SYSTEM' AND deleted=0"
      )
      .all() as Array<{ id: string; user_profile_id: string; updated_at: number }>;

    if (!rows || rows.length === 0) {
      // No system binder present; nothing to do
      return;
    }

    // Choose canonical row: latest updated_at
    const sorted = [...rows].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    const canonical = sorted[0];

    // Step 1: If multiple system binders exist, reassign notes to canonical and remove extras
    for (const r of sorted.slice(1)) {
      if (r.id === canonical.id) continue;
      // Repoint notes
      db.prepare('UPDATE notes SET binder_id=? WHERE binder_id=?').run(canonical.id, r.id);
      // Remove duplicate binder row
      db.prepare('DELETE FROM binders WHERE id=?').run(r.id);
    }

    // Step 2: If canonical ID is already NEW_ID, ensure name/type
    if (canonical.id === NEW_ID) {
      db.prepare(
        "UPDATE binders SET name='Unassigned', binder_type='SYSTEM', sort_index=COALESCE(sort_index, -1) WHERE id=?"
      ).run(NEW_ID);
      return;
    }

    // Step 3: Migrate canonical to NEW_ID
    // Repoint notes to NEW_ID first to avoid FK issues
    db.prepare('UPDATE notes SET binder_id=? WHERE binder_id=?').run(NEW_ID, canonical.id);

    // Attempt to update the binder ID to NEW_ID; if conflict, delete old after ensuring a NEW_ID row exists
    const existing = db.prepare('SELECT id FROM binders WHERE id=?').get(NEW_ID) as
      | { id: string }
      | undefined;

    if (!existing) {
      // Rename canonical row to NEW_ID
      db.prepare(
        "UPDATE binders SET id=?, name='Unassigned', binder_type='SYSTEM', sort_index=COALESCE(sort_index, -1) WHERE id=?"
      ).run(NEW_ID, canonical.id);
    } else {
      // Ensure NEW_ID row has correct attributes
      db.prepare(
        "UPDATE binders SET name='Unassigned', binder_type='SYSTEM', sort_index=COALESCE(sort_index, -1) WHERE id=?"
      ).run(NEW_ID);
      // Remove old canonical row
      db.prepare('DELETE FROM binders WHERE id=?').run(canonical.id);
    }
  },
};
