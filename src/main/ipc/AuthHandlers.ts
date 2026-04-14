import { ipcMain } from 'electron';

import { IPC } from '../../shared/ipc-channels';
import { type IAuthService } from '../auth';
import { logger } from '../logger';
import { AuthManager } from '../managers/AuthManager';

type AuthHandlersDependencies = {
  authService: IAuthService;
  authManager?: AuthManager | null;
  onLogout?: () => Promise<void>;
};

export class AuthHandlers {
  constructor(private deps: AuthHandlersDependencies) {}

  register(): void {
    logger.info('AuthHandlers: Registering IPC handlers');

    ipcMain.handle(IPC.AUTH_GET_STATUS, async () => {
      const status = await this.deps.authService.getAuthStatus();
      return {
        ...status,
        tokenExpiresAt: status.tokenExpiresAt ? status.tokenExpiresAt.toISOString() : null,
      };
    });

    ipcMain.handle(IPC.AUTH_LINK_ACCOUNT, async () => {
      try {
        return await this.deps.authService.linkAccount();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('AuthHandlers: linkAccount failed', { error: message });
        return { success: false, error: message };
      }
    });

    ipcMain.handle(IPC.AUTH_LOGOUT, async () => {
      const result = await this.deps.authService.logout();
      if (result.success) {
        try {
          await this.deps.onLogout?.();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn('AuthHandlers: Logout cleanup failed', { error: message });
        }
      }
      return result;
    });

    ipcMain.handle(IPC.AUTH_START_WEB_LOGIN, async () => {
      if (!this.deps.authManager) {
        return false;
      }
      return await this.deps.authManager.startWebLogin();
    });

    ipcMain.handle(IPC.AUTH_BEGIN_MICROSOFT_LOGIN, async () => {
      if (!this.deps.authManager) {
        return { success: false, error: 'Authentication manager unavailable' };
      }
      return await this.deps.authManager.beginMicrosoftLogin();
    });

    ipcMain.handle(
      IPC.AUTH_PASSWORD_LOGIN,
      async (_event: Electron.IpcMainInvokeEvent, email: string, password: string) => {
        if (!this.deps.authManager) {
          return { success: false, error: 'Authentication manager unavailable' };
        }
        return await this.deps.authManager.loginWithPassword(email, password);
      }
    );
  }
}
