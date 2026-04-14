import { copyFileSync, mkdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'rewrite-notely-native',
      renderChunk(code) {
        // Rewrite require("notely-native") to a relative path that works from dist-electron/
        return code.replaceAll('require("notely-native")', 'require("../native/index.js")');
      },
    },
    {
      name: 'copy-security-files',
      closeBundle() {
        // Copy the security directory to dist-electron after build
        const securitySrc = path.resolve(__dirname, 'src/security');
        const securityDest = path.resolve(__dirname, 'dist-electron/security');

        try {
          mkdirSync(securityDest, { recursive: true });
          copyFileSync(
            path.join(securitySrc, 'license-public-key.pem'),
            path.join(securityDest, 'license-public-key.pem')
          );
          console.log('Copied security files to dist-electron/security');
        } catch (error) {
          console.error('Failed to copy security files:', error);
        }
      },
    },
  ],
  resolve: {
    alias: { '@common': path.resolve(__dirname, 'src/common') },
    // CRITICAL: Use Node.js resolution conditions instead of browser
    // This prevents packages like 'ws' from resolving to their browser stubs
    conditions: ['node', 'import', 'require', 'default'],
    mainFields: ['module', 'main'],
  },
  // Explicitly configure for Node.js/Electron main process
  ssr: {
    target: 'node',
    noExternal: [],
  },
  // Disable deps optimizer for main process - we want raw Node.js modules
  optimizeDeps: {
    noDiscovery: true,
    include: [],
  },
  build: {
    // Explicitly target Node.js (Electron 39 uses Node 22)
    target: 'node20',
    minify: 'terser',
    terserOptions: {
      mangle: {
        reserved: ['require', 'module', 'exports', '__dirname', '__filename'],
      },
      compress: {
        dead_code: true,
        passes: 2,
        drop_console: false,
      },
      format: {
        comments: false,
      },
    },
    lib: {
      entry: 'src/main/main.ts',
      formats: ['cjs'],
      fileName: 'main',
    },
    sourcemap: false,
    outDir: 'dist-electron',
    emptyOutDir: true,
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3-multiple-ciphers',
        'keytar', // Keep external for migration code (not installed, import will fail and be caught)
        'winston',
        'winston-daily-rotate-file',
        'jsonwebtoken',
        'ws',
        'notely-native', // Rewritten to relative path by rewrite-notely-native plugin
        // Add all Node.js builtin modules to ensure proper externalization
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
