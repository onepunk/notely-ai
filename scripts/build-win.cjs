/**
 * Windows build wrapper
 *
 * Strips package.json for production, runs electron-builder with forwarded
 * arguments, then always restores the original package.json — even on failure.
 *
 * Usage:
 *   node scripts/build-win.cjs [electron-builder args...]
 *   e.g. node scripts/build-win.cjs --publish never
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const stripScript = path.join(__dirname, 'strip-package-json.cjs');

// Forward any extra CLI args to electron-builder
const extraArgs = process.argv.slice(2).join(' ');
const builderCmd = `electron-builder --win${extraArgs ? ' ' + extraArgs : ''}`;

let buildFailed = false;

try {
  // Strip package.json
  execSync(`node "${stripScript}" strip`, { cwd: ROOT, stdio: 'inherit' });

  // Run electron-builder
  execSync(builderCmd, { cwd: ROOT, stdio: 'inherit' });
} catch (err) {
  buildFailed = true;
  console.error('\nBuild failed:', err.message);
} finally {
  // Always restore
  try {
    execSync(`node "${stripScript}" restore`, { cwd: ROOT, stdio: 'inherit' });
  } catch (restoreErr) {
    console.error('CRITICAL: Failed to restore package.json!', restoreErr.message);
    process.exit(2);
  }
}

if (buildFailed) {
  process.exit(1);
}
