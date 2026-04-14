import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import { app } from 'electron';

import { LOCAL_SERVER_CONFIG } from '../common/config';

import { logger } from './logger';
import type { ComponentManager } from './services/components';

export type TranscriptionServerOptions = {
  port?: number;
  executablePath?: string; // Optional override for dev/testing
  args?: string[];
  healthPath?: string;
  restartOnExit?: boolean;
  env?: Record<string, string | undefined>;
  componentManager?: ComponentManager; // For on-demand component downloads
};

export class TranscriptionServerManager {
  private child?: ChildProcessWithoutNullStreams;
  private readonly options: Omit<Required<TranscriptionServerOptions>, 'componentManager'>;
  private readonly componentManager?: ComponentManager;
  private restarting = false;
  private actualPort?: number;
  private retryCount = 0;
  private readonly maxRetries = 5;
  private readonly baseRetryDelay = 1000; // ms

  constructor(options?: TranscriptionServerOptions) {
    this.componentManager = options?.componentManager;
    this.options = {
      port: options?.port ?? LOCAL_SERVER_CONFIG.transcriptionPort,
      executablePath: options?.executablePath ?? '',
      args: options?.args ?? [],
      healthPath: options?.healthPath ?? '/health',
      restartOnExit: options?.restartOnExit ?? true,
      env: options?.env ?? {},
    };
  }

  getPort(): number {
    return this.actualPort ?? this.options.port;
  }

  /**
   * Kill any orphan transcription server processes that may be lingering
   * from crashed or improperly closed app instances.
   */
  private killOrphanServers(): void {
    const isWindows = process.platform === 'win32';

    try {
      if (isWindows) {
        // Kill orphan audio-engine.exe processes holding our ports (from packaged builds)
        // Uses netstat to find PIDs on our port range, then verifies they are audio-engine.exe
        try {
          const netstatOutput = execSync('netstat -ano -p tcp', { encoding: 'utf-8' });
          const seenPids: Record<string, boolean> = {};

          for (let i = 0; i < 10; i++) {
            const port = this.options.port + i;
            const regex = new RegExp(':' + port + '\\s+\\S+\\s+LISTENING\\s+(\\d+)', 'g');
            let match = regex.exec(netstatOutput);
            while (match !== null) {
              seenPids[match[1]] = true;
              match = regex.exec(netstatOutput);
            }
          }

          const pids = Object.keys(seenPids);
          for (let i = 0; i < pids.length; i++) {
            try {
              const tasklistOutput = execSync('tasklist /FI "PID eq ' + pids[i] + '" /NH', {
                encoding: 'utf-8',
              });
              if (tasklistOutput.indexOf('audio-engine.exe') !== -1) {
                logger.info(
                  'Killing orphan audio-engine.exe (PID %s) on transcription port',
                  pids[i]
                );
                execSync('taskkill /F /PID ' + pids[i], { stdio: 'ignore' });
              }
            } catch {
              // Ignore - process may have already exited
            }
          }
        } catch {
          // Ignore - netstat/tasklist may fail
        }

        // Windows: Find and kill python processes running server_v3.py
        try {
          execSync('taskkill /F /IM python.exe /FI "WINDOWTITLE eq server_v3*" 2>nul', {
            stdio: 'ignore',
          });
        } catch {
          // Ignore errors - process may not exist
        }
        try {
          // More targeted: use WMIC to find python processes with server_v3.py in command line
          const result = execSync(
            "wmic process where \"name='python.exe' or name='python3.exe'\" get processid,commandline /format:csv 2>nul",
            { encoding: 'utf-8' }
          );
          const lines = result.split('\n').filter((line) => line.includes('server_v3.py'));
          for (const line of lines) {
            const parts = line.split(',');
            const pid = parts[parts.length - 1]?.trim();
            if (pid && /^\d+$/.test(pid)) {
              logger.info('Killing orphan transcription server process: %s', pid);
              try {
                execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
              } catch {
                // Ignore errors
              }
            }
          }
        } catch {
          // Ignore errors
        }
      } else {
        // Unix/Linux/Mac: Use pkill to kill any server_v3.py processes
        try {
          const result = execSync('pgrep -f "server_v3.py"', { encoding: 'utf-8' });
          const pids = result.trim().split('\n').filter(Boolean);
          for (const pid of pids) {
            logger.info('Killing orphan transcription server process: %s', pid);
            try {
              execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
            } catch {
              // Ignore errors - process may have already exited
            }
          }
          if (pids.length > 0) {
            logger.info('Killed %d orphan transcription server(s)', pids.length);
          }
        } catch {
          // pgrep returns non-zero if no processes found - this is expected
        }
      }
    } catch (error) {
      logger.warn('Failed to kill orphan transcription servers', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once('error', (err: NodeJS.ErrnoException) => {
        logger.info('Port %d check error: %s', port, err.code);
        resolve(false);
      });

      server.once('listening', () => {
        server.close(() => {
          logger.info('Port %d is available', port);
          resolve(true);
        });
      });

      server.listen(port, '127.0.0.1');
    });
  }

