import { randomUUID } from 'crypto';

import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';

import { IPC } from '../../shared/ipc-channels';
import { logger } from '../logger';
import { LLMServerManager } from '../services/llm/LLMServerManager';
import { type IStorageService } from '../storage/index';

// Validation schemas
const GenerateSummarySchema = z.object({
  transcriptionId: z.string().min(1),
  summaryType: z.string().optional().default('full'),
  forceRegenerate: z.boolean().optional().default(false),
});

const GetSummarySchema = z.object({
  summaryId: z.string().min(1),
});

const GetSummariesByTranscriptionSchema = z.object({
  transcriptionId: z.string().min(1),
});

const DeleteSummarySchema = z.object({
  summaryId: z.string().min(1),
});

const UpdateSummaryTextSchema = z.object({
  summaryId: z.string().min(1),
  summaryText: z.string().min(1),
});

// Entity types for summaries
export interface AISummary {
  id: string;
  transcriptionId: string;
  summaryText: string;
  summaryType: string;
  processingTimeMs?: number;
  modelUsed?: string;
  backendType?: string;
  pipelineUsed?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SummaryHandlersDependencies {
  storage: IStorageService;
  llmServerManager?: LLMServerManager;
  mainWindow?: BrowserWindow | null;
}

/**
 * SummaryHandlers manages all IPC handlers related to AI summary operations.
 * This includes generating summaries from transcriptions, retrieving existing summaries,
 * and managing summary data.
 *
 * STANDALONE MODE: Summaries are generated locally using the LLM server.
 * No cloud sync or API calls are made.
 */
export class SummaryHandlers {
  constructor(private deps: SummaryHandlersDependencies) {}

  /**
   * Update the LLM server manager reference
   */
  setLLMServerManager(llmServerManager: LLMServerManager): void {
    this.deps.llmServerManager = llmServerManager;
  }

  /**
   * Update the main window reference
   */
  updateMainWindow(mainWindow: BrowserWindow | null): void {
    this.deps.mainWindow = mainWindow;
  }

  /**
   * Send notification to renderer
   */
  private sendNotification(notification: {
    id: string;
    type: 'summary-started' | 'summary-completed' | 'summary-failed';
    title: string;
    message: string;
    jobId?: string;
    summaryId?: string;
    transcriptionId?: string;
    timestamp: Date;
  }): void {
    if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
      this.deps.mainWindow.webContents.send(IPC.EVT_SUMMARY_NOTIFICATION, notification);
    }
  }

  /**
   * Register all summary-related IPC handlers
   */
  register(): void {
    logger.info('SummaryHandlers: Registering IPC handlers');

    ipcMain.handle(IPC.SUMMARY_GENERATE, this.handleGenerateSummary.bind(this));
    ipcMain.handle(IPC.SUMMARY_GET, this.handleGetSummary.bind(this));
    ipcMain.handle(
      IPC.SUMMARY_GET_BY_TRANSCRIPTION,
      this.handleGetSummariesByTranscription.bind(this)
    );
    ipcMain.handle(IPC.SUMMARY_DELETE, this.handleDeleteSummary.bind(this));
    ipcMain.handle(IPC.SUMMARY_LIST, this.handleListSummaries.bind(this));
    ipcMain.handle(IPC.SUMMARY_CHECK_SERVER_EXISTS, this.handleCheckServerSummaryExists.bind(this));
    ipcMain.handle(IPC.SUMMARY_UPDATE_TEXT, this.handleUpdateSummaryText.bind(this));

    logger.info('SummaryHandlers: All handlers registered successfully');
  }

