/**
 * Strip package.json for production builds
 *
 * Removes metadata that leaks internal details (scripts, devDependencies,
 * build config, lint-staged, etc.) before electron-builder packages the asar.
 *
 * Usage:
 *   node scripts/strip-package-json.cjs strip   — backs up & strips
 *   node scripts/strip-package-json.cjs restore — restores from backup
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const BACKUP_PATH = path.join(ROOT, 'package.json.bak');

const KEEP_KEYS = ['name', 'version', 'main', 'private', 'type', 'dependencies', 'build'];

function strip() {
  if (fs.existsSync(BACKUP_PATH)) {
    console.error('ERROR: package.json.bak already exists — a previous strip was not restored.');
    process.exit(1);
  }

  const raw = fs.readFileSync(PKG_PATH, 'utf-8');
  fs.writeFileSync(BACKUP_PATH, raw, 'utf-8');

  const pkg = JSON.parse(raw);
  const stripped = {};
  for (const key of KEEP_KEYS) {
    if (key in pkg) {
      stripped[key] = pkg[key];
    }
  }

  fs.writeFileSync(PKG_PATH, JSON.stringify(stripped, null, 2) + '\n', 'utf-8');
  console.log('package.json stripped for production (backup at package.json.bak)');
}

function restore() {
  if (!fs.existsSync(BACKUP_PATH)) {
    console.error('ERROR: package.json.bak not found — nothing to restore.');
    process.exit(1);
  }

  fs.copyFileSync(BACKUP_PATH, PKG_PATH);
  fs.unlinkSync(BACKUP_PATH);
  console.log('package.json restored from backup');
}

const command = process.argv[2];
if (command === 'strip') {
  strip();
} else if (command === 'restore') {
  restore();
} else {
  console.error('Usage: node strip-package-json.cjs <strip|restore>');
  process.exit(1);
}
