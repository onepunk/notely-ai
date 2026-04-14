/**
 * Notely Native Addon TypeScript Definitions
 */

// --- Encryption (Phase 1) ---

export interface NativeEncryptionResult {
  cipher: Buffer;
  iv: Buffer;
  tag: Buffer;
}

/**
 * Encrypt data using AES-256-GCM via OpenSSL
 * @param key - 32-byte encryption key
 * @param data - UTF-8 string to encrypt
 * @returns Encrypted cipher, IV, and auth tag
 */
export function encryptAesGcm(key: Buffer, data: string): NativeEncryptionResult;

/**
 * Decrypt data using AES-256-GCM via OpenSSL
 * @param key - 32-byte encryption key
 * @param cipher - Encrypted ciphertext
 * @param iv - 12-byte initialization vector
 * @param tag - 16-byte authentication tag
 * @returns Decrypted UTF-8 string
 */
export function decryptAesGcm(key: Buffer, cipher: Buffer, iv: Buffer, tag: Buffer): string;

/**
 * Derive a key from password using PBKDF2-SHA512
 * @param password - User password
 * @param salt - Salt buffer
 * @param iterations - Number of iterations
 * @param keyLength - Desired key length in bytes
 * @returns Promise resolving to derived key buffer
 */
export function deriveKeyFromPassword(
  password: string,
  salt: Buffer,
  iterations: number,
  keyLength: number
): Promise<Buffer>;

/**
 * Generate a SHA-256 or SHA-512 hash
 * @param data - Data to hash
 * @param algorithm - "sha256" or "sha512"
 * @returns Hex-encoded hash string
 */
export function generateHash(data: string, algorithm: string): string;

/**
 * Generate an HMAC
 * @param key - HMAC key buffer
 * @param data - Data to authenticate
 * @param algorithm - "sha256" or "sha512"
 * @returns Hex-encoded HMAC string
 */
export function generateHmac(key: Buffer, data: string, algorithm: string): string;

/**
 * Timing-safe comparison of two strings
 * @returns true if equal
 */
export function secureCompare(a: string, b: string): boolean;

/**
 * Generate cryptographically secure random bytes
 * @param length - Number of bytes
 * @returns Buffer of random bytes
 */
export function randomBytes(length: number): Buffer;

/**
 * Generate a UUID v4
 * @returns UUID string
 */
export function generateId(): string;

// --- Certificate Pinning (Phase 2) ---

/**
 * Get SPKI pin strings for a hostname
 * @param hostname - e.g. "api.yourdomain.com"
 * @returns Array of base64-encoded SHA-256 SPKI pins
 */
export function getPinsForDomain(hostname: string): string[];

/**
 * Check if a hostname requires certificate pinning
 */
export function requiresPinning(hostname: string): boolean;

/**
 * Check if hostname + port requires pinning (only port 443)
 */
export function requiresPinningWithPort(hostname: string, port: number): boolean;

/**
 * Check if a URL requires certificate pinning
 */
export function requiresPinningForUrl(url: string): boolean;

/**
 * Compute SPKI pin from DER-encoded certificate
 * @param derCert - DER-encoded certificate buffer
 * @returns Base64-encoded SHA-256 hash of the SPKI
 */
export function computeSpkiPin(derCert: Buffer): string;

// --- Password Crypto (Phase 3) ---

export interface EncryptedKeyBlob {
  salt: string;
  iv: string;
  authTag: string;
  encryptedKey: string;
  iterations: number;
  version: 1;
}

/**
 * Encrypt an encryption key with a password (PBKDF2 + AES-256-GCM)
 * @param keyHex - 64-char hex string of the key to encrypt
 * @param password - User's password
 * @returns Promise resolving to encrypted blob
 */
export function encryptKeyWithPassword(keyHex: string, password: string): Promise<EncryptedKeyBlob>;

/**
 * Decrypt an encryption key with a password
 * @param blob - Encrypted blob from encryptKeyWithPassword
 * @param password - User's password
 * @returns Promise resolving to hex-encoded decrypted key
 * @throws Error with message "Incorrect password" on wrong password
 */
export function decryptKeyWithPassword(blob: EncryptedKeyBlob, password: string): Promise<string>;

// --- License JWT Verification (Phase 4) ---

export interface JwtPayload {
  sub?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  type?: string;
  tierKey?: string;
  tierName?: string;
  grantType?: string;
  isBeta?: boolean;
  productType?: string;
  features?: Record<string, boolean>;
  limits?: Record<string, number>;
  organizationId?: string;
  userId?: string;
}

export interface JwtVerifyResult {
  valid: boolean;
  error?: string;
  payload?: JwtPayload;
}

/**
 * Verify a license JWT token using the embedded RSA public key
 * @param token - Raw JWT string (without prefix)
 * @returns Verification result with parsed payload
 */
export function verifyLicenseJwt(token: string): JwtVerifyResult;

/**
 * Parse a license key and extract the prefix and JWT
 * @param licenseKey - Full license key (e.g. "na-xxx.yyy.zzz")
 * @returns Object with prefix and jwt, or null if invalid
 */
export function parseLicenseKey(licenseKey: string): { prefix: string; jwt: string } | null;
