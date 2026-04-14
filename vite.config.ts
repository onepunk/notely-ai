import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.0'),
  },
  plugins: [
    react(),
    electron([
      {
        // Main process configuration
        entry: '../main/main.ts',
        vite: {
          plugins: [
            {
              name: 'force-cjs-output',
              outputOptions(options) {
                return {
                  ...options,
                  format: 'cjs',
                  entryFileNames: '[name].cjs',
                  chunkFileNames: '[name]-[hash].cjs',
                };
              },
            },
            {
              name: 'rewrite-notely-native',
              renderChunk(code) {
                return code.replaceAll('require("notely-native")', 'require("../native/index.js")');
              },
            },
          ],
          build: {
            outDir: '../../dist-electron',
            rollupOptions: {
              external: [
                'electron',
                'better-sqlite3-multiple-ciphers',
                'keytar', // Keep external for migration code (not installed, import will fail)
                'winston',
                'winston-daily-rotate-file',
                'notely-native', // Rewritten to relative path by rewrite-notely-native plugin
                'node:fs',
                'node:path',
                'node:crypto',
                'node:child_process',
                'node:http',
                'node:net',
                'node:os',
              ],
            },
          },
        },
      },
      {
        // Preload script configuration
        entry: '../preload/index.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          plugins: [
            {
              name: 'force-cjs-output',
              outputOptions(options) {
                return {
                  ...options,
                  format: 'cjs',
                  entryFileNames: 'preload.cjs',
                  chunkFileNames: '[name]-[hash].cjs',
                };
              },
            },
          ],
          build: {
            outDir: '../../dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
  ],
  root: 'src/renderer',
  publicDir: 'public', // Explicitly enable public directory (vite-plugin-electron disables it by default)
  resolve: {
    alias: {
      '@common': path.resolve(__dirname, 'src/common'),
      '@shared': path.resolve(__dirname, 'src/renderer/shared'),
      '@features': path.resolve(__dirname, 'src/renderer/features'),
      '@app': path.resolve(__dirname, 'src/renderer/app'),
    },
  },
  css: { modules: { localsConvention: 'camelCase' } },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      mangle: true,
      compress: {
        dead_code: true,
        passes: 2,
        drop_console: false,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/renderer/index.html'),
        meetingReminder: path.resolve(__dirname, 'src/renderer/meeting-reminder.html'),
        auth: path.resolve(__dirname, 'src/renderer/auth.html'),
        passwordUnlock: path.resolve(__dirname, 'src/renderer/passwordUnlock.html'),
      },
      output: {
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    watch: {
      // Ignore node_modules to reduce file watcher usage
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/dist-electron/**',
        '**/.venv/**',
        '**/pytorch_env/**',
      ],
    },
  },
});
