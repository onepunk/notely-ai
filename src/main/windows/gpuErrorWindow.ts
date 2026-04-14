import fs from 'node:fs';
import path from 'node:path';

import { app, BrowserWindow } from 'electron';

import { logger } from '../logger';

/**
 * Resolve the path to resources/logo.png across dev and packaged builds.
 * Uses the same candidate-path strategy as WindowManager.getIconPath().
 */
function resolveLogoPath(): string {
  const iconName = 'logo.png';
  const candidates: string[] = [];

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, iconName));
    candidates.push(path.join(process.resourcesPath, 'resources', iconName));
    candidates.push(path.join(app.getAppPath(), iconName));
    candidates.push(path.join(app.getAppPath(), 'resources', iconName));
  } else {
    candidates.push(path.join(__dirname, '..', 'resources', iconName));
    candidates.push(path.join(__dirname, '..', iconName));
  }

  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

/**
 * Build a base64 data-URI for the logo so it can be embedded in inline HTML.
 * Returns an empty string if the file cannot be read.
 */
function getLogoDataUri(): string {
  try {
    const logoPath = resolveLogoPath();
    const buf = fs.readFileSync(logoPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (err) {
    logger.warn('gpuErrorWindow: Could not load logo', { err });
    return '';
  }
}

function buildHTML(reason: string, logoDataUri: string): string {
  const escapedReason = reason
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Unsupported Hardware — Notely</title>
<style>
  /* ── Light theme defaults ── */
  :root {
    --bg: #cccccc;
    --bg-subtle: #c7c7c7;
    --text-primary: #111827;
    --text-secondary: #6b7280;
    --brand-primary: #132e2d;
    --text-on-brand: #ffffff;
    --stroke: #b7b9bc;
    --radius: 8px;
  }

  /* ── Dark theme ── */
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1a1a1a;
      --bg-subtle: #242424;
      --text-primary: #e5e5e5;
      --text-secondary: #a1a1a1;
      --brand-primary: #b8f76f;
      --text-on-brand: #12240b;
      --stroke: #3a3a3a;
    }
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    height: 100%;
    overflow: hidden;
    background: transparent;
    font-family: Inter, 'Segoe UI Variable', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  }

  body {
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: drag;          /* allow dragging the frameless window */
    user-select: none;
  }

  .card {
    background: var(--bg);
    border: 1px solid var(--stroke);
    border-radius: var(--radius);
    padding: 36px 32px 28px;
    width: 100%;
    max-width: 460px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    -webkit-app-region: drag;
  }

  .logo {
    width: 48px;
    height: 48px;
    margin-bottom: 18px;
  }

  h1 {
    font-size: 18px;
    font-weight: 600;
    color: var(--brand-primary);
    margin-bottom: 14px;
  }

  .reason {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin-bottom: 16px;
    padding: 10px 14px;
    background: var(--bg-subtle);
    border-radius: var(--radius);
    border: 1px solid var(--stroke);
    width: 100%;
  }

  .body {
    font-size: 13px;
    color: var(--text-primary);
    line-height: 1.65;
    text-align: left;
    width: 100%;
    margin-bottom: 24px;
  }

  .body strong { font-weight: 600; }

  .hw-list {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
  }

  .hw-list li {
    padding-left: 18px;
    position: relative;
    margin-bottom: 4px;
  }

  .hw-list li::before {
    content: '•';
    position: absolute;
    left: 4px;
    color: var(--brand-primary);
    font-weight: 700;
  }

  .cloud-note {
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 8px;
  }

  button {
    -webkit-app-region: no-drag;       /* button must be clickable */
    appearance: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    padding: 9px 32px;
    border-radius: var(--radius);
    background: var(--brand-primary);
    color: var(--text-on-brand);
    transition: opacity 0.15s ease;
  }

  button:hover { opacity: 0.88; }
  button:active { opacity: 0.76; }
</style>
</head>
<body>
  <div class="card">
    ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="Notely" />` : ''}
    <h1>Unsupported Hardware</h1>
    <div class="reason">${escapedReason}</div>
    <div class="body">
      Notely AI requires a compatible GPU for local AI processing.
      <br /><br />
      <strong>Supported hardware:</strong>
      <ul class="hw-list">
        <li>NVIDIA GPU with CUDA support (GTX 10-series or newer)</li>
        <li>Apple Silicon Mac (M1 / M2 / M3 / M4)</li>
      </ul>
      <p class="cloud-note">For CPU-only systems, please use Notely Cloud edition.</p>
    </div>
    <button onclick="window.close()">Close</button>
  </div>
</body>
</html>`;
}

/**
 * Show a branded GPU-error window and return a promise that resolves when it is
 * closed.  The caller is responsible for quitting the app afterwards.
 */
export function showGPUErrorWindow(reason: string): Promise<void> {
  const logoDataUri = getLogoDataUri();
  const html = buildHTML(reason, logoDataUri);

  const win = new BrowserWindow({
    width: 520,
    height: 480,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    center: true,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  win.once('ready-to-show', () => win.show());

  return new Promise<void>((resolve) => {
    win.once('closed', () => resolve());
  });
}
