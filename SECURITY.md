# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please **do not** open a public issue. Instead, report it privately using GitHub's private security advisories:

- https://github.com/onepunk/notely-ai/security/advisories/new

Please include:

- A clear description of the issue
- Steps to reproduce
- The affected version or commit hash
- Any proof-of-concept code, if available

Maintainers will triage reports as quickly as they can and coordinate a fix and disclosure timeline privately with the reporter.

## Supported Versions

Security fixes are applied to the most recent tagged release. Older releases are not backported unless the vulnerability is critical and actively exploited.

## Scope

This repository contains a standalone AI desktop client that runs transcription and summarization locally. Reports about:

- The Electron main process, renderer, preload scripts, and IPC handlers — **in scope**
- The local transcription and summarization pipeline — **in scope**
- The cloud desktop client — **out of scope** (report against [`notely-cloud`](https://github.com/onepunk/notely-cloud))
- The platform backend — **out of scope** (report against [`notely-platform`](https://github.com/onepunk/notely-platform))

## Credential and Key Handling

- No code-signing credentials, private keys, or production secrets are committed to this repository.
- The app stores authentication tokens in the OS keystore (macOS Keychain, Windows Credential Manager, libsecret on Linux) and never writes them to plaintext files.
- `DEBUG_DB=true` is a development-only mode that disables database encryption. It must never be set on production builds; the app logs a warning whenever it is active.
