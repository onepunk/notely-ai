/**
 * LLM Server Manager
 *
 * Manages the Python LLM server subprocess for the Notely Standalone edition.
 * Handles server lifecycle, health checks, model loading, and generation requests.
 *
 * Mirrors the TranscriptionServerManager pattern.
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import { app } from 'electron';

import { LOCAL_SERVER_CONFIG } from '../../../common/config';
import { logger } from '../../logger';
import type { ComponentManager } from '../components/ComponentManager';

import type {
  LLMServerOptions,
  LLMServerState,
  LLMServerStatus,
  LoadModelRequest,
  LoadModelResponse,
  GenerateSummaryRequest,
  GenerateSummaryResponse,
  SimpleGenerateRequest,
  SimpleGenerateResponse,
  HealthResponse,
  ModelInfoResponse,
} from './types';

/**
 * Default port for the LLM server (from central config)
 */
const DEFAULT_PORT = LOCAL_SERVER_CONFIG.llmPort;

/**
 * Maximum retry attempts for server restart
 */
const MAX_RETRIES = 5;

/**
 * Base delay for exponential backoff (ms)
 */
const BASE_RETRY_DELAY = 1000;

/**
 * Manages the Python LLM server subprocess
 */
export class LLMServerManager extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private readonly options: Required<Omit<LLMServerOptions, 'debugDir' | 'componentManager'>> & {
    debugDir?: string;
  };
  private readonly componentManager?: ComponentManager;
  private actualPort?: number;
  private retryCount = 0;
  private restarting = false;
  private status: LLMServerStatus = 'stopped';
  private modelPath: string | null = null;
  private modelLoaded = false;
  private contextLength: number | null = null;
  private generationCount = 0;
  private lastError: string | null = null;

  constructor(options?: LLMServerOptions) {
    super();
    this.componentManager = options?.componentManager;
    this.options = {
      port: options?.port ?? DEFAULT_PORT,
      executablePath: options?.executablePath ?? '',
      healthPath: options?.healthPath ?? '/health',
      restartOnExit: options?.restartOnExit ?? true,
      env: options?.env ?? {},
      debugDir: options?.debugDir,
    };
  }

  /**
   * Get the actual port the server is running on
   */
  getPort(): number {
    return this.actualPort ?? this.options.port;
  }

  /**
   * Get current server state
   */
  getState(): LLMServerState {
    return {
      status: this.status,
      port: this.actualPort ?? null,
      modelPath: this.modelPath,
      modelLoaded: this.modelLoaded,
      contextLength: this.contextLength,
      generationCount: this.generationCount,
      lastError: this.lastError,
    };
  }

  /**
   * Check if the server is ready for generation
   */
  isReady(): boolean {
    return this.status === 'ready' && this.modelLoaded;
  }

  /**
   * Kill any orphan LLM server processes
   */
  private killOrphanServers(): void {
    const isWindows = process.platform === 'win32';

    try {
      if (isWindows) {
        // Windows: Find and kill python processes running server.py (LLM)
        try {
          const result = execSync(
            "wmic process where \"name='python.exe' or name='python3.exe'\" get processid,commandline /format:csv 2>nul",
            { encoding: 'utf-8' }
          );
          const lines = result
            .split('\n')
            .filter((line) => line.includes('llm') && line.includes('server.py'));
          for (const line of lines) {
            const parts = line.split(',');
            const pid = parts[parts.length - 1]?.trim();
            if (pid && /^\d+$/.test(pid)) {
              logger.info(`LLMServerManager: Killing orphan process ${pid}`);
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
        // Unix/Linux/Mac: Use pgrep to find LLM server processes
        try {
          const result = execSync('pgrep -f "llm.*server.py"', { encoding: 'utf-8' });
          const pids = result.trim().split('\n').filter(Boolean);
          for (const pid of pids) {
            logger.info(`LLMServerManager: Killing orphan process ${pid}`);
            try {
              execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
            } catch {
              // Ignore errors
            }
          }
        } catch {
          // pgrep returns non-zero if no processes found
        }
      }
    } catch (error) {
      logger.warn('LLMServerManager: Failed to kill orphan servers', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Check if a port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });

      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * Find an available port starting from the configured port
   */
  private async findAvailablePort(startPort: number, maxAttempts = 10): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`Could not find available port after ${maxAttempts} attempts`);
  }

  /**
   * Resolve the Python executable and server script
   */
  private resolveExecutable(): { executable: string; args: string[]; cwd?: string } | null {
    logger.info('LLMServerManager: Resolving executable');

    // Custom path override
    if (this.options.executablePath && fs.existsSync(this.options.executablePath)) {
      return { executable: this.options.executablePath, args: [] };
    }

    const isWindows = process.platform === 'win32';

    // Production: Primary — use ComponentManager for on-demand downloaded binary
    if (app.isPackaged && this.componentManager) {
      const binaryPath = this.componentManager.getLLMServerPath();
      logger.info('LLMServerManager: Checking ComponentManager path', { binaryPath });
      if (fs.existsSync(binaryPath)) {
        logger.info('LLMServerManager: Using ComponentManager binary from userData');
        return { executable: binaryPath, args: [] };
      }
      logger.warn(
        'LLMServerManager: ComponentManager binary not found, components may need download'
      );
    }

    // Production fallback: Look for bundled binary (legacy installs)
    if (app.isPackaged) {
      const bundledExePath = path.join(
        process.resourcesPath,
        'llm-server',
        isWindows ? 'notely-llm-server.exe' : 'notely-llm-server'
      );
      if (fs.existsSync(bundledExePath)) {
        logger.info('LLMServerManager: Using bundled binary', { path: bundledExePath });
        return { executable: bundledExePath, args: [] };
      }

      logger.error('LLMServerManager: Could not find LLM server executable');
      return null;
    }

    // Development: Use local venv
    const venvBinDir = isWindows ? 'Scripts' : 'bin';
    const venvPythonName = isWindows ? 'python.exe' : 'python3';
    const projectRoot = path.resolve(__dirname, '..');

    const llmDir = path.resolve(projectRoot, 'src', 'main', 'llm');
    const venvPython = path.resolve(llmDir, '.venv', venvBinDir, venvPythonName);
    const serverScript = path.resolve(llmDir, 'server.py');

    logger.debug('LLMServerManager: Checking dev paths', {
      llmDir,
      venvPython,
      serverScript,
      venvExists: fs.existsSync(venvPython),
      scriptExists: fs.existsSync(serverScript),
    });

    if (fs.existsSync(venvPython) && fs.existsSync(serverScript)) {
      return {
        executable: venvPython,
        args: [serverScript],
        cwd: llmDir,
      };
    }

    // Development: venv doesn't exist but server script does — provide setup instructions
    if (fs.existsSync(serverScript)) {
      logger.error(
        'Development setup incomplete: Python venv not found at %s',
        path.dirname(venvPython)
      );
      if (isWindows) {
        logger.error(
          'To set up the LLM server, run:\n' +
            '  cd src\\main\\llm\n' +
            '  python -m venv .venv\n' +
            '  .\\.venv\\Scripts\\activate\n' +
            '  pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124\n' +
            '  pip install -r requirements.txt'
        );
      } else {
        logger.error(
          'To set up the LLM server, run:\n' +
            '  cd src/main/llm\n' +
            '  python3 -m venv .venv\n' +
            '  source .venv/bin/activate\n' +
            '  pip install -r requirements.txt'
        );
      }
      return null;
    }

    logger.error('LLMServerManager: Could not find LLM server executable');
    return null;
  }

  /**
   * Start the LLM server
   */
  async start(): Promise<void> {
    logger.info('LLMServerManager: Starting server');

    if (this.child) {
      logger.warn('LLMServerManager: Server already running');
      return;
    }

    this.status = 'starting';
    this.lastError = null;

    // Kill orphan processes
    this.killOrphanServers();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const execConfig = this.resolveExecutable();
    if (!execConfig) {
      this.status = 'error';
      this.lastError = 'LLM server executable not found';
      this.emit('error', { error: this.lastError });
      return;
    }

    // Find available port
    try {
      this.actualPort = await this.findAvailablePort(this.options.port);
      logger.info(`LLMServerManager: Using port ${this.actualPort}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.status = 'error';
      this.lastError = msg;
      this.emit('error', { error: msg });
      return;
    }

    // Build environment
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LLM_SERVER_PORT: String(this.actualPort),
      ...(this.options.debugDir ? { LLM_DEBUG_DIR: this.options.debugDir } : {}),
      ...this.options.env,
    };

    // On Windows, ensure CUDA runtime DLLs are discoverable by ggml-cuda.dll.
    // Python 3.8+ requires os.add_dll_directory() for DLL search; the llama_cpp
    // package handles this if CUDA_PATH is set. We also prepend the CUDA bin
    // and llama_cpp lib dirs to PATH as a fallback.
    if (process.platform === 'win32') {
      const extraPaths: string[] = [];

      // Auto-detect CUDA_PATH if not already set
      if (!env.CUDA_PATH) {
        const cudaBase = path.join('C:', 'Program Files', 'NVIDIA GPU Computing Toolkit', 'CUDA');
        if (fs.existsSync(cudaBase)) {
          const versions = fs.readdirSync(cudaBase).sort().reverse();
          if (versions.length > 0) {
            env.CUDA_PATH = path.join(cudaBase, versions[0]);
            logger.info('LLMServerManager: Auto-detected CUDA_PATH', {
              cudaPath: env.CUDA_PATH,
            });
          }
        }
      }

      // Add CUDA bin dir to PATH so cublas/cudart DLLs are findable
      if (env.CUDA_PATH) {
        const cudaBin = path.join(env.CUDA_PATH, 'bin');
        if (fs.existsSync(cudaBin)) {
          extraPaths.push(cudaBin);
        }
      }

      // Add llama_cpp lib dir to PATH for ggml DLLs
      if (execConfig.cwd) {
        const llamaCppLibDir = path.join(
          execConfig.cwd,
          '.venv',
          'Lib',
          'site-packages',
          'llama_cpp',
          'lib'
        );
        if (fs.existsSync(llamaCppLibDir)) {
          extraPaths.push(llamaCppLibDir);
        }
      }

      if (extraPaths.length > 0) {
        env.PATH = [...extraPaths, env.PATH || ''].join(';');
        logger.info('LLMServerManager: Added DLL dirs to PATH', { extraPaths });
      }
    }

    logger.info('LLMServerManager: Spawning process', {
      executable: execConfig.executable,
      args: execConfig.args,
      cwd: execConfig.cwd,
      port: this.actualPort,
    });

    const spawnOptions: { env: NodeJS.ProcessEnv; cwd?: string } = { env };
    if (execConfig.cwd) {
      spawnOptions.cwd = execConfig.cwd;
    }

    const child = spawn(
      execConfig.executable,
      [...execConfig.args, '--port', String(this.actualPort)],
      spawnOptions
    );
    this.child = child;

    // Handle spawn errors (e.g. ENOENT when executable is missing).
    // Sets spawnFailed so waitForHealth can bail out immediately.
    let spawnFailed = false;
    child.on('error', (err) => {
      spawnFailed = true;
      logger.error('LLMServerManager: Spawn error', {
        error: err.message,
      });
    });

    // Handle output
    child.stdout.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (
        msg.includes('Uvicorn running') ||
        msg.includes('Application startup') ||
        msg.includes('STARTING')
      ) {
        logger.info('[llm] ' + msg);
      } else {
        logger.debug('[llm] ' + msg);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (
        msg.includes('Uvicorn running') ||
        msg.includes('Application startup') ||
        msg.includes('STARTING')
      ) {
        logger.info('[llm] ' + msg);
      } else {
        logger.debug('[llm] ' + msg);
      }
    });

    // Handle exit
    child.on('exit', (code, signal) => {
      logger.warn('LLMServerManager: Server exited', { code, signal });
      this.child = undefined;
      this.status = 'stopped';
      this.modelLoaded = false;
      this.emit('stopped', { code, signal });

      // Clean exit or intentional stop
      if (code === 0 || code === null || !this.options.restartOnExit) {
        this.retryCount = 0;
        return;
      }

      // Retry with exponential backoff
      if (this.retryCount >= MAX_RETRIES) {
        logger.error(`LLMServerManager: Failed after ${MAX_RETRIES} attempts`);
        this.status = 'error';
        this.lastError = 'Server failed to start after max retries';
        this.retryCount = 0;
        return;
      }

      this.retryCount++;
      const delay = BASE_RETRY_DELAY * Math.pow(2, this.retryCount - 1);
      logger.warn(
        `LLMServerManager: Restarting (attempt ${this.retryCount}/${MAX_RETRIES}) in ${delay}ms`
      );
      this.emit('restarting', {
        attempt: this.retryCount,
        maxAttempts: MAX_RETRIES,
        delayMs: delay,
      });

      this.restarting = true;
      setTimeout(() => {
        this.restarting = false;
        this.start().catch((err) => {
          logger.error('LLMServerManager: Failed to restart', {
            error: err instanceof Error ? err.message : err,
          });
        });
      }, delay);
    });

    // Wait for health (bail immediately if spawn failed)
    const healthy = await this.waitForHealth(30000, () => spawnFailed);
    if (healthy) {
      this.status = 'running';
      this.retryCount = 0;
      logger.info('LLMServerManager: Server is healthy');
      this.emit('started', { port: this.actualPort! });
      this.emit('healthy', { port: this.actualPort! });
    } else {
      this.status = 'error';
      this.lastError = 'Health check timeout';
      logger.warn('LLMServerManager: Health check timed out');
      this.emit('unhealthy', { error: 'Health check timeout' });
    }
  }

  /**
   * Stop the LLM server
   */
  async stop(): Promise<void> {
    if (!this.child) return;

    logger.info('LLMServerManager: Stopping server');

    try {
      this.child.removeAllListeners();
      this.child.kill('SIGTERM');
    } catch (e) {
      logger.warn('LLMServerManager: Graceful stop failed, killing', {
        error: e instanceof Error ? e.message : e,
      });
      try {
        this.child.kill('SIGKILL');
      } catch {
        // Ignore
      }
    } finally {
      this.child = undefined;
      this.actualPort = undefined;
      this.status = 'stopped';
      this.modelLoaded = false;
    }
  }

  /**
   * Restart the server
   */
  async restart(): Promise<void> {
    logger.info('LLMServerManager: Restarting');
    await this.stop();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.start();
  }

  /**
   * Wait for server health
   */
  private waitForHealth(timeoutMs: number, shouldAbort?: () => boolean): Promise<boolean> {
    const start = Date.now();
    const port = this.actualPort ?? this.options.port;

    return new Promise((resolve) => {
      const tick = () => {
        if (shouldAbort?.()) {
          return resolve(false);
        }
        if (Date.now() - start > timeoutMs) {
          return resolve(false);
        }

        const req = http.get(
          {
            hostname: '127.0.0.1',
            port,
            path: this.options.healthPath,
            timeout: 2000,
          },
          (res) => {
            const ok =
              res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400;
            res.resume();
            if (ok) resolve(true);
            else setTimeout(tick, 500);
          }
        );

        req.on('error', () => setTimeout(tick, 500));
        req.on('timeout', () => {
          try {
            req.destroy();
          } catch {
            // Ignore
          }
          setTimeout(tick, 500);
        });
      };

      tick();
    });
  }

  /**
   * Make an HTTP request to the server
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = 120000
  ): Promise<T> {
    const port = this.actualPort ?? this.options.port;

    return new Promise((resolve, reject) => {
      const requestBody = body ? JSON.stringify(body) : undefined;

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody) } : {}),
          },
          timeout: timeoutMs,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(parsed.detail || `HTTP ${res.statusCode}`));
              } else {
                resolve(parsed as T);
              }
            } catch (e) {
              reject(new Error(`Failed to parse response: ${data.substring(0, 200)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (requestBody) {
        req.write(requestBody);
      }
      req.end();
    });
  }

  /**
   * Load a model
   */
  async loadModel(request: LoadModelRequest): Promise<LoadModelResponse> {
    logger.info('LLMServerManager: Loading model', { modelPath: request.modelPath });
    this.status = 'loading_model';
    this.emit('generationStarted', { textLength: 0 });

    try {
      const response = await this.request<{
        status: string;
        model_path: string;
        load_time_seconds: number;
        context_length: number;
      }>('POST', '/load', {
        model_path: request.modelPath,
        n_gpu_layers: request.nGpuLayers ?? -1,
        n_ctx: request.nCtx ?? 4096,
        n_threads: request.nThreads,
      });

      this.modelPath = response.model_path;
      this.modelLoaded = true;
      this.contextLength = response.context_length;
      this.status = 'ready';

      const result: LoadModelResponse = {
        status: 'loaded',
        modelPath: response.model_path,
        loadTimeSeconds: response.load_time_seconds,
        contextLength: response.context_length,
      };

      this.emit('modelLoaded', {
        modelPath: result.modelPath,
        loadTimeSeconds: result.loadTimeSeconds,
      });

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.status = 'error';
      this.lastError = msg;
      this.emit('error', { error: msg });

      return {
        status: 'error',
        modelPath: request.modelPath,
        loadTimeSeconds: 0,
        contextLength: 0,
        error: msg,
      };
    }
  }

  /**
   * Unload the current model
   */
  async unloadModel(): Promise<void> {
    logger.info('LLMServerManager: Unloading model');

    try {
      await this.request<{ status: string }>('POST', '/unload', {});
      this.modelPath = null;
      this.modelLoaded = false;
      this.contextLength = null;
      this.status = 'running';
      this.emit('modelUnloaded', {});
    } catch (error) {
      logger.error('LLMServerManager: Unload failed', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Generate a summary with retry logic
   */
  async generateSummary(
    request: GenerateSummaryRequest,
    maxRetries = 3
  ): Promise<GenerateSummaryResponse> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.doGenerateSummary(request);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`LLMServerManager: Generation failed (attempt ${attempt}/${maxRetries})`, {
          error: msg,
        });

        if (attempt === maxRetries) {
          this.emit('generationFailed', { error: msg });
          throw error;
        }

        // Restart server and retry
        await this.restart();
        await this.waitForHealth(15000);

        // Reload model if it was loaded
        if (this.modelPath) {
          await this.loadModel({ modelPath: this.modelPath });
        }
      }
    }

    throw new Error('Generation failed after max retries');
  }

  /**
   * Internal generation implementation
   */
  private async doGenerateSummary(
    request: GenerateSummaryRequest
  ): Promise<GenerateSummaryResponse> {
    logger.info('LLMServerManager: Generating summary', {
      textLength: request.text.length,
    });

    this.status = 'generating';
    this.emit('generationStarted', { textLength: request.text.length });

    const response = await this.request<{
      result: {
        summary: string;
        action_items: Array<{ text: string; owner: string | null; due_date: string | null }>;
        decisions: Array<{ text: string; context: string | null }>;
        key_points: Array<{ topic: string; summary: string; participants: string[] }>;
        participants: string[];
        topics_discussed: string[];
        processing_stats: {
          chunks_processed: number;
          processing_time_seconds: number;
          action_items_before_dedup: number;
          action_items_after_dedup: number;
          total_time_seconds: number;
        };
      };
      result_is_text: boolean;
      analysis_type: string;
      backend: string;
      timestamp: number;
      generation_time_seconds: number;
    }>('POST', '/generate', {
      text: request.text,
      analysis_type: request.analysisType ?? 'full',
      skip_refinement: request.skipRefinement ?? false,
      ...(request.systemPrompt ? { system_prompt: request.systemPrompt } : {}),
      ...(request.promptTemplates ? { prompt_templates: request.promptTemplates } : {}),
      ...(request.temperatureExtract !== undefined
        ? { temperature_extract: request.temperatureExtract }
        : {}),
      ...(request.temperatureRefine !== undefined
        ? { temperature_refine: request.temperatureRefine }
        : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    });

    this.generationCount++;
    this.status = 'ready';

    const result: GenerateSummaryResponse = {
      result: {
        summary: response.result.summary,
        actionItems: response.result.action_items.map((a) => ({
          text: a.text,
          owner: a.owner,
          dueDate: a.due_date,
        })),
        decisions: response.result.decisions,
        keyPoints: response.result.key_points,
        participants: response.result.participants,
        topicsDiscussed: response.result.topics_discussed,
        processingStats: {
          chunksProcessed: response.result.processing_stats.chunks_processed,
          processingTimeSeconds: response.result.processing_stats.processing_time_seconds,
          actionItemsBeforeDedup: response.result.processing_stats.action_items_before_dedup,
          actionItemsAfterDedup: response.result.processing_stats.action_items_after_dedup,
          totalTimeSeconds: response.result.processing_stats.total_time_seconds,
        },
      },
      resultIsText: response.result_is_text,
      analysisType: response.analysis_type,
      backend: response.backend,
      timestamp: response.timestamp,
      generationTimeSeconds: response.generation_time_seconds,
    };

    this.emit('generationCompleted', { timeSeconds: result.generationTimeSeconds });

    return result;
  }

  /**
   * Simple text generation (non-pipeline)
   */
  async generateSimple(request: SimpleGenerateRequest): Promise<SimpleGenerateResponse> {
    const response = await this.request<{
      text: string;
      generation_time_seconds: number;
    }>('POST', '/generate/simple', {
      prompt: request.prompt,
      max_tokens: request.maxTokens ?? 900,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP ?? 0.9,
      stop_sequences: request.stopSequences,
    });

    return {
      text: response.text,
      generationTimeSeconds: response.generation_time_seconds,
    };
  }

  /**
   * Get server health
   */
  async getHealth(): Promise<HealthResponse> {
    const response = await this.request<{
      status: string;
      model_loaded: boolean;
      model_path: string | null;
      context_length: number | null;
      generation_count: number;
      uptime_seconds: number;
    }>('GET', '/health');

    return {
      status: response.status === 'ok' ? 'ok' : 'error',
      modelLoaded: response.model_loaded,
      modelPath: response.model_path,
      contextLength: response.context_length,
      generationCount: response.generation_count,
      uptimeSeconds: response.uptime_seconds,
    };
  }

  /**
   * Get model info
   */
  async getModelInfo(): Promise<ModelInfoResponse> {
    const response = await this.request<{
      loaded: boolean;
      model_path: string | null;
      n_gpu_layers: number | null;
      n_ctx: number | null;
      load_time_seconds: number | null;
      generation_count: number;
    }>('GET', '/model/info');

    return {
      loaded: response.loaded,
      modelPath: response.model_path,
      nGpuLayers: response.n_gpu_layers,
      nCtx: response.n_ctx,
      loadTimeSeconds: response.load_time_seconds,
      generationCount: response.generation_count,
    };
  }

  /**
   * Check whether the Python LLM server has GPU (CUDA) support.
   * Returns true only if the llama-cpp-python build includes a GPU backend.
   */
  async checkGpuStatus(): Promise<{ gpuAvailable: boolean; detail: string }> {
    const response = await this.request<{
      gpu_available: boolean;
      detail: string;
    }>('GET', '/gpu-status');

    return {
      gpuAvailable: response.gpu_available,
      detail: response.detail,
    };
  }
}
