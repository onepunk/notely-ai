/**
 * HuggingFace Authentication
 *
 * Manages HuggingFace API tokens for downloading gated models.
 * Uses Electron's safeStorage for secure token storage.
 */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { app, safeStorage } from 'electron';

import { logger } from '../../logger';

import type { HuggingFaceUserInfo, TokenValidationResult } from './types';

/**
 * Storage key for the encrypted token
 */
const TOKEN_FILE_NAME = '.hf_token';

/**
 * HuggingFace Authentication Manager
 */
export class HuggingFaceAuth {
  private static instance: HuggingFaceAuth | null = null;
  private cachedToken: string | null = null;
  private cachedUserInfo: HuggingFaceUserInfo | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): HuggingFaceAuth {
    if (!HuggingFaceAuth.instance) {
      HuggingFaceAuth.instance = new HuggingFaceAuth();
    }
    return HuggingFaceAuth.instance;
  }

  /**
   * Get the path to the token file
   */
  private getTokenPath(): string {
    return path.join(app.getPath('userData'), TOKEN_FILE_NAME);
  }

  /**
   * Check if encryption is available
   */
  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /**
   * Store a HuggingFace token securely
   */
  async setToken(token: string): Promise<void> {
    if (!token || !token.trim()) {
      throw new Error('Token cannot be empty');
    }

    const trimmedToken = token.trim();

    // Validate token before storing
    const validation = await this.validateToken(trimmedToken);
    if (!validation.valid) {
      throw new Error(validation.error ?? 'Invalid token');
    }

    // Store the token
    const tokenPath = this.getTokenPath();

    if (this.isEncryptionAvailable()) {
      // Use Electron's safeStorage for encryption
      const encrypted = safeStorage.encryptString(trimmedToken);
      fs.writeFileSync(tokenPath, encrypted);
    } else {
      // Fallback: Base64 encode (not secure, but better than plaintext)
      logger.warn('HuggingFaceAuth: Encryption not available, using fallback storage');
      const encoded = Buffer.from(trimmedToken).toString('base64');
      fs.writeFileSync(tokenPath, encoded, 'utf-8');
    }

    // Update cache
    this.cachedToken = trimmedToken;
    this.cachedUserInfo = validation.user ?? null;

    logger.info('HuggingFaceAuth: Token stored successfully', {
      user: validation.user?.name,
    });
  }

  /**
   * Retrieve the stored token
   */
  async getToken(): Promise<string | null> {
    // Return cached token if available
    if (this.cachedToken) {
      return this.cachedToken;
    }

    const tokenPath = this.getTokenPath();

    if (!fs.existsSync(tokenPath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(tokenPath);

      let token: string;
      if (this.isEncryptionAvailable()) {
        // Decrypt using safeStorage
        token = safeStorage.decryptString(data);
      } else {
        // Fallback: Base64 decode
        token = Buffer.from(data.toString('utf-8'), 'base64').toString('utf-8');
      }

      this.cachedToken = token;
      return token;
    } catch (error) {
      logger.error('HuggingFaceAuth: Failed to read token', {
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Clear the stored token
   */
  async clearToken(): Promise<void> {
    const tokenPath = this.getTokenPath();

    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
    }

    this.cachedToken = null;
    this.cachedUserInfo = null;

    logger.info('HuggingFaceAuth: Token cleared');
  }

  /**
   * Check if a token is stored
   */
  hasToken(): boolean {
    return fs.existsSync(this.getTokenPath());
  }

  /**
   * Validate a token against the HuggingFace API
   */
  async validateToken(token: string): Promise<TokenValidationResult> {
    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'huggingface.co',
          path: '/api/whoami-v2',
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'Notely-Standalone/1.0',
          },
          timeout: 10000,
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => (data += chunk));

          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const userInfo = JSON.parse(data) as HuggingFaceUserInfo;
                resolve({
                  valid: true,
                  user: userInfo,
                });
              } catch {
                resolve({
                  valid: false,
                  error: 'Failed to parse API response',
                });
              }
            } else if (res.statusCode === 401) {
              resolve({
                valid: false,
                error: 'Invalid or expired token',
              });
            } else {
              resolve({
                valid: false,
                error: `API returned status ${res.statusCode}`,
              });
            }
          });
        }
      );

      req.on('error', (error) => {
        resolve({
          valid: false,
          error: `Network error: ${error.message}`,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          valid: false,
          error: 'Request timeout',
        });
      });

      req.end();
    });
  }

  /**
   * Get cached user info (if token was validated)
   */
  getCachedUserInfo(): HuggingFaceUserInfo | null {
    return this.cachedUserInfo;
  }

  /**
   * Validate the stored token and get user info
   */
  async validateStoredToken(): Promise<TokenValidationResult> {
    const token = await this.getToken();

    if (!token) {
      return {
        valid: false,
        error: 'No token stored',
      };
    }

    const result = await this.validateToken(token);

    if (result.valid) {
      this.cachedUserInfo = result.user ?? null;
    } else {
      this.cachedUserInfo = null;
    }

    return result;
  }

  /**
   * Check if the user has access to a specific model
   *
   * Note: This is a best-effort check. The actual access is verified
   * during download. This method checks if the token appears valid
   * and if gated model access might be available.
   */
  async checkModelAccess(_repoId: string): Promise<boolean> {
    const token = await this.getToken();

    if (!token) {
      return false;
    }

    // For now, just validate the token exists and is valid
    // Full model access check would require checking the specific repo
    const validation = await this.validateToken(token);
    return validation.valid;
  }

  /**
   * Get a token for use in downloads
   * Returns null if no valid token is available
   */
  async getTokenForDownload(): Promise<string | null> {
    const token = await this.getToken();

    if (!token) {
      return null;
    }

    // Optionally re-validate before use
    // For performance, we skip this and rely on download errors
    return token;
  }
}

/**
 * Convenience function to get the auth instance
 */
export function getHuggingFaceAuth(): HuggingFaceAuth {
  return HuggingFaceAuth.getInstance();
}
