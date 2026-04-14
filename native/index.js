/**
 * Notely Native Addon Loader
 *
 * Loads the compiled .node addon from the build directory.
 * In development: native/build/Release/notely_native.node
 * In production (asar-unpacked): unpacked alongside node_modules
 */

const path = require('path');

let addon;
let lastError;

// Try loading from build directory (development and production/asar-unpacked)
const buildPaths = [
  path.join(__dirname, 'build', 'Release', 'notely_native.node'),
  path.join(__dirname, 'build', 'Debug', 'notely_native.node'),
];

for (const buildPath of buildPaths) {
  try {
    addon = require(buildPath);
    break;
  } catch (err) {
    lastError = err;
  }
}

if (!addon) {
  const detail = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(
    `Failed to load notely-native addon.${detail} Ensure it has been compiled with: cd native && npm run build`
  );
}

module.exports = addon;