  /**
   * Generate a new summary from a transcription using local LLM
   *
   * STANDALONE MODE: Uses LLMServerManager for local inference.
   */
  private async handleGenerateSummary(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; summary?: AISummary; error?: string }> {
    const jobId = randomUUID();

    try {
      const validated = GenerateSummarySchema.parse(request);
      logger.info('SummaryHandlers: Generating summary (standalone mode)', {
        transcriptionId: validated.transcriptionId,
        summaryType: validated.summaryType,
        forceRegenerate: validated.forceRegenerate,
        jobId,
      });

      // Check if LLM server manager is available
      if (!this.deps.llmServerManager) {
        logger.error('SummaryHandlers: LLM server manager not available');
        return { success: false, error: 'LLM service not initialized' };
      }

      // Check if a model is loaded
      if (!this.deps.llmServerManager.isReady()) {
        logger.warn('SummaryHandlers: No model loaded');
        return { success: false, error: 'NO_MODEL_LOADED' };
      }

      // Fetch transcription text from local storage
      let transcriptionText: string;
      try {
        let transcriptionResult = await this.deps.storage.transcriptions.getSession(
          validated.transcriptionId
        );
        transcriptionText = transcriptionResult.fullText;

        // Retry once after short delay if text appears empty (WAL sync safety)
        if (!transcriptionText || transcriptionText.trim().length === 0) {
          logger.warn('SummaryHandlers: Text empty on first read, retrying after delay', {
            transcriptionId: validated.transcriptionId,
          });
          await new Promise((resolve) => setTimeout(resolve, 100));
          transcriptionResult = await this.deps.storage.transcriptions.getSession(
            validated.transcriptionId
          );
          transcriptionText = transcriptionResult.fullText;
        }

        if (!transcriptionText || transcriptionText.trim().length === 0) {
          return { success: false, error: 'Transcription has no text to summarize' };
        }
      } catch (e) {
        logger.error('SummaryHandlers: Failed to get transcription text', {
          transcriptionId: validated.transcriptionId,
          error: e instanceof Error ? e.message : e,
        });
        return { success: false, error: 'Failed to get transcription text' };
      }

      // Send notification that summary generation has started
      this.sendNotification({
        id: randomUUID(),
        type: 'summary-started',
        title: 'Generating Summary',
        message: 'AI is analyzing your transcription...',
        jobId,
        transcriptionId: validated.transcriptionId,
        timestamp: new Date(),
      });

      logger.info('SummaryHandlers: Generating summary with local LLM', {
        transcriptionId: validated.transcriptionId,
        textLength: transcriptionText.length,
        summaryType: validated.summaryType,
      });

      const startTime = Date.now();

      // Read active prompt template from DB
      let systemPrompt: string | undefined;
      let promptTemplates: Record<string, string> | undefined;
      const activeTemplateId = await this.deps.storage.settings.get('llm.activePromptTemplateId');
      const templateId = activeTemplateId || 'default';
      const db = this.deps.storage.database.getDatabase();
      const row = db
        .prepare('SELECT system_prompt, output_structure FROM prompt_templates WHERE id = ?')
        .get(templateId) as { system_prompt: string; output_structure: string } | undefined;

      if (row?.system_prompt) {
        systemPrompt = row.system_prompt;
      }
      if (row?.output_structure && row.output_structure !== '{}') {
        try {
          promptTemplates = JSON.parse(row.output_structure);
        } catch {
          // Ignore malformed JSON — treated as missing
        }
      }

      if (!systemPrompt || !promptTemplates) {
        logger.error('SummaryHandlers: Prompt template not found in database');
        return {
          success: false,
          error: 'Prompt template not found. Please reinstall or reset the application.',
        };
      }

      // Read model generation parameters from settings
      let temperatureExtract: number | undefined;
      let temperatureRefine: number | undefined;
      let topP: number | undefined;
      let maxTokens: number | undefined;
      try {
        const tExtract = await this.deps.storage.settings.get('llm.temperatureExtract');
        const tRefine = await this.deps.storage.settings.get('llm.temperatureRefine');
        const tTopP = await this.deps.storage.settings.get('llm.topP');
        const tMaxTokens = await this.deps.storage.settings.get('llm.maxTokens');

        if (tExtract) temperatureExtract = parseFloat(tExtract);
        if (tRefine) temperatureRefine = parseFloat(tRefine);
        if (tTopP) topP = parseFloat(tTopP);
        if (tMaxTokens) maxTokens = parseInt(tMaxTokens, 10);
      } catch (e) {
        logger.warn('SummaryHandlers: Failed to read model parameters, using pipeline defaults', {
          error: e instanceof Error ? e.message : e,
        });
      }

      // Generate summary using local LLM
      const response = await this.deps.llmServerManager.generateSummary({
        text: transcriptionText,
        analysisType: validated.summaryType,
        systemPrompt,
        promptTemplates,
        temperatureExtract,
        temperatureRefine,
        topP,
        maxTokens,
      });

      const processingTimeMs = Date.now() - startTime;

      // Create summary record
      const summaryId = randomUUID();
      const now = new Date();

      // Serialize the structured result as JSON matching the StructuredSummaryV1
      // schema so the SummaryRenderer can use the rich StructuredSummaryV1Renderer.
      let summaryText: string;
      if (response.resultIsText) {
        summaryText = response.result as unknown as string;
      } else {
        const result = response.result;

        // Map pipeline key_points → topics_highlights with typed entries
        const topicsHighlights = (result.keyPoints ?? []).map(
          (kp: { topic: string; summary: string; participants?: string[] }) => ({
            title: kp.topic,
            entries: [
              {
                type: 'Key Point',
                text: kp.summary,
                owner: null,
                due_date: null,
              },
            ],
          })
        );

        // Map pipeline action_items → next_steps
        const nextSteps = (result.actionItems ?? []).map(
          (ai: { text: string; owner?: string | null; dueDate?: string | null }) => ({
            text: ai.text,
            owner: ai.owner ?? null,
            due_date: ai.dueDate ?? null,
          })
        );

        // The LLM sometimes returns the summary field as a JSON string (or even
        // multiple concatenated JSON objects) instead of plain narrative text.
        // It may also wrap JSON inside markdown fences or prepend preamble text.
        // Extract the executive_summary value to store clean narrative text.
        let summaryNarrative = result.summary ?? '';

        // Strip markdown code fences if present (e.g. "Here is...\n```json\n{...}\n```")
        if (summaryNarrative.includes('```')) {
          const fencedMatch = summaryNarrative.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fencedMatch) {
            const fencedContent = fencedMatch[1].trim();
            // If the fenced content is JSON, extract narrative fields from it
            if (fencedContent.startsWith('{')) {
              try {
                const parsed = JSON.parse(fencedContent);
                if (parsed && typeof parsed === 'object') {
                  const extracted =
                    parsed['Executive Summary'] ||
                    parsed.executive_summary ||
                    parsed.summary ||
                    parsed.title;
                  if (extracted) {
                    summaryNarrative = extracted;
                  }
                }
              } catch {
                // Fenced content isn't valid JSON — fall through to other checks
              }
            }
          }
        }

        if (typeof summaryNarrative === 'string' && summaryNarrative.trimStart().startsWith('{')) {
          // Try full JSON.parse first (works when it's a single valid JSON object)
          let extracted = false;
          try {
            const parsed = JSON.parse(summaryNarrative);
            if (parsed && typeof parsed === 'object') {
              summaryNarrative =
                parsed['Executive Summary'] ||
                parsed.executive_summary ||
                parsed.summary ||
                parsed.title ||
                summaryNarrative;
              extracted = true;
            }
          } catch {
            // Not valid JSON (e.g. multiple concatenated objects) — use regex fallback
          }
          if (!extracted) {
            const execMatch = summaryNarrative.match(
              /"(?:executive_summary|Executive Summary)"\s*:\s*"((?:[^"\\]|\\.)*)"/
            );
            if (execMatch) {
              summaryNarrative = execMatch[1]
                .replace(/\\"/g, '"')
                .replace(/\\n/g, '\n')
                .replace(/\\\\/g, '\\');
            }
          }
        }

