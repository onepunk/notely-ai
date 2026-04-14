# Notely AI

Standalone AI desktop client. An Electron app that performs meeting transcription and AI-powered summarization **locally** on the user's machine, without sending audio or transcripts to a cloud service. Fully standalone — no backend, no license server, no activation.

## What it does

- Records meetings from microphone + system audio
- Transcribes speech to text using a local Whisper model (CPU or GPU)
- Generates meeting summaries using a local LLM via `llama.cpp`
- Stores everything in a local encrypted SQLite database
- Runs entirely on your machine with no cloud dependency

Every feature is unlocked by default. There is no license, no activation step, no upgrade prompt.

## Prerequisites

- Node.js 20+
- Python 3.11+ (for the local transcription pipeline)
- A C++ toolchain (for the native addons under `native/`)
- OpenSSL development headers
- Platform-specific build tools:
  - **Ubuntu/Debian**: `build-essential g++ make python3-dev libsecret-1-dev libssl-dev`
  - **macOS**: Xcode command-line tools (OpenSSL via Homebrew)
  - **Windows**: Visual Studio Build Tools with the "Desktop development with C++" workload; OpenSSL for Windows

## Development setup

1. Install Node.js dependencies:
   ```bash
   npm install
   ```

2. Build the native addon, main bundle, renderer, and preload:
   ```bash
   npm run build
   ```

3. Set up the Python transcription environment:
   ```bash
   bash scripts/setup-python-env.sh
   ```

4. Download a Whisper model into `src/main/transcription/models/` (e.g., `tiny.en.pt` for quick CPU testing, or a larger model for better accuracy).

5. Start the dev app:
   ```bash
   npm run dev
   ```

## Development-only environment variables

- `DEBUG_DB=true` — disables SQLCipher database encryption. Development only. The app logs a prominent warning at startup when it is active.
- `NOTELY_MODEL_DIR` — override the default Whisper model directory
- `NOTELY_MODEL_NAME` — choose which `.pt` model file to load
- `NOTELY_USE_GPU` — enable CUDA acceleration if a compatible GPU is present

## Building a release

The public repo ships a minimal CI workflow (`.github/workflows/ci.yml`) that runs lint and type-check only. It does **not** build signed release artifacts.

If you want to produce signed builds of your own, fork the repo and add a workflow that configures the relevant signing credentials as GitHub Actions secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, etc.) and calls `electron-builder`.

## Related repositories

- [`notely-cloud`](https://github.com/onepunk/notely-cloud) — cloud desktop client that syncs notes with a self-hosted backend
- [`notely-platform`](https://github.com/onepunk/notely-platform) — microservices backend powering `notely-cloud`

## Security

To report a vulnerability, see [`SECURITY.md`](./SECURITY.md).

## License

Apache License 2.0. See [`LICENSE`](./LICENSE).
