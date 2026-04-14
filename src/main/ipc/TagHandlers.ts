import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';

import { IPC } from '../../shared/ipc-channels';
import { logger } from '../logger';
import { type IStorageService } from '../storage/index';

// Validation Schemas
const CreateTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

const UpdateTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
});

const TagIdSchema = z.object({
  id: z.string().min(1),
});

const ReorderTagsSchema = z.object({
  ids: z.array(z.string().min(1)),
});

const NoteTagSchema = z.object({
  noteId: z.string().min(1),
  tagId: z.string().min(1),
});

const SetNoteTagsSchema = z.object({
  noteId: z.string().min(1),
  tagIds: z.array(z.string().min(1)),
});

const NoteIdSchema = z.object({
  noteId: z.string().min(1),
});

const TagIdParamSchema = z.object({
  tagId: z.string().min(1),
});

export interface TagHandlersDependencies {
  storage: IStorageService;
  mainWindow: BrowserWindow | null;
  /** Callback to notify when local data changes (triggers debounced sync) */
  onLocalChange?: () => void;
}

/**
 * TagHandlers manages all IPC handlers related to tags and note-tag associations.
 * This includes CRUD operations for tags and associating tags with notes.
 */
export class TagHandlers {
  constructor(private deps: TagHandlersDependencies) {}

