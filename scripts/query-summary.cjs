#!/usr/bin/env node
/**
 * Query a summary from the encrypted DB using Electron's safeStorage.
 * Usage: npx electron scripts/query-summary.cjs [transcription-id]
 */
const { app, safeStorage } = require('electron');
const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const fs = require('fs');

// Match the real app name so we find the correct userData path and Keychain entries
app.setName('notely-ai');
app.disableHardwareAcceleration();

const tid = process.argv.slice(2).find(a => !a.startsWith('-'))
  || 'd86f0977-d327-414c-8b68-78c8798a9699';

app.whenReady().then(async () => {
  try {
    // Read the encrypted key blob from safeStorage's JSON file
    const userDataPath = app.getPath('userData');
    const storagePath = path.join(userDataPath, 'config', 'secure-storage.json');

    if (!fs.existsSync(storagePath)) {
      console.error('ERROR: secure-storage.json not found at', storagePath);
      process.exit(1);
    }

    const storageData = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
    const entry = storageData.entries['com.notely.desktop:database-encryption-key'];
    if (!entry) {
      console.error('ERROR: No database-encryption-key in secure storage');
      process.exit(1);
    }

    const encryptedBuffer = Buffer.from(entry.encrypted, 'base64');
    const key = safeStorage.decryptString(encryptedBuffer);

    // Open DB
    const dbPath = path.join(userDataPath, 'data', 'notes.sqlite');
    if (!fs.existsSync(dbPath)) {
      console.error('ERROR: DB not found at', dbPath);
      process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true });
    db.pragma("key = 'x'" + "'" + key + "'" + "'");
    db.prepare('SELECT 1').get(); // verify decryption

    const rows = db.prepare(
      `SELECT id, transcription_id, summary_text, summary_type,
              processing_time_ms, model_used, created_at, updated_at
       FROM summaries
       WHERE transcription_id = ? AND deleted = 0
       ORDER BY updated_at DESC`
    ).all(tid);

    if (rows.length === 0) {
      console.log('No summaries found for transcription ID:', tid);
    } else {
      for (const row of rows) {
        console.log('=== Summary ID:', row.id, '===');
        console.log('Type:', row.summary_type);
        console.log('Model:', row.model_used);
        console.log('Processing time:', row.processing_time_ms, 'ms');
        console.log('Created:', new Date(row.created_at).toISOString());
        console.log('Updated:', new Date(row.updated_at).toISOString());
        console.log('');

        // Pretty-print if JSON
        try {
          const parsed = JSON.parse(row.summary_text);
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log(row.summary_text);
        }
        console.log('');
      }
    }

    db.close();
  } catch (e) {
    console.error('ERROR:', e.message || e);
  }
  process.exit(0);
});
