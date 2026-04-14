import { app, ipcMain, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';

import { IPC } from '../../shared/ipc-channels';
import { logger } from '../logger';

/**
 * Builds and manages the native macOS application menu.
 * Only instantiated on darwin. Sends IPC events to the renderer
 * when custom menu items are clicked.
 */
export class MacMenuManager {
  private currentNoteId: string | null = null;

  constructor(private webContents: WebContents) {
    this.buildMenu();
    this.registerIPC();
  }

  private registerIPC(): void {
    ipcMain.on(IPC.MENU_UPDATE_STATE, (_event, state: { noteId: string | null }) => {
      if (state.noteId !== this.currentNoteId) {
        this.currentNoteId = state.noteId;
        this.buildMenu();
      }
    });
  }

  private send(channel: string, ...args: unknown[]): void {
    if (!this.webContents.isDestroyed()) {
      this.webContents.send(channel, ...args);
    }
  }

  private buildMenu(): void {
    const hasNote = this.currentNoteId !== null;

    const template: MenuItemConstructorOptions[] = [
      // ── App menu ──────────────────────────────────────────────────
      {
        label: app.name,
        submenu: [
          {
            label: 'About Notely',
            click: () => this.send(IPC.MENU_NAVIGATE, '/settings/about'),
          },
          { type: 'separator' },
          {
            label: 'Settings',
            accelerator: 'CmdOrCtrl+,',
            click: () => this.send(IPC.MENU_NAVIGATE, '/settings/general'),
          },
          {
            label: 'AI Features',
            click: () => this.send(IPC.MENU_NAVIGATE, '/ai-features/system'),
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      // ── File menu ─────────────────────────────────────────────────
      {
        label: 'File',
        submenu: [
          {
            label: 'New Note',
            accelerator: 'CmdOrCtrl+N',
            click: () => this.send(IPC.MENU_NEW_NOTE),
          },
          { type: 'separator' },
          {
            label: 'Export',
            enabled: hasNote,
            submenu: [
              {
                label: 'Plain Text (.txt)',
                enabled: hasNote,
                click: () => this.send(IPC.MENU_EXPORT, 'txt'),
              },
              {
                label: 'Markdown (.md)',
                enabled: hasNote,
                click: () => this.send(IPC.MENU_EXPORT, 'md'),
              },
              {
                label: 'Word Document (.docx)',
                enabled: hasNote,
                click: () => this.send(IPC.MENU_EXPORT, 'docx'),
              },
              {
                label: 'Rich Text (.rtf)',
                enabled: hasNote,
                click: () => this.send(IPC.MENU_EXPORT, 'rtf'),
              },
              {
                label: 'PDF (.pdf)',
                enabled: hasNote,
                click: () => this.send(IPC.MENU_EXPORT, 'pdf'),
              },
            ],
          },
        ],
      },
      // ── Edit menu (role-based for standard Cmd+C/V/X/Z/A) ────────
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      // ── View menu ─────────────────────────────────────────────────
      {
        label: 'View',
        submenu: [
          {
            label: 'Transcriptions',
            click: () => this.send(IPC.MENU_OPEN_TRANSCRIPTIONS),
          },
          { type: 'separator' },
          {
            label: 'Zoom In',
            accelerator: 'CmdOrCtrl+=',
            click: () => this.send(IPC.MENU_FONT_ZOOM_IN),
          },
          {
            label: 'Zoom Out',
            accelerator: 'CmdOrCtrl+-',
            click: () => this.send(IPC.MENU_FONT_ZOOM_OUT),
          },
          {
            label: 'Actual Size',
            accelerator: 'CmdOrCtrl+0',
            click: () => this.send(IPC.MENU_FONT_ZOOM_RESET),
          },
        ],
      },
      // ── Window menu ───────────────────────────────────────────────
      {
        label: 'Window',
        role: 'windowMenu',
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    logger.debug('MacMenuManager: Menu rebuilt', { hasNote });
  }
}