  private async findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
    logger.info('Starting port scan from %d', startPort);

    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      logger.info('Checking port %d...', port);

      const isAvailable = await this.isPortAvailable(port);

      if (isAvailable) {
        logger.info('Found available port: %d', port);
        return port;
      } else {
        logger.info('Port %d is already in use, trying next...', port);
      }
    }

    const errorMsg = `Could not find an available port after ${maxAttempts} attempts starting from ${startPort}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  private resolveExecutable(): { executable: string; args: string[]; cwd?: string } | null {
    logger.info('resolveExecutable: Starting resolution...');
    logger.info('resolveExecutable: app.isPackaged = %s', app.isPackaged);
    logger.info(
      'resolveExecutable: this.options.executablePath = %s',
      this.options.executablePath || 'undefined'
    );

    if (this.options.executablePath && fs.existsSync(this.options.executablePath)) {
      logger.info('resolveExecutable: Using custom executable path');
      return { executable: this.options.executablePath, args: this.options.args };
    }

    const devRoot = path.join(__dirname, '../../..');
    logger.info('resolveExecutable: __dirname = %s', __dirname);
    logger.info('resolveExecutable: devRoot = %s', devRoot);

    // Production: Use ComponentManager for on-demand downloaded binary (primary path)
    if (app.isPackaged && this.componentManager) {
      const binaryPath = this.componentManager.getAudioEnginePath();
      logger.info('resolveExecutable: Checking ComponentManager path', { binaryPath });
      if (fs.existsSync(binaryPath)) {
        logger.info('resolveExecutable: Using ComponentManager binary from userData');
        return { executable: binaryPath, args: this.options.args };
      }
      logger.warn(
        'resolveExecutable: ComponentManager binary not found, components may need download'
      );
    }

    // Production fallback: Try packaged binary locations (legacy path for bundled builds)
    if (app.isPackaged) {
      const base = process.resourcesPath;
      const binaryPath = path.join(
        base,
        'audio-engine',
        process.platform === 'win32' ? 'audio-engine.exe' : 'audio-engine'
      );
      if (fs.existsSync(binaryPath)) {
        logger.info('resolveExecutable: Using bundled binary from resources');
        return { executable: binaryPath, args: this.options.args };
      }
    }

    // Dev: Use local venv with our Python transcription server
    // In development, __dirname points to dist-electron, we need to find the actual source directory
    const projectRoot = app.isPackaged
      ? path.dirname(process.resourcesPath)
      : path.resolve(__dirname, '..');
    const transcriptionDir = path.resolve(projectRoot, 'src', 'main', 'transcription');
    const isWindows = process.platform === 'win32';
    const venvBinDir = isWindows ? 'Scripts' : 'bin';
    const venvPythonName = isWindows ? 'python.exe' : 'python3';

    // Use .venv (has all dependencies for Phase 1+2)
    const venvPython = path.resolve(transcriptionDir, '.venv', venvBinDir, venvPythonName);

    // Use server_v3.py (improved accuracy, hallucination filtering, delta encoding)
    const serverScript = path.resolve(transcriptionDir, 'server_v3.py');

    logger.debug('TranscriptionServer: Resolving paths', {
      venvPython,
      serverScript,
      venvExists: fs.existsSync(venvPython),
      scriptExists: fs.existsSync(serverScript),
    });

    if (fs.existsSync(venvPython) && fs.existsSync(serverScript)) {
      return {
        executable: venvPython,
        args: [serverScript],
        cwd: transcriptionDir,
      };
    }

    // In development, if venv doesn't exist but server script does, provide setup instructions
    if (!app.isPackaged && fs.existsSync(serverScript) && !fs.existsSync(venvPython)) {
      logger.error(
        'Development setup incomplete: Python venv not found at %s',
        path.dirname(venvPython)
      );
      if (isWindows) {
        logger.error(
          'To set up the transcription server, run:\n' +
            '  cd src\\main\\transcription\n' +
            '  python -m venv .venv\n' +
            '  .\\.venv\\Scripts\\activate\n' +
            '  pip install torch --index-url https://download.pytorch.org/whl/cu124\n' +
            '  pip install -r requirements.txt'
        );
      } else {
        logger.error(
          'To set up the transcription server, run:\n' +
            '  cd src/main/transcription\n' +
            '  python3 -m venv .venv\n' +
            '  source .venv/bin/activate\n' +
            '  pip install -r requirements.txt'
        );
      }
      return null;
    }

    return null;
  }

  async start(): Promise<void> {
    logger.info('TranscriptionServerManager.start() called');

    if (this.child) {
      logger.warn('Transcription server already running');
      return;
    }

    // Kill any orphan servers from previous crashed/closed instances
    logger.info('Checking for orphan transcription server processes...');
    this.killOrphanServers();

    // Wait a moment for processes to fully terminate and release ports
    await new Promise((resolve) => setTimeout(resolve, 500));

    const execConfig = this.resolveExecutable();

    if (!execConfig) {
      logger.warn('Transcription server executable not found. Skipping start.');
      return;
    }

    // Find an available port starting from the configured port
    try {
      this.actualPort = await this.findAvailablePort(this.options.port);
      logger.info('Using port %d for transcription server', this.actualPort);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to find available port: %s', errorMsg);
      // Don't throw, just log and return
      return;
    }

    const env: Record<string, string | undefined> = {
      ...process.env,
      PORT: String(this.actualPort),
      ...(this.options.env || {}),
    };

    // Add NVIDIA library paths (cuDNN, cuBLAS, etc.) for GPU inference on Linux.
    // The pip packages (nvidia-cudnn-cu12, nvidia-cublas-cu12, etc.) install shared
    // libraries under .venv/lib/pythonX.Y/site-packages/nvidia/*/lib/ but these
    // directories are not on LD_LIBRARY_PATH by default, causing ctranslate2 to
    // fail with "libcudnn_ops.so.9: cannot open shared object file".
    if (process.platform === 'linux' && execConfig.cwd) {
      try {
        const venvBase = path.join(execConfig.cwd, '.venv', 'lib');
        if (fs.existsSync(venvBase)) {
          const pythonDirs = fs.readdirSync(venvBase).filter((d) => d.startsWith('python'));
          for (const pyDir of pythonDirs) {
            const nvidiaBase = path.join(venvBase, pyDir, 'site-packages', 'nvidia');
            if (fs.existsSync(nvidiaBase)) {
              const nvidiaLibPaths = fs
                .readdirSync(nvidiaBase)
                .map((pkg) => path.join(nvidiaBase, pkg, 'lib'))
                .filter((libPath) => fs.existsSync(libPath));
              if (nvidiaLibPaths.length > 0) {
                const existing = env.LD_LIBRARY_PATH || '';
                env.LD_LIBRARY_PATH = [...nvidiaLibPaths, existing].filter(Boolean).join(':');
                logger.info('Set LD_LIBRARY_PATH for NVIDIA GPU libraries', {
                  count: nvidiaLibPaths.length,
                });
              }
            }
          }
        }
      } catch (err) {
        logger.warn('Failed to resolve NVIDIA library paths', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Starting transcription server', {
      executable: execConfig.executable,
      args: execConfig.args,
      cwd: execConfig.cwd,
      port: this.actualPort,
    });

    const spawnOptions: { env: NodeJS.ProcessEnv; cwd?: string } = { env };
    if (execConfig.cwd) {
      spawnOptions.cwd = execConfig.cwd;
    }

    const child = spawn(execConfig.executable, execConfig.args, spawnOptions);
    this.child = child;

    child.stdout.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) logger.info('[tsrv] ' + msg);
    });
    child.stderr.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) logger.info('[tsrv] ' + msg);
    });
    child.on('exit', (code, signal) => {
      logger.warn('Transcription server exited', { code, signal });
      this.child = undefined;

      // Clean exit or intentional stop - don't retry
      if (code === 0 || code === null || !this.options.restartOnExit) {
        this.retryCount = 0;
        return;
      }

      // Check if we've exceeded max retries
      if (this.retryCount >= this.maxRetries) {
        logger.error(
          'Transcription server failed permanently after %d attempts. Not retrying.',
          this.maxRetries
        );
        this.retryCount = 0;
        return;
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      this.retryCount++;
      const delay = this.baseRetryDelay * Math.pow(2, this.retryCount - 1);
      logger.warn(
        'Transcription server crashed (attempt %d/%d), retrying in %dms',
        this.retryCount,
        this.maxRetries,
        delay
      );

      this.restarting = true;
      setTimeout(() => {
        this.restarting = false;
        this.start().catch((err) =>
          logger.error('Failed to restart transcription server', {
            err: err instanceof Error ? err.message : err,
          })
        );
      }, delay);
    });

    // Probe health
    const ok = await this.waitForHealth(15000);
    if (ok) {
      logger.info('Transcription server is healthy');
      this.retryCount = 0; // Reset retry count on successful start
    } else {
      logger.warn('Transcription server health check timed out');
    }
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    logger.info('Stopping transcription server');

    // Graceful shutdown: ask server to unload models before killing
    if (this.actualPort) {
      try {
        await fetch(`http://127.0.0.1:${this.actualPort}/shutdown`, {
          method: 'POST',
          signal: AbortSignal.timeout(3000),
        });
        // Give server time to unload and exit
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch {
        // Server not responding — proceed to SIGTERM
      }
    }

    try {
      this.child.removeAllListeners();
      this.child.kill('SIGTERM');
    } catch (e) {
      logger.warn('Failed to stop transcription server gracefully, killing', {
        e: e instanceof Error ? e.message : e,
      });
      try {
        this.child.kill('SIGKILL');
      } catch (killError) {
        logger.error('Failed to kill transcription server process', {
          killError: killError instanceof Error ? killError.message : killError,
        });
      }
    } finally {
      this.child = undefined;
      this.actualPort = undefined;
    }
  }

  async restart(): Promise<void> {
    logger.info('Restarting transcription server');
    await this.stop();
    // Wait a moment for the process to fully stop
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.start();
  }

  updateEnvironment(env: Record<string, string | undefined>): void {
    logger.info('Updating transcription server environment', env);
    this.options.env = { ...this.options.env, ...env };
  }

  private waitForHealth(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    const urlPath = this.options.healthPath.startsWith('/')
      ? this.options.healthPath
      : `/${this.options.healthPath}`;
    const port = this.actualPort ?? this.options.port;
    return new Promise((resolve) => {
      const tick = () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        const req = http.get(
          { hostname: '127.0.0.1', port: port, path: urlPath, timeout: 2000 },
          (res) => {
            const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 400;
            res.resume(); // drain
            if (ok) resolve(true);
            else setTimeout(tick, 500);
          }
        );
        req.on('error', () => setTimeout(tick, 500));
        req.on('timeout', () => {
          try {
            req.destroy();
          } catch (destroyError) {
            // Ignore destroy errors as we're already in cleanup
          }
          setTimeout(tick, 500);
        });
      };
      tick();
    });
  }

  /**
   * Refine a transcription using a second pass with higher beam size
   * @param wavPath Path to the WAV file to refine
   * @param hints Optional user corrections to bias transcription (passed as initial_prompt)
   * @returns The refined transcription text
   */
  async refineTranscription(
    wavPath: string,
    hints?: string
  ): Promise<{ text: string; used_hints?: boolean }> {
    const port = this.actualPort ?? this.options.port;

    logger.info('TranscriptionServerManager: Starting refinement', {
      wavPath,
      port,
      hasHints: !!hints,
      hintsLength: hints?.length,
    });

    return new Promise((resolve, reject) => {
      const requestData: Record<string, unknown> = {
        wav_path: wavPath,
        model_name: 'small',
        beam_size: 5,
        use_gpu: false,
      };

      // Add user corrections as hints to bias Whisper toward correct words
      if (hints) {
        requestData.hints = hints;
        logger.info('TranscriptionServerManager: Including user corrections as hints');
      }

      const requestBody = JSON.stringify(requestData);

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: port,
          path: '/refine',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody),
          },
          timeout: 120000, // 2 minute timeout for refinement
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              const result = JSON.parse(data);

              if (result.success && result.text !== undefined) {
                logger.info('TranscriptionServerManager: Refinement successful', {
                  textLength: result.text.length,
                  usedHints: result.used_hints,
                });
                resolve({ text: result.text, used_hints: result.used_hints });
              } else {
                const error = result.error || 'Unknown refinement error';
                logger.error('TranscriptionServerManager: Refinement failed', { error });
                reject(new Error(error));
              }
            } catch (parseError) {
              logger.error('TranscriptionServerManager: Failed to parse refinement response', {
                data,
                error: parseError instanceof Error ? parseError.message : parseError,
              });
              reject(new Error('Failed to parse refinement response'));
            }
          });
        }
      );

      req.on('error', (error) => {
        logger.error('TranscriptionServerManager: Refinement request failed', {
          error: error.message,
        });
        reject(error);
      });

      req.on('timeout', () => {
        logger.error('TranscriptionServerManager: Refinement request timed out');
        req.destroy();
        reject(new Error('Refinement request timed out'));
      });

      req.write(requestBody);
      req.end();
    });
  }
}
