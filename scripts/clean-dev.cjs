/**
 * Clean bytecode artifacts from dist-electron for dev mode.
 *
 * After a production build, dist-electron contains bytecode (.jsc) files and
 * thin .cjs loaders. This script removes the bytecode and writes bridge .cjs
 * files that load the dev-built .js files instead.
 */

const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist-electron');

// Ensure directory exists
fs.mkdirSync(DIST, { recursive: true });

// Remove all .jsc files
let removed = 0;
try {
  for (const file of fs.readdirSync(DIST)) {
    if (file.endsWith('.jsc')) {
      fs.unlinkSync(path.join(DIST, file));
      removed++;
    }
  }
} catch {
  // Directory might not exist yet
}

// Write placeholder main.cjs (will be overwritten by vite-plugin-electron build)
fs.writeFileSync(
  path.join(DIST, 'main.cjs'),
  '// placeholder - overwritten by dev build\n'
);

if (removed > 0) {
  console.log(`Cleaned ${removed} bytecode file(s) from dist-electron/`);
}