  /**
   * Broadcast an event to the renderer
   */
  private broadcast(channel: string): void {
    if (!this.deps.mainWindow) {
      return;
    }
    try {
      this.deps.mainWindow.webContents.send(channel);
    } catch (error) {
      logger.warn('TagHandlers: Failed to broadcast event', {
        channel,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Notify renderer and trigger debounced sync for local changes
   */
  private notifyDataChanged(): void {
    this.broadcast(IPC.EVT_TAGS_CHANGED);
    // Trigger debounced sync to push changes to server
    this.deps.onLocalChange?.();
  }

  /**
   * Register all tag-related IPC handlers
   */
  register(): void {
    logger.info('TagHandlers: Registering IPC handlers');

    // CRUD handlers
    ipcMain.handle(IPC.TAGS_CREATE, this.handleCreate.bind(this));
    ipcMain.handle(IPC.TAGS_LIST, this.handleList.bind(this));
    ipcMain.handle(IPC.TAGS_GET, this.handleGet.bind(this));
    ipcMain.handle(IPC.TAGS_UPDATE, this.handleUpdate.bind(this));
    ipcMain.handle(IPC.TAGS_DELETE, this.handleDelete.bind(this));
    ipcMain.handle(IPC.TAGS_REORDER, this.handleReorder.bind(this));

    // Note-Tag association handlers
    ipcMain.handle(IPC.TAGS_ADD_TO_NOTE, this.handleAddToNote.bind(this));
    ipcMain.handle(IPC.TAGS_REMOVE_FROM_NOTE, this.handleRemoveFromNote.bind(this));
    ipcMain.handle(IPC.TAGS_SET_NOTE_TAGS, this.handleSetNoteTags.bind(this));
    ipcMain.handle(IPC.TAGS_GET_BY_NOTE, this.handleGetByNote.bind(this));
    ipcMain.handle(IPC.TAGS_GET_NOTES_BY_TAG, this.handleGetNotesByTag.bind(this));

    logger.info('TagHandlers: All handlers registered successfully');
  }

  // ============================================
  // CRUD Handlers
  // ============================================

  private async handleCreate(_event: Electron.IpcMainInvokeEvent, input: unknown): Promise<string> {
    try {
      const { name, color } = CreateTagSchema.parse(input);
      logger.debug('TagHandlers: Creating tag');

      const tagId = await this.deps.storage.tags.create({ name, color });

      this.notifyDataChanged();
      logger.debug('TagHandlers: Tag created', { tagId });
      return tagId;
    } catch (error) {
      logger.error('TagHandlers: Failed to create tag', {
        error: error instanceof Error ? error.message : error,
        input,
      });
      throw error;
    }
  }

  private async handleList(): Promise<unknown[]> {
    try {
      logger.debug('TagHandlers: Listing tags');
      const tags = await this.deps.storage.tags.list();
      return tags;
    } catch (error) {
      logger.error('TagHandlers: Failed to list tags', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  private async handleGet(_event: Electron.IpcMainInvokeEvent, input: unknown): Promise<unknown> {
    try {
      const { id } = TagIdSchema.parse(input);
      logger.debug('TagHandlers: Getting tag', { id });
      return await this.deps.storage.tags.get(id);
    } catch (error) {
      logger.error('TagHandlers: Failed to get tag', {
        error: error instanceof Error ? error.message : error,
        input,
      });
      throw error;
    }
  }

  private async handleUpdate(_event: Electron.IpcMainInvokeEvent, input: unknown): Promise<void> {
    try {
      const data = UpdateTagSchema.parse(input);
      logger.debug('TagHandlers: Updating tag', { id: data.id });

      await this.deps.storage.tags.update({ id: data.id, name: data.name, color: data.color });

      this.notifyDataChanged();
      logger.debug('TagHandlers: Tag updated', { id: data.id });
    } catch (error) {
      logger.error('TagHandlers: Failed to update tag', {
        error: error instanceof Error ? error.message : error,
        input,
      });
      throw error;
    }
  }

  private async handleDelete(_event: Electron.IpcMainInvokeEvent, input: unknown): Promise<void> {
    try {
      const { id } = TagIdSchema.parse(input);
      logger.debug('TagHandlers: Deleting tag', { id });

      await this.deps.storage.tags.delete(id);

      this.notifyDataChanged();
      this.broadcast(IPC.EVT_NOTE_TAGS_CHANGED);
      logger.debug('TagHandlers: Tag deleted', { id });
    } catch (error) {
      logger.error('TagHandlers: Failed to delete tag', {
        error: error instanceof Error ? error.message : error,
        input,
      });
      throw error;
    }
  }

  private async handleReorder(_event: Electron.IpcMainInvokeEvent, input: unknown): Promise<void> {
    try {
      const { ids } = ReorderTagsSchema.parse(input);
      logger.debug('TagHandlers: Reordering tags', { count: ids.length });

      await this.deps.storage.tags.reorder(ids);

      this.notifyDataChanged();
      logger.debug('TagHandlers: Tags reordered');
    } catch (error) {
      logger.error('TagHandlers: Failed to reorder tags', {
        error: error instanceof Error ? error.message : error,
        input,
      });
      throw error;
    }
  }

  // ============================================
  // Note-Tag Association Handlers
  // ============================================

  private async handleAddToNote(
    _event: Electron.IpcMainInvokeEvent,
    input: unknown
  ): Promise<string> {
    try {
      const { noteId, tagId } = NoteTagSchema.parse(input);
      logger.debug('TagHandlers: Adding tag to note', { noteId, tagId });

      const noteTagId = await this.deps.storage.tags.addToNote(noteId, tagId);

      this.broadcast(IPC.EVT_NOTE_TAGS_CHANGED);
      this.deps.onLocalChange?.();
      logger.debug('TagHandlers: Tag added to note', { noteTagId });
      return noteTagId;
    } catch (error) {
      logger.error('TagHandlers: Failed to add tag to note', {
        error: error instanceof Error ? error.message : error,
        input,
      });
      throw error;
    }
  }

  private async handleRemoveFromNote(
    _event: Electron.IpcMainInvokeEvent,
    input: unknown
  ): Promise<void> {
    try {
      const { noteId, tagId } = NoteTagSchema.parse(input);
      logger.debug('TagHandlers: Removing tag from note', { noteId, tagId });

      await this.deps.storage.tags.removeFromNote(noteId, tagId);

      this.broadcast(IPC.EVT_NOTE_TAGS_CHANGED);
      this.deps.onLocalChange?.();
      logger.debug('TagHandlers: Tag removed from note');
    } catch (error) {
      logger.error('TagHandlers: Failed to remove tag from note', {
        error: error instanceof Error ? error.message : error,
        input,
      });
      throw error;
    }
  }

  private async handleSetNoteTags(
    _event: Electron.IpcMainInvokeEvent,
    input: unknown
  ): Promise<void> {
    try {
      const { noteId, tagIds } = SetNoteTagsSchema.parse(input);
      logger.debug('TagHandlers: Setting note tags', { noteId, count: tagIds.length });

      await this.deps.storage.tags.setNoteTags(noteId, tagIds);

      this.broadcast(IPC.EVT_NOTE_TAGS_CHANGED);
      this.deps.onLocalChange?.();
      logger.debug('TagHandlers: Note tags set');
    } catch (error) {
      logger.error('TagHandlers: Failed to set note tags', {
        error: error instanceof Error ? error.message : error,
        input,
      });
      throw error;
    }
  }

  private async handleGetByNote(
    _event: Electron.IpcMainInvokeEvent,
    input: unknown
  ): Promise<unknown[]> {
    try {
      const { noteId } = NoteIdSchema.parse(input);
      logger.debug('TagHandlers: Getting tags by note', { noteId });
      return await this.deps.storage.tags.getTagsByNote(noteId);
    } catch (error) {
      logger.error('TagHandlers: Failed to get tags by note', {
        error: error instanceof Error ? error.message : error,
        input,
      });
      throw error;
    }
  }

  private async handleGetNotesByTag(
    _event: Electron.IpcMainInvokeEvent,
    input: unknown
  ): Promise<unknown[]> {
    try {
      const { tagId } = TagIdParamSchema.parse(input);
      logger.debug('TagHandlers: Getting notes by tag', { tagId });
      return await this.deps.storage.tags.getNotesByTag(tagId);
    } catch (error) {
      logger.error('TagHandlers: Failed to get notes by tag', {
        error: error instanceof Error ? error.message : error,
        input,
      });
      throw error;
    }
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(): void {
    logger.info('TagHandlers: Cleaning up IPC handlers');

    const handlers = [
      IPC.TAGS_CREATE,
      IPC.TAGS_LIST,
      IPC.TAGS_GET,
      IPC.TAGS_UPDATE,
      IPC.TAGS_DELETE,
      IPC.TAGS_REORDER,
      IPC.TAGS_ADD_TO_NOTE,
      IPC.TAGS_REMOVE_FROM_NOTE,
      IPC.TAGS_SET_NOTE_TAGS,
      IPC.TAGS_GET_BY_NOTE,
      IPC.TAGS_GET_NOTES_BY_TAG,
    ];

    handlers.forEach((handler) => {
      try {
        ipcMain.removeHandler(handler);
      } catch (error) {
        logger.warn('TagHandlers: Failed to remove handler', {
          handler,
          error: error instanceof Error ? error.message : error,
        });
      }
    });

    logger.info('TagHandlers: IPC handlers cleaned up successfully');
  }
}
