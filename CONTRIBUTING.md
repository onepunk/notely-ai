# Contributing to notely-ai

Thanks for your interest in contributing. This repo is a standalone AI desktop client: an Electron app that runs meeting transcription and summarization entirely locally on the user's machine. No backend, no license server, no activation — every feature is unlocked by default.

## Development setup

1. Install prerequisites:
   - Node.js 20+
   - Python 3.11+ (for the local transcription pipeline)
   - A C++ toolchain (for the native addons under `native/`)
   - OpenSSL headers (Linux/macOS) or OpenSSL on Windows

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the native addons and the main/renderer/preload bundles:
   ```bash
   npm run build
   ```

4. Start the development app:
   ```bash
   npm run dev
   ```

On Linux, set `DEBUG_DB=true` to bypass the OS keystore during development. Do **not** set this in production builds.

## Building releases

This repo ships a minimal CI workflow (`.github/workflows/ci.yml`) that runs lint and type-check only. It does not build signed release artifacts.

If you want to produce your own signed builds, fork the repo and add a workflow under `.github/workflows/` — consult the electron-builder docs for the standard environment variables (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).

## Pull request checklist

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] No credentials, private keys, or personal identifiers committed
- [ ] Commit messages follow the conventional format (`type: subject`)

## Reporting security issues

See [`SECURITY.md`](./SECURITY.md). Do not file security reports as public issues.