        // Defense-in-depth: strip any HTML tags the LLM may have produced
        summaryNarrative = summaryNarrative
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();

        const participants: string[] = result.participants ?? [];

        const structured = {
          summary: summaryNarrative,
          next_steps: nextSteps,
          decisions: result.decisions ?? [],
          topics_highlights: topicsHighlights,
          participants: participants.length === 0 ? ['Unknown'] : participants,
          ai_insights: null,
          date: null,
          metadata: null,
        };

        summaryText = JSON.stringify(structured);
      }

      const summary: AISummary = {
        id: summaryId,
        transcriptionId: validated.transcriptionId,
        summaryText,
        summaryType: validated.summaryType,
        processingTimeMs,
        modelUsed: response.backend,
        backendType: 'llama-cpp',
        pipelineUsed: true,
        createdAt: now,
        updatedAt: now,
      };

      // Store summary locally
      await this.storeSummaryLocally(summary);

      // Send success notification
      this.sendNotification({
        id: randomUUID(),
        type: 'summary-completed',
        title: 'Summary Complete',
        message: 'Your meeting summary is ready.',
        jobId,
        summaryId: summary.id,
        transcriptionId: validated.transcriptionId,
        timestamp: new Date(),
      });

      logger.info('SummaryHandlers: Summary generated successfully (standalone mode)', {
        summaryId: summary.id,
        processingTimeMs,
      });

      return { success: true, summary };
    } catch (error) {
      logger.error('SummaryHandlers: Failed to generate summary', {
        error: error instanceof Error ? error.message : error,
        jobId,
      });

      // Send failure notification
      this.sendNotification({
        id: randomUUID(),
        type: 'summary-failed',
        title: 'Summary Failed',
        message: error instanceof Error ? error.message : 'Failed to generate summary',
        jobId,
        timestamp: new Date(),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Get a specific summary by ID
   *
   * STANDALONE MODE: Only uses local storage.
   */
  private async handleGetSummary(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; summary?: AISummary; error?: string }> {
    try {
      const validated = GetSummarySchema.parse(request);
      logger.debug('SummaryHandlers: Getting summary (standalone)', {
        summaryId: validated.summaryId,
      });

      // Get from local storage only (standalone mode)
      const localSummary = await this.getSummaryFromLocal(validated.summaryId);
      if (localSummary) {
        return { success: true, summary: localSummary };
      }

      return { success: false, error: 'Summary not found' };
    } catch (error) {
      logger.error('SummaryHandlers: Failed to get summary', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Get all summaries for a transcription
   *
   * STANDALONE MODE: Only uses local storage, no server sync.
   */
  private async handleGetSummariesByTranscription(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; summaries?: AISummary[]; error?: string }> {
    try {
      const validated = GetSummariesByTranscriptionSchema.parse(request);
      logger.debug('SummaryHandlers: Getting summaries by transcription (standalone)', {
        transcriptionId: validated.transcriptionId,
      });

      // Get from local storage only (standalone mode)
      const localSummaries = await this.getSummariesByTranscriptionFromLocal(
        validated.transcriptionId
      );

      return { success: true, summaries: localSummaries };
    } catch (error) {
      logger.error('SummaryHandlers: Failed to get summaries by transcription', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Delete a summary
   *
   * STANDALONE MODE: Only deletes from local storage.
   */
  private async handleDeleteSummary(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const validated = DeleteSummarySchema.parse(request);
      logger.info('SummaryHandlers: Deleting summary (standalone)', {
        summaryId: validated.summaryId,
      });

      // Delete from local storage only (standalone mode)
      await this.deleteSummaryFromLocal(validated.summaryId);

      logger.info('SummaryHandlers: Summary deleted successfully', {
        summaryId: validated.summaryId,
      });
      return { success: true };
    } catch (error) {
      logger.error('SummaryHandlers: Failed to delete summary', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * List all summaries for current user
   */
  private async handleListSummaries(
    _event: Electron.IpcMainInvokeEvent
  ): Promise<{ success: boolean; summaries?: AISummary[]; error?: string }> {
    try {
      logger.debug('SummaryHandlers: Listing all summaries');

      // Get from local storage
      const localSummaries = await this.getAllSummariesFromLocal();

      return { success: true, summaries: localSummaries };
    } catch (error) {
      logger.error('SummaryHandlers: Failed to list summaries', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Check if a summary already exists for the given transcription
   *
   * STANDALONE MODE: Checks local storage only.
   */
  private async handleCheckServerSummaryExists(
    _event: Electron.IpcMainInvokeEvent,
    transcriptionId: string
  ): Promise<{ success: boolean; exists?: boolean; error?: string }> {
    try {
      if (!transcriptionId) {
        return { success: false, error: 'Transcription ID is required' };
      }

      logger.debug('SummaryHandlers: Checking for existing summaries (standalone)', {
        transcriptionId,
      });

      // Check local storage only (standalone mode)
      const localSummaries = await this.getSummariesByTranscriptionFromLocal(transcriptionId);
      const exists = localSummaries.length > 0;

      logger.debug('SummaryHandlers: Local summary check result', {
        transcriptionId,
        exists,
        summaryCount: localSummaries.length,
      });

      return { success: true, exists };
    } catch (error) {
      logger.error('SummaryHandlers: Failed to check for existing summaries', {
        transcriptionId,
        error: error instanceof Error ? error.message : error,
      });

      return { success: true, exists: false };
    }
  }

  /**
   * Update summary text (e.g. to persist action item checked state)
   */
  private async handleUpdateSummaryText(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const validated = UpdateSummaryTextSchema.parse(request);
      logger.debug('SummaryHandlers: Updating summary text', {
        summaryId: validated.summaryId,
      });

      await this.deps.storage.summaries.update({
        id: validated.summaryId,
        summaryText: validated.summaryText,
      });

      return { success: true };
    } catch (error) {
      logger.error('SummaryHandlers: Failed to update summary text', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Store summary in local storage
   */
  private async storeSummaryLocally(summary: AISummary): Promise<void> {
    try {
      logger.debug('SummaryHandlers: Storing summary locally', { summaryId: summary.id });

      // Upsert behavior: create if new, otherwise update existing record
      const exists = await this.deps.storage.summaries.exists(summary.id);
      if (!exists) {
        await this.deps.storage.summaries.create({
          id: summary.id,
          transcriptionId: summary.transcriptionId,
          summaryText: summary.summaryText,
          summaryType: summary.summaryType,
          processingTimeMs: summary.processingTimeMs,
          modelUsed: summary.modelUsed,
          backendType: summary.backendType,
          pipelineUsed: summary.pipelineUsed,
        });
      } else {
        await this.deps.storage.summaries.update({
          id: summary.id,
          summaryText: summary.summaryText,
          summaryType: summary.summaryType,
          processingTimeMs: summary.processingTimeMs,
          modelUsed: summary.modelUsed,
          backendType: summary.backendType,
          pipelineUsed: summary.pipelineUsed,
        });
      }

      logger.debug('SummaryHandlers: Summary stored locally successfully', {
        summaryId: summary.id,
      });
    } catch (error) {
      logger.error('SummaryHandlers: Failed to store summary locally', { error });
    }
  }

  /**
   * Get summary from local storage
   */
  private async getSummaryFromLocal(summaryId: string): Promise<AISummary | null> {
    try {
      logger.debug('SummaryHandlers: Getting summary from local storage', { summaryId });

      const summary = await this.deps.storage.summaries.get(summaryId);
      if (!summary) {
        return null;
      }

      return {
        id: summary.id,
        transcriptionId: summary.transcriptionId,
        summaryText: summary.summaryText || '',
        summaryType: summary.summaryType,
        processingTimeMs: summary.processingTimeMs,
        modelUsed: summary.modelUsed,
        backendType: summary.backendType,
        pipelineUsed: summary.pipelineUsed,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
      };
    } catch (error) {
      logger.error('SummaryHandlers: Failed to get summary from local storage', { error });
      return null;
    }
  }

  /**
   * Get summaries by transcription from local storage
   */
  private async getSummariesByTranscriptionFromLocal(
    transcriptionId: string
  ): Promise<AISummary[]> {
    try {
      logger.debug('SummaryHandlers: Getting summaries by transcription from local storage', {
        transcriptionId,
      });

      const summaries = await this.deps.storage.summaries.getByTranscriptionId(transcriptionId);

      return summaries.map((summary) => ({
        id: summary.id,
        transcriptionId: summary.transcriptionId,
        summaryText: summary.summaryText || '',
        summaryType: summary.summaryType,
        processingTimeMs: summary.processingTimeMs,
        modelUsed: summary.modelUsed,
        backendType: summary.backendType,
        pipelineUsed: summary.pipelineUsed,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
      }));
    } catch (error) {
      logger.error('SummaryHandlers: Failed to get summaries by transcription from local storage', {
        error,
      });
      return [];
    }
  }

  /**
   * Get all summaries from local storage
   */
  private async getAllSummariesFromLocal(): Promise<AISummary[]> {
    try {
      logger.debug('SummaryHandlers: Getting all summaries from local storage');

      const summaries = await this.deps.storage.summaries.getAllSummaries();

      return summaries
        .filter((summary) => !summary.deleted)
        .map((summary) => ({
          id: summary.id,
          transcriptionId: summary.transcriptionId,
          summaryText: summary.summaryText || '',
          summaryType: summary.summaryType,
          processingTimeMs: summary.processingTimeMs,
          modelUsed: summary.modelUsed,
          backendType: summary.backendType,
          pipelineUsed: summary.pipelineUsed,
          createdAt: summary.createdAt,
          updatedAt: summary.updatedAt,
        }));
    } catch (error) {
      logger.error('SummaryHandlers: Failed to get all summaries from local storage', { error });
      return [];
    }
  }

  /**
   * Delete summary from local storage
   */
  private async deleteSummaryFromLocal(summaryId: string): Promise<void> {
    try {
      logger.debug('SummaryHandlers: Deleting summary from local storage', { summaryId });

      await this.deps.storage.summaries.delete(summaryId);

      logger.debug('SummaryHandlers: Summary deleted from local storage successfully', {
        summaryId,
      });
    } catch (error) {
      logger.error('SummaryHandlers: Failed to delete summary from local storage', { error });
    }
  }

  /**
   * Cleanup handler - remove all IPC listeners
   */
  cleanup(): void {
    logger.info('SummaryHandlers: Cleaning up IPC handlers');

    // Remove all registered handlers
    ipcMain.removeAllListeners(IPC.SUMMARY_GENERATE);
    ipcMain.removeAllListeners(IPC.SUMMARY_GET);
    ipcMain.removeAllListeners(IPC.SUMMARY_GET_BY_TRANSCRIPTION);
    ipcMain.removeAllListeners(IPC.SUMMARY_DELETE);
    ipcMain.removeAllListeners(IPC.SUMMARY_LIST);
    ipcMain.removeAllListeners(IPC.SUMMARY_CHECK_SERVER_EXISTS);
    ipcMain.removeAllListeners(IPC.SUMMARY_UPDATE_TEXT);

    logger.info('SummaryHandlers: Cleanup completed');
  }
}
