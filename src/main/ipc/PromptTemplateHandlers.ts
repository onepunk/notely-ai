/**
 * Prompt Template Handlers
 *
 * IPC handlers for managing prompt templates (CRUD + active template selection).
 */

import { ipcMain } from 'electron';
import { z } from 'zod';

import { IPC } from '../../shared/ipc-channels';
import { logger } from '../logger';
import { type IStorageService } from '../storage/index';

// =============================================================================
// Validation Schemas
// =============================================================================

const CreateTemplateSchema = z.object({
  name: z.string().min(1),
  systemPrompt: z.string().optional(),
  outputStructure: z.string().optional(),
  cloneFromId: z.string().optional(),
});

const UpdateTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
  outputStructure: z.string().optional(),
});

const GetTemplateSchema = z.object({
  id: z.string().min(1),
});

const DeleteTemplateSchema = z.object({
  id: z.string().min(1),
});

const SetActiveSchema = z.object({
  id: z.string(),
});

// =============================================================================
// Types
// =============================================================================

export interface PromptTemplateHandlersDependencies {
  storage: IStorageService;
}

interface PromptTemplateRow {
  id: string;
  name: string;
  system_prompt: string;
  output_structure: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface PromptTemplate {
  id: string;
  name: string;
  systemPrompt: string;
  outputStructure: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

const ACTIVE_TEMPLATE_KEY = 'llm.activePromptTemplateId';

// =============================================================================
// Handler Class
// =============================================================================

function rowToTemplate(row: PromptTemplateRow): PromptTemplate {
  return {
    id: row.id,
    name: row.name,
    systemPrompt: row.system_prompt,
    outputStructure: row.output_structure,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PromptTemplateHandlers {
  private deps: PromptTemplateHandlersDependencies;

  constructor(deps: PromptTemplateHandlersDependencies) {
    this.deps = deps;
  }

  register(): void {
    logger.info('PromptTemplateHandlers: Registering IPC handlers');

    ipcMain.handle(IPC.PROMPT_TEMPLATES_LIST, this.handleList.bind(this));
    ipcMain.handle(IPC.PROMPT_TEMPLATES_GET, this.handleGet.bind(this));
    ipcMain.handle(IPC.PROMPT_TEMPLATES_CREATE, this.handleCreate.bind(this));
    ipcMain.handle(IPC.PROMPT_TEMPLATES_UPDATE, this.handleUpdate.bind(this));
    ipcMain.handle(IPC.PROMPT_TEMPLATES_DELETE, this.handleDelete.bind(this));
    ipcMain.handle(IPC.PROMPT_TEMPLATES_GET_ACTIVE, this.handleGetActive.bind(this));
    ipcMain.handle(IPC.PROMPT_TEMPLATES_SET_ACTIVE, this.handleSetActive.bind(this));

    logger.info('PromptTemplateHandlers: All handlers registered');
  }

  private getDb() {
    return this.deps.storage.database.getDatabase();
  }

  // ===========================================================================
  // List
  // ===========================================================================

  private async handleList(): Promise<PromptTemplate[]> {
    try {
      const db = this.getDb();
      const rows = db
        .prepare(`SELECT * FROM prompt_templates ORDER BY is_default DESC, created_at ASC`)
        .all() as PromptTemplateRow[];

      return rows.map(rowToTemplate);
    } catch (error) {
      logger.error('PromptTemplateHandlers: Failed to list templates', {
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  // ===========================================================================
  // Get
  // ===========================================================================

  private async handleGet(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<PromptTemplate | null> {
    try {
      const { id } = GetTemplateSchema.parse(request);
      const db = this.getDb();
      const row = db.prepare(`SELECT * FROM prompt_templates WHERE id = ?`).get(id) as
        | PromptTemplateRow
        | undefined;

      return row ? rowToTemplate(row) : null;
    } catch (error) {
      logger.error('PromptTemplateHandlers: Failed to get template', {
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  // ===========================================================================
  // Create
  // ===========================================================================

  private async handleCreate(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; template?: PromptTemplate; error?: string }> {
    try {
      const validated = CreateTemplateSchema.parse(request);
      const db = this.getDb();

      let systemPrompt = validated.systemPrompt ?? '';
      let outputStructure = validated.outputStructure ?? '{}';

      // Clone from existing template if requested
      if (validated.cloneFromId) {
        const source = db
          .prepare(`SELECT * FROM prompt_templates WHERE id = ?`)
          .get(validated.cloneFromId) as PromptTemplateRow | undefined;

        if (source) {
          systemPrompt = source.system_prompt;
          outputStructure = source.output_structure;
        }
      }

      const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      db.prepare(
        `INSERT INTO prompt_templates (id, name, system_prompt, output_structure, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, unixepoch(), unixepoch())`
      ).run(id, validated.name, systemPrompt, outputStructure);

      const row = db
        .prepare(`SELECT * FROM prompt_templates WHERE id = ?`)
        .get(id) as PromptTemplateRow;

      return { success: true, template: rowToTemplate(row) };
    } catch (error) {
      logger.error('PromptTemplateHandlers: Failed to create template', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  private async handleUpdate(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const validated = UpdateTemplateSchema.parse(request);
      const db = this.getDb();

      // Check if template exists and is not default
      const existing = db
        .prepare(`SELECT * FROM prompt_templates WHERE id = ?`)
        .get(validated.id) as PromptTemplateRow | undefined;

      if (!existing) {
        return { success: false, error: 'Template not found' };
      }

      if (existing.is_default === 1) {
        return { success: false, error: 'Cannot modify the default template' };
      }

      const updates: string[] = [];
      const values: unknown[] = [];

      if (validated.name !== undefined) {
        updates.push('name = ?');
        values.push(validated.name);
      }
      if (validated.systemPrompt !== undefined) {
        updates.push('system_prompt = ?');
        values.push(validated.systemPrompt);
      }
      if (validated.outputStructure !== undefined) {
        updates.push('output_structure = ?');
        values.push(validated.outputStructure);
      }

      if (updates.length === 0) {
        return { success: true };
      }

      updates.push('updated_at = unixepoch()');
      values.push(validated.id);

      db.prepare(`UPDATE prompt_templates SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      return { success: true };
    } catch (error) {
      logger.error('PromptTemplateHandlers: Failed to update template', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  private async handleDelete(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { id } = DeleteTemplateSchema.parse(request);
      const db = this.getDb();

      // Check if template exists and is not default
      const existing = db.prepare(`SELECT * FROM prompt_templates WHERE id = ?`).get(id) as
        | PromptTemplateRow
        | undefined;

      if (!existing) {
        return { success: false, error: 'Template not found' };
      }

      if (existing.is_default === 1) {
        return { success: false, error: 'Cannot delete the default template' };
      }

      // If this was the active template, reset to empty (default)
      const activeSetting = await this.deps.storage.settings.get(ACTIVE_TEMPLATE_KEY);
      if (activeSetting === id) {
        await this.deps.storage.settings.set(ACTIVE_TEMPLATE_KEY, '');
      }

      db.prepare(`DELETE FROM prompt_templates WHERE id = ?`).run(id);

      return { success: true };
    } catch (error) {
      logger.error('PromptTemplateHandlers: Failed to delete template', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ===========================================================================
  // Get Active
  // ===========================================================================

  private async handleGetActive(): Promise<string> {
    try {
      const value = await this.deps.storage.settings.get(ACTIVE_TEMPLATE_KEY);
      return value ?? '';
    } catch (error) {
      logger.error('PromptTemplateHandlers: Failed to get active template', {
        error: error instanceof Error ? error.message : error,
      });
      return '';
    }
  }

  // ===========================================================================
  // Set Active
  // ===========================================================================

  private async handleSetActive(
    _event: Electron.IpcMainInvokeEvent,
    request: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { id } = SetActiveSchema.parse(request);

      // Verify template exists if non-empty
      if (id) {
        const db = this.getDb();
        const existing = db.prepare(`SELECT id FROM prompt_templates WHERE id = ?`).get(id) as
          | { id: string }
          | undefined;

        if (!existing) {
          return { success: false, error: 'Template not found' };
        }
      }

      await this.deps.storage.settings.set(ACTIVE_TEMPLATE_KEY, id);
      return { success: true };
    } catch (error) {
      logger.error('PromptTemplateHandlers: Failed to set active template', {
        error: error instanceof Error ? error.message : error,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  cleanup(): void {
    logger.info('PromptTemplateHandlers: Cleaning up IPC handlers');

    const channels = [
      IPC.PROMPT_TEMPLATES_LIST,
      IPC.PROMPT_TEMPLATES_GET,
      IPC.PROMPT_TEMPLATES_CREATE,
      IPC.PROMPT_TEMPLATES_UPDATE,
      IPC.PROMPT_TEMPLATES_DELETE,
      IPC.PROMPT_TEMPLATES_GET_ACTIVE,
      IPC.PROMPT_TEMPLATES_SET_ACTIVE,
    ];

    for (const channel of channels) {
      ipcMain.removeAllListeners(channel);
    }

    logger.info('PromptTemplateHandlers: Cleanup completed');
  }
}
