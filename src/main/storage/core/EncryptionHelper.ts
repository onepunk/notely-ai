/**
 * EncryptionHelper - Centralized encryption operations for sensitive data
 *
 * Core crypto operations (AES-GCM, PBKDF2, hashing, HMAC) are delegated to the
 * native addon (notely-native). The native addon is REQUIRED - the app cannot
 * function without it.
 */

import crypto from 'node:crypto';

// Native addon is required - app cannot run without it
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const native: typeof import('../../../../native/index') = require('notely-native');

export type EncryptionResult = {
  cipher: Buffer;
  iv: Buffer; // 12-byte IV (DB columns still named *_nonce for compatibility)
  tag: Buffer;
};

export type DecryptionInput = {
  cipher: Buffer;
  iv: Buffer;
  tag: Buffer;
};

export class EncryptionHelper {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly IV_LENGTH = 12; // 96 bits (recommended for GCM)
  private static readonly TAG_LENGTH = 16; // 128 bits

  /**
   * Encrypt data using AES-256-GCM
   */
  encryptAesGcm(key: Buffer, data: string): EncryptionResult {
    if (key.length !== EncryptionHelper.KEY_LENGTH) {
      throw new Error(`Key must be ${EncryptionHelper.KEY_LENGTH} bytes long`);
    }

    return native.encryptAesGcm(key, data);
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  decryptAesGcm(key: Buffer, input: DecryptionInput): string {
    if (key.length !== EncryptionHelper.KEY_LENGTH) {
      throw new Error(`Key must be ${EncryptionHelper.KEY_LENGTH} bytes long`);
    }

    return native.decryptAesGcm(key, input.cipher, input.iv, input.tag);
  }

  /**
   * Legacy decrypt for v1 records created before IV-based implementation.
   * Uses deprecated createDecipher with AAD bound to stored nonce.
   * Note: This cannot use the native addon because it depends on Node.js deprecated API.
   */
  decryptAesGcmLegacyV1(key: Buffer, input: DecryptionInput): string {
    if (key.length !== EncryptionHelper.KEY_LENGTH) {
      throw new Error(`Key must be ${EncryptionHelper.KEY_LENGTH} bytes long`);
    }

    // Deprecated API path to maintain backward compatibility
    const decipher = crypto.createDecipher(EncryptionHelper.ALGORITHM, key);
    decipher.setAAD(input.iv);
    decipher.setAuthTag(input.tag);

    let decrypted = decipher.update(input.cipher, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Generate a secure hash for data integrity
   */
  generateHash(data: string, algorithm: 'sha256' | 'sha512' = 'sha256'): string {
    return native.generateHash(data, algorithm);
  }

  /**
   * Verify hash integrity
   */
  verifyHash(data: string, hash: string, algorithm: 'sha256' | 'sha512' = 'sha256'): boolean {
    const computedHash = this.generateHash(data, algorithm);
    return this.secureCompare(hash, computedHash);
  }

  /**
   * Count words and characters in text (utility for transcriptions)
   */
  countWords(text: string): { chars: number; words: number } {
    const chars = text.length;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    return { chars, words };
  }

  /**
   * Generate a secure random ID
   */
  generateId(): string {
    return native.generateId();
  }

  /**
   * Generate a secure random key
   */
  generateKey(length: number = EncryptionHelper.KEY_LENGTH): Buffer {
    return native.randomBytes(length);
  }

  /**
   * Derive key from password using PBKDF2
   */
  deriveKeyFromPassword(
    password: string,
    salt: string | Buffer,
    iterations: number = 100000
  ): Buffer {
    const saltBuffer = typeof salt === 'string' ? Buffer.from(salt) : salt;
    // Note: This is the synchronous version. The native addon provides an async version
    // via deriveKeyFromPassword() which returns a Promise. For backward compatibility,
    // the sync Node.js API is kept here.
    return crypto.pbkdf2Sync(
      password,
      saltBuffer,
      iterations,
      EncryptionHelper.KEY_LENGTH,
      'sha512'
    );
  }

  /**
   * Generate a random salt for password derivation
   */
  generateSalt(length: number = 16): Buffer {
    return native.randomBytes(length);
  }

  /**
   * Secure comparison of two strings (timing attack resistant)
   */
  secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return native.secureCompare(a, b);
  }

  /**
   * Generate HMAC for message authentication
   */
  generateHmac(key: Buffer, data: string, algorithm: 'sha256' | 'sha512' = 'sha256'): string {
    return native.generateHmac(key, data, algorithm);
  }

  /**
   * Verify HMAC
   */
  verifyHmac(
    key: Buffer,
    data: string,
    hmac: string,
    algorithm: 'sha256' | 'sha512' = 'sha256'
  ): boolean {
    const computedHmac = this.generateHmac(key, data, algorithm);
    return this.secureCompare(hmac, computedHmac);
  }

  /**
   * Encrypt multiple fields in an object
   */
  async encryptFields(
    key: Buffer,
    data: Record<string, unknown>,
    fieldsToEncrypt: string[]
  ): Promise<Record<string, unknown>> {
    const result = { ...data };

    for (const field of fieldsToEncrypt) {
      if (field in result && typeof result[field] === 'string') {
        const encrypted = this.encryptAesGcm(key, result[field] as string);
        result[`${field}_cipher`] = encrypted.cipher;
        result[`${field}_nonce`] = encrypted.iv;
        result[`${field}_tag`] = encrypted.tag;
        delete result[field]; // Remove plaintext
      }
    }

    return result;
  }

  /**
   * Decrypt multiple fields in an object
   */
  async decryptFields(
    key: Buffer,
    data: Record<string, unknown>,
    fieldsToDecrypt: string[]
  ): Promise<Record<string, unknown>> {
    const result = { ...data };

    for (const field of fieldsToDecrypt) {
      const cipherField = `${field}_cipher`;
      const nonceField = `${field}_nonce`;
      const tagField = `${field}_tag`;

      if (cipherField in result && nonceField in result && tagField in result) {
        const decrypted = this.decryptAesGcm(key, {
          cipher: result[cipherField] as Buffer,
          iv: result[nonceField] as Buffer,
          tag: result[tagField] as Buffer,
        });

        result[field] = decrypted;
        delete result[cipherField];
        delete result[nonceField];
        delete result[tagField];
      }
    }

    return result;
  }
}
