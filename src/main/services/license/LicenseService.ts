import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { app } from 'electron';
import * as jwt from 'jsonwebtoken';

import { DEFAULT_API_URL } from '../../config';
import { logger } from '../../logger';
import type { ISettingsService } from '../../storage/interfaces/ISettingsService';
import { pinnedFetch, getKeystoreService } from '../security';

// Native addon is required - app cannot run without it
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const native: typeof import('../../../../native/index') = require('notely-native');

export type LicenseStatus = 'unlicensed' | 'active' | 'expiring' | 'expired' | 'invalid';
export type LicenseTier = 'public' | 'custom' | 'unknown'; // Legacy type based on license_type
export type LicenseTierKey =
  | 'free'
  | 'starter'
  | 'professional'
  | 'enterprise'
  | 'notely-ai'
  | 'unknown'; // Actual pricing tier
export type LicenseValidationMode = 'online' | 'offline';
export type LicenseGrantType = 'purchase' | 'beta' | 'trial' | 'promotional' | 'admin_grant'; // How license was acquired

export interface LicensePayload {
  status: LicenseStatus;
  type: LicenseTier; // Legacy: 'public' or 'custom'
  tierKey: LicenseTierKey; // Actual tier: 'free', 'starter', 'professional', 'enterprise'
  tierName: string; // Display name: 'Free', 'Starter', 'Professional', 'Enterprise'
  grantType?: LicenseGrantType; // How the license was acquired
  isBeta?: boolean; // Convenience flag for beta licenses
  validationMode: LicenseValidationMode;
  expiresAt: string | null;
  lastValidatedAt: string | null;
  nextValidationAt: string | null;
  features: string[];
  issuedTo: string | null;
  statusMessage: string | null;
}

type StoredLicense = LicensePayload & {
  licenseKey: string | null;
  // Activation fields for na- (Notely AI) licenses
  activationId: string | null;
  activatedEmail: string | null;
  activatedAt: string | null;
  offlineToken: string | null;
  offlineGraceDeadline: string | null;
  isActivated: boolean;
};

/**
 * Activation result from the server
 */
export interface ActivationResult {
  success: true;
  activationId: string;
  email: string;
  tierKey: string;
  tierName: string;
  features: Record<string, boolean>;
  offlineToken: string;
  offlineGraceDeadline: string;
  nextRequiredValidation: string | null;
}

/**
 * Activation error from the server
 */
export interface ActivationError {
  success: false;
  error: {
    code: string;
    message: string;
    existingEmail?: string;
  };
}

interface LicenseServiceDeps {
  settings: ISettingsService;
}

/**
 * API response from /api/license/validate endpoint
 */
interface OnlineValidationResponse {
  valid: boolean;
  reason?: string;
  licenseId?: string;
  type?: string; // Legacy: 'public' or 'custom'
  tierKey?: string; // Actual tier: 'free', 'starter', 'professional', 'enterprise'
  tierName?: string; // Display name: 'Free', 'Starter', 'Professional', 'Enterprise'
  grantType?: string; // How the license was acquired
  isBeta?: boolean; // Convenience flag for beta licenses
  productType?: string;
  organizationId?: string;
  userId?: string;
  features?: Record<string, boolean>;
  limits?: Record<string, number>;
  issuedAt?: string;
  expiresAt?: string;
  hardwareId?: string;
}

const LICENSE_STORAGE_KEY = 'license.cache';
// License key prefixes:
// np- = Notely Portal (cloud web app)
// nd- = Notely Desktop (cloud desktop client)
// na- = Notely AI (local AI standalone client)
const LICENSE_KEY_REGEX = /^(np|nd|na)-([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const NA_OPAQUE_KEY_REGEX =
  /^NA-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/i;
const ONLINE_VALIDATION_TIMEOUT_MS = 10000; // 10 seconds

/**
 * JWT payload structure for offline verification
 */
interface JWTPayload {
  sub?: string; // License ID
  iss?: string; // Issuer
  aud?: string; // Audience
  exp?: number; // Expiration time (Unix timestamp)
  iat?: number; // Issued at (Unix timestamp)
  nbf?: number; // Not before (Unix timestamp)
  type?: string; // License type (public/custom)
  tierKey?: string; // Tier key (free/starter/professional/enterprise/notely-ai)
  tierName?: string; // Display name
  grantType?: string; // How the license was acquired
  isBeta?: boolean; // Beta license flag
  productType?: string; // Product type
  features?: Record<string, boolean>; // Feature flags
  limits?: Record<string, number>; // License limits
  organizationId?: string;
  userId?: string;
}

/**
 * Result of offline license verification
 */
interface OfflineValidationResult {
  valid: boolean;
  error?: string;
  payload?: JWTPayload;
}

export class LicenseService extends EventEmitter {
  private cachedLicense: StoredLicense | null = null;
  private publicKey: string | null = null;

  constructor(private deps: LicenseServiceDeps) {
    super();
  }

  /**
   * Load the bundled RSA public key for offline JWT verification.
   * The key is bundled with the app for verifying license signatures locally.
   */
  private loadPublicKey(): string {
    if (this.publicKey) return this.publicKey;

    // In development: src/security/license-public-key.pem
    // In production: resources/license-public-key.pem (via extraResources)
    const keyPath = app.isPackaged
      ? path.join(process.resourcesPath, 'license-public-key.pem')
      : path.join(__dirname, '../../../security/license-public-key.pem');

    try {
      this.publicKey = fs.readFileSync(keyPath, 'utf-8');
      logger.debug('LicenseService: Loaded public key for offline verification', {
        path: keyPath,
        isPackaged: app.isPackaged,
      });
      return this.publicKey;
    } catch (error) {
      logger.error('LicenseService: Failed to load public key', {
        path: keyPath,
        error: error instanceof Error ? error.message : error,
      });
      throw new Error('Failed to load license verification key');
    }
  }

  /**
   * Verify a license JWT signature offline using the native addon.
   * The public key is embedded in the compiled C++ binary.
   */
  private verifyLicenseOffline(licenseKey: string): OfflineValidationResult {
    const parsed = this.parseLicenseKey(licenseKey);

    // Opaque na- keys cannot be verified offline via JWT
    if (parsed.opaqueKey) {
      return {
        valid: false,
        error: 'Opaque license keys require online activation',
      };
    }

    // Only na- (Notely AI) and nd- (Notely Desktop) support offline validation
    // np- (Notely Portal) licenses are web-only and require online validation
    if (parsed.prefix !== 'na' && parsed.prefix !== 'nd') {
      return {
        valid: false,
        error: 'License type does not support offline validation',
      };
    }

    const result = native.verifyLicenseJwt(parsed.jwt!);
    if (result.valid && result.payload) {
      logger.info('LicenseService: Native offline verification successful', {
        prefix: parsed.prefix,
        tierKey: result.payload.tierKey,
        exp: result.payload.exp,
      });
      return { valid: true, payload: result.payload as JWTPayload };
    }
    logger.warn('LicenseService: Native JWT verification failed', {
      error: result.error,
    });
    return { valid: false, error: result.error || 'Invalid license signature' };
  }

  /**
   * Build a LicensePayload from a JWT payload (used for offline validation)
   */
  private buildLicenseFromJWT(
    payload: JWTPayload,
    licenseKey: string,
    prefix: 'na' | 'nd' | 'np'
  ): StoredLicense {
    const now = new Date();

    // Determine license type based on prefix
    const type: LicenseTier = prefix === 'np' ? 'custom' : 'public';

    // Get tier information from JWT payload
    const tierKey: LicenseTierKey = (payload.tierKey as LicenseTierKey) || 'unknown';
    const tierName = payload.tierName || 'Unknown';

    // Get grant type information
    const grantType = payload.grantType as LicenseGrantType | undefined;
    const isBeta = payload.isBeta === true || grantType === 'beta';

    // Convert features object to array of enabled features
    const features: string[] = payload.features
      ? Object.entries(payload.features)
          .filter(([, enabled]) => Boolean(enabled))
          .map(([key]) => key)
          .sort()
      : [];

    // For na- (opaque keys), no periodic revalidation needed
    // For other prefixes, schedule next online validation based on limits
    const nextValidationAt =
      prefix === 'na'
        ? null
        : new Date(
            now.getTime() +
              ((payload.limits?.validation_interval_minutes as number) || 60) * 60 * 1000
          ).toISOString();

    return {
      status: 'active',
      type,
      tierKey,
      tierName,
      grantType,
      isBeta,
      validationMode: 'offline',
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      lastValidatedAt: now.toISOString(),
      nextValidationAt,
      features,
      issuedTo: payload.userId || null,
      statusMessage: null,
      licenseKey,
      // Activation fields (preserved from cached state if available)
      activationId: this.cachedLicense?.activationId || null,
      activatedEmail: this.cachedLicense?.activatedEmail || null,
      activatedAt: this.cachedLicense?.activatedAt || null,
      offlineToken: this.cachedLicense?.offlineToken || null,
      offlineGraceDeadline: this.cachedLicense?.offlineGraceDeadline || null,
      isActivated: this.cachedLicense?.isActivated || false,
    };
  }

  /**
   * Check if an error is a network-related error that should trigger offline fallback
   */
  private isNetworkError(error: unknown): boolean {
    // TypeError is thrown for network failures (fetch failed)
    if (error instanceof TypeError) {
      return true;
    }
    // Timeout errors
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return true;
    }
    // Check for specific network error messages
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('offline') ||
        message.includes('fetch failed') ||
        message.includes('unable to reach')
      );
    }
    return false;
  }

  async initialize(): Promise<void> {
    // Community Edition: always use the default fully-licensed state.
    // Any stored cache from a previous build (including an "unlicensed" one)
    // is ignored so every launch starts with all features unlocked.
    this.cachedLicense = this.buildDefault();
  }

  async getCurrentLicense(): Promise<LicensePayload> {
    if (!this.cachedLicense) {
      await this.initialize();
    }
    return this.stripInternalFields(this.cachedLicense!);
  }

  /**
   * Get the stored license key (for re-validation purposes)
   * @returns The stored license key, or null if no license is stored
   */
  async getStoredLicenseKey(): Promise<string | null> {
    if (!this.cachedLicense) {
      await this.initialize();
    }
    return this.cachedLicense?.licenseKey || null;
  }

  async validateLicense(_licenseKey: string): Promise<LicensePayload> {
    // Community Edition: no license validation, no network call.
    // Always report the build as fully licensed.
    return this.getCurrentLicense();
  }

  private async _legacyValidateLicense(licenseKey: string): Promise<LicensePayload> {
    const normalized = this.normalizeInput(licenseKey);

    try {
      // Try online validation first for fresh validation and revocation checking
      logger.info('LicenseService: Attempting online validation');
      const onlineResult = await this.validateOnline(normalized);
      logger.info('LicenseService: Online validation successful');
      return onlineResult;
    } catch (onlineError) {
      // If network error, attempt offline validation for na- and nd- licenses
      if (this.isNetworkError(onlineError)) {
        logger.info(
          'LicenseService: Online validation failed due to network error, trying offline',
          {
            error: onlineError instanceof Error ? onlineError.message : String(onlineError),
          }
        );

        // For activated opaque na- keys, use the offline token directly
        const parsed = this.parseLicenseKey(normalized);
        if (
          parsed.opaqueKey &&
          this.cachedLicense?.isActivated &&
          this.cachedLicense?.offlineToken
        ) {
          logger.info('LicenseService: Using offline token for activated opaque key');
          return this.validateOfflineToken();
        }

        const offlineResult = this.verifyLicenseOffline(normalized);

        if (offlineResult.valid && offlineResult.payload) {
          const storedLicense = this.buildLicenseFromJWT(
            offlineResult.payload,
            normalized,
            parsed.prefix as 'na' | 'nd' | 'np'
          );

          await this.persist(storedLicense);
          this.emitChange(storedLicense);

          logger.info('LicenseService: Offline validation successful', {
            tierKey: storedLicense.tierKey,
            features: storedLicense.features.length,
          });

          return this.stripInternalFields(storedLicense);
        }

        // Offline validation also failed
        logger.warn('LicenseService: Offline validation failed', {
          error: offlineResult.error,
        });
        throw new Error(offlineResult.error || 'Offline validation failed');
      }

      // Re-throw non-network errors (invalid license, revoked, etc.)
      throw onlineError;
    }
  }

  async clearLicense(): Promise<void> {
    this.cachedLicense = this.buildDefault();
    try {
      await this.deps.settings.delete(LICENSE_STORAGE_KEY);
    } catch (error) {
      logger.warn('LicenseService: Failed to delete cached license key', {
        error: error instanceof Error ? error.message : error,
      });
    }
    this.emitChange(this.cachedLicense);
  }

  // ============================================================================
  // Activation Methods for na- (Notely AI) Licenses
  // ============================================================================

  /**
   * Activate a license with email binding.
   * This is required for na- (Notely AI) licenses before offline use is allowed.
   *
   * @param licenseKey - The license key (must start with na-)
   * @param email - The user's email address to bind to the activation
   * @returns ActivationResult on success, ActivationError on failure
   */
  async activateLicense(
    _licenseKey: string,
    email: string
  ): Promise<ActivationResult | ActivationError> {
    // Community Edition: activation is a no-op that always succeeds.
    // No network call, no license server, no key verification.
    const now = new Date().toISOString();
    return {
      success: true,
      activationId: 'community',
      email: email || 'community@local',
      tierKey: 'notely-ai',
      tierName: 'Community Edition',
      features: {},
      offlineToken: '',
      offlineGraceDeadline: '',
      nextRequiredValidation: null,
    };
  }

  private async _legacyActivateLicense(
    licenseKey: string,
    email: string
  ): Promise<ActivationResult | ActivationError> {
    const normalized = this.normalizeInput(licenseKey);

    // Validate key format
    let parsed: { prefix: 'np' | 'nd' | 'na'; jwt?: string; opaqueKey?: string };
    try {
      parsed = this.parseLicenseKey(normalized);
    } catch {
      return {
        success: false,
        error: {
          code: 'INVALID_KEY',
          message: 'Invalid license key format',
        },
      };
    }

    // Only na- licenses support activation
    if (parsed.prefix !== 'na') {
      return {
        success: false,
        error: {
          code: 'INVALID_KEY_TYPE',
          message: 'Only Notely AI (na-) licenses support activation',
        },
      };
    }

    const apiUrl = await this.resolveApiUrl();
    const activationUrl = `${apiUrl}/api/license/activate`;

    logger.info('LicenseService: Attempting license activation', {
      licenseKeyPrefix: normalized.substring(0, 10) + '...',
      emailDomain: email.split('@')[1],
    });

    try {
      const response = await pinnedFetch(activationUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          licenseKey: normalized,
          email,
          platform: process.platform,
          appVersion: app.getVersion(),
        }),
        signal: AbortSignal.timeout(ONLINE_VALIDATION_TIMEOUT_MS),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        logger.warn('LicenseService: Activation failed', {
          status: response.status,
          code: data.error?.code,
          message: data.error?.message,
        });
        return {
          success: false,
          error: data.error || {
            code: 'UNKNOWN_ERROR',
            message: `Activation failed with status ${response.status}`,
          },
        };
      }

      // Store activation data
      const activationResult = data as ActivationResult;

      // Update cached license with activation info
      const storedLicense: StoredLicense = {
        status: 'active',
        type: 'public',
        tierKey: (activationResult.tierKey as LicenseTierKey) || 'unknown',
        tierName: activationResult.tierName || 'Unknown',
        validationMode: 'online',
        expiresAt: null, // na- licenses don't have expiration in the same way
        lastValidatedAt: new Date().toISOString(),
        nextValidationAt: activationResult.nextRequiredValidation ?? null,
        features: Object.keys(activationResult.features).filter(
          (k) => activationResult.features[k]
        ),
        issuedTo: activationResult.email,
        statusMessage: null,
        licenseKey: normalized,
        // Activation fields
        activationId: activationResult.activationId,
        activatedEmail: activationResult.email,
        activatedAt: new Date().toISOString(),
        offlineToken: activationResult.offlineToken,
        offlineGraceDeadline: activationResult.offlineGraceDeadline,
        isActivated: true,
      };

      await this.persist(storedLicense);
      this.emitChange(storedLicense);

      logger.info('LicenseService: Activation successful', {
        activationId: activationResult.activationId,
        tierKey: activationResult.tierKey,
        offlineGraceDeadline: activationResult.offlineGraceDeadline,
      });

      return activationResult;
    } catch (error) {
      if (this.isNetworkError(error)) {
        logger.error('LicenseService: Network error during activation', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: {
            code: 'NETWORK_ERROR',
            message: 'Unable to reach license server. Please check your internet connection.',
          },
        };
      }

      logger.error('LicenseService: Unexpected error during activation', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred during activation',
        },
      };
    }
  }

  /**
   * Check if the current license is activated for offline use.
   *
   * @returns true if the license is activated and has a valid offline token
   */
  async isActivatedForOffline(): Promise<boolean> {
    // Community Edition: always activated, no token needed.
    return true;
  }

  /**
   * Get activation details for the current license.
   *
   * @returns Activation details or null if not activated
   */
  async getActivationDetails(): Promise<{
    activationId: string;
    email: string;
    activatedAt: string;
    offlineGraceDeadline: string | null;
    nextRequiredValidation: string | null;
  } | null> {
    if (!this.cachedLicense) {
      await this.initialize();
    }

    if (!this.cachedLicense?.isActivated || !this.cachedLicense?.activationId) {
      return null;
    }

    return {
      activationId: this.cachedLicense.activationId,
      email: this.cachedLicense.activatedEmail || '',
      activatedAt: this.cachedLicense.activatedAt || '',
      offlineGraceDeadline: this.cachedLicense.offlineGraceDeadline,
      nextRequiredValidation: this.cachedLicense.nextValidationAt,
    };
  }

  /**
   * Revalidate an existing activation (periodic online check).
   * This extends the offline grace period and refreshes the offline token.
   *
   * @returns Updated license payload on success
   * @throws Error if revalidation fails
   */
  async revalidateActivation(): Promise<LicensePayload> {
    // Community Edition: no revalidation, no network call.
    return this.getCurrentLicense();
  }

  private async _legacyRevalidateActivation(): Promise<LicensePayload> {
    if (!this.cachedLicense?.activationId) {
      throw new Error('No activation found. Please activate your license first.');
    }

    const apiUrl = await this.resolveApiUrl();
    const revalidateUrl = `${apiUrl}/api/license/revalidate`;

    logger.info('LicenseService: Revalidating activation', {
      activationId: this.cachedLicense.activationId,
    });

    try {
      const response = await pinnedFetch(revalidateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activationId: this.cachedLicense.activationId,
          platform: process.platform,
          appVersion: app.getVersion(),
        }),
        signal: AbortSignal.timeout(ONLINE_VALIDATION_TIMEOUT_MS),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errorCode = data.error?.code || 'UNKNOWN_ERROR';
        const errorMessage = data.error?.message || 'Revalidation failed';

        logger.warn('LicenseService: Revalidation failed', {
          status: response.status,
          code: errorCode,
          message: errorMessage,
        });

        // If activation not found or deactivated, clear local activation state
        if (errorCode === 'ACTIVATION_NOT_FOUND' || errorCode === 'DEACTIVATED') {
          this.cachedLicense = {
            ...this.cachedLicense,
            isActivated: false,
            activationId: null,
            offlineToken: null,
            offlineGraceDeadline: null,
            status: 'invalid',
            statusMessage: errorMessage,
          };
          await this.persist(this.cachedLicense);
          this.emitChange(this.cachedLicense);
        }

        throw new Error(errorMessage);
      }

      // Update cached license with new offline token and deadlines
      this.cachedLicense = {
        ...this.cachedLicense,
        offlineToken: data.offlineToken,
        offlineGraceDeadline: data.offlineGraceDeadline,
        nextValidationAt: data.nextRequiredValidation ?? null,
        lastValidatedAt: new Date().toISOString(),
        validationMode: 'online',
      };

      await this.persist(this.cachedLicense);
      this.emitChange(this.cachedLicense);

      logger.info('LicenseService: Revalidation successful', {
        activationId: this.cachedLicense.activationId,
        offlineGraceDeadline: data.offlineGraceDeadline,
        nextRequiredValidation: data.nextRequiredValidation ?? null,
      });

      return this.stripInternalFields(this.cachedLicense);
    } catch (error) {
      if (this.isNetworkError(error)) {
        logger.warn('LicenseService: Network error during revalidation, using offline token', {
          error: error instanceof Error ? error.message : String(error),
        });

        // Fall back to offline validation
        return this.validateOfflineToken();
      }

      throw error;
    }
  }

  /**
   * Validate the stored offline token for offline use.
   * This checks the JWT signature and grace deadline.
   *
   * @returns License payload if offline token is valid
   * @throws Error if offline token is invalid or expired
   */
  async validateOfflineToken(): Promise<LicensePayload> {
    // Community Edition: no offline token verification.
    return this.getCurrentLicense();
  }

  private async _legacyValidateOfflineToken(): Promise<LicensePayload> {
    if (!this.cachedLicense?.offlineToken) {
      throw new Error('No offline token available. Online activation required.');
    }

    // The offline token's JWT `exp` claim handles expiration — no separate grace check needed.

    try {
      const publicKey = this.loadPublicKey();
      const payload = jwt.verify(this.cachedLicense.offlineToken, publicKey, {
        algorithms: ['RS256'],
      }) as {
        sub: string;
        iss: string;
        type: string;
        licenseId: string;
        email: string;
        emailHash: string;
        tierKey: string;
        features: Record<string, boolean>;
        activatedAt: number;
        offlineGraceDeadline: number;
        exp: number;
      };

      // Verify email matches (prevent token theft)
      if (
        this.cachedLicense.activatedEmail &&
        payload.email !== this.cachedLicense.activatedEmail
      ) {
        logger.error('LicenseService: Offline token email mismatch', {
          tokenEmail: payload.email,
          storedEmail: this.cachedLicense.activatedEmail,
        });
        throw new Error('License verification failed: email mismatch');
      }

      // Update validation mode to offline
      this.cachedLicense = {
        ...this.cachedLicense,
        validationMode: 'offline',
        lastValidatedAt: new Date().toISOString(),
        tierKey: (payload.tierKey as LicenseTierKey) || this.cachedLicense.tierKey,
        features: Object.keys(payload.features).filter((k) => payload.features[k]),
      };

      await this.persist(this.cachedLicense);
      this.emitChange(this.cachedLicense);

      logger.info('LicenseService: Offline token validation successful', {
        activationId: payload.sub,
        tierKey: payload.tierKey,
        offlineGraceDeadline: new Date(payload.offlineGraceDeadline * 1000).toISOString(),
      });

      return this.stripInternalFields(this.cachedLicense);
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        logger.error('LicenseService: Offline token JWT verification failed', {
          error: error.message,
        });
        throw new Error('Invalid offline license token. Please reactivate online.');
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Offline license token has expired. Please reconnect to revalidate.');
      }
      throw error;
    }
  }

  /**
   * Deactivate the current license activation.
   * This frees up the activation slot for use on another device.
   *
   * @returns true on success
   * @throws Error if deactivation fails
   */
  async deactivateLicense(): Promise<boolean> {
    // Community Edition: deactivation is a no-op that always succeeds.
    return true;
  }

  private async _legacyDeactivateLicense(): Promise<boolean> {
    if (!this.cachedLicense?.activationId) {
      throw new Error('No activation found to deactivate.');
    }

    const apiUrl = await this.resolveApiUrl();
    const deactivateUrl = `${apiUrl}/api/license/deactivate`;

    logger.info('LicenseService: Deactivating license', {
      activationId: this.cachedLicense.activationId,
    });

    try {
      const response = await pinnedFetch(deactivateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activationId: this.cachedLicense.activationId,
        }),
        signal: AbortSignal.timeout(ONLINE_VALIDATION_TIMEOUT_MS),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errorMessage = data.error?.message || 'Deactivation failed';
        logger.warn('LicenseService: Deactivation failed', {
          status: response.status,
          code: data.error?.code,
          message: errorMessage,
        });
        throw new Error(errorMessage);
      }

      // Clear activation state
      this.cachedLicense = {
        ...this.cachedLicense,
        isActivated: false,
        activationId: null,
        activatedEmail: null,
        activatedAt: null,
        offlineToken: null,
        offlineGraceDeadline: null,
        status: 'unlicensed',
        statusMessage: 'License deactivated',
      };

      await this.persist(this.cachedLicense);
      this.emitChange(this.cachedLicense);

      logger.info('LicenseService: Deactivation successful');
      return true;
    } catch (error) {
      if (this.isNetworkError(error)) {
        throw new Error(
          'Unable to reach license server. Please check your internet connection to deactivate.'
        );
      }
      throw error;
    }
  }

  /**
   * Fetch the current user's license from the backend /api/license/current endpoint
   * Requires an authenticated user with valid access token
   *
   * @returns A LicensePayload with the user's current license information
   * @throws Error if fetch fails, user is not authenticated, or response is invalid
   */
  async fetchCurrentLicense(): Promise<LicensePayload> {
    // Community Edition: no backend fetch, no auth token needed.
    return this.getCurrentLicense();
  }

  private async _legacyFetchCurrentLicense(): Promise<LicensePayload> {
    // Get auth token from OS keystore
    const keystoreService = getKeystoreService();
    let accessToken: string | null = null;
    try {
      accessToken = await keystoreService.getAccessToken();
    } catch (error) {
      logger.warn('LicenseService: Failed to retrieve access token from keystore', {
        error: error instanceof Error ? error.message : error,
      });
    }
    if (!accessToken) {
      throw new Error('Authentication required to fetch license');
    }

    const apiUrl = await this.resolveApiUrl();
    const currentLicenseUrl = `${apiUrl}/api/license/current?format=desktop`;

    logger.info('LicenseService: Fetching current license from backend', {
      url: currentLicenseUrl,
    });

    try {
      const response = await pinnedFetch(currentLicenseUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(ONLINE_VALIDATION_TIMEOUT_MS),
      });

      // Check HTTP status
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication expired. Please log in again.');
        } else if (response.status === 404) {
          // No license found - update cache to unlicensed state
          const unlicensedState: StoredLicense = {
            status: 'unlicensed',
            type: 'unknown',
            tierKey: 'unknown',
            tierName: 'Unknown',
            validationMode: 'online',
            expiresAt: null,
            lastValidatedAt: new Date().toISOString(),
            nextValidationAt: null,
            features: [],
            issuedTo: this.cachedLicense?.issuedTo || null,
            statusMessage: 'No license found for this user',
            licenseKey: null,
            // Clear activation state
            activationId: null,
            activatedEmail: null,
            activatedAt: null,
            offlineToken: null,
            offlineGraceDeadline: null,
            isActivated: false,
          };

          await this.persist(unlicensedState);
          this.emitChange(unlicensedState);

          logger.info('LicenseService: Updated cache to unlicensed (no license found)', {
            previousStatus: this.cachedLicense?.status,
          });

          throw new Error('No license found for this user.');
        } else if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else if (response.status >= 500) {
          throw new Error(`License server error (${response.status}). Please try again later.`);
        } else {
          throw new Error(`Failed to fetch license with status ${response.status}`);
        }
      }

      const data: OnlineValidationResponse = await response.json();

      // Check if license is valid
      if (!data.valid) {
        const reason = data.reason || 'Unknown reason';
        logger.warn('LicenseService: Fetched license is not valid', { reason });

        // CRITICAL: Update cached license to reflect the invalid/revoked state
        // This ensures the UI shows the correct status instead of stale "active" cache
        const invalidLicense: StoredLicense = {
          status: 'invalid',
          type: 'unknown',
          tierKey: 'unknown',
          tierName: 'Unknown',
          validationMode: 'online',
          expiresAt: null,
          lastValidatedAt: new Date().toISOString(),
          nextValidationAt: null,
          features: [],
          issuedTo: this.cachedLicense?.issuedTo || null,
          statusMessage: reason,
          licenseKey: this.cachedLicense?.licenseKey || null,
          // Clear activation state on invalid license
          activationId: null,
          activatedEmail: null,
          activatedAt: null,
          offlineToken: null,
          offlineGraceDeadline: null,
          isActivated: false,
        };

        await this.persist(invalidLicense);
        this.emitChange(invalidLicense);

        logger.info('LicenseService: Updated cache to reflect invalid license status', {
          reason,
          previousStatus: this.cachedLicense?.status,
        });

        throw new Error(`License is not valid: ${reason}`);
      }

      // Extract license information from response
      const now = new Date();

      // Determine license type from response (legacy field)
      const type: LicenseTier =
        data.type === 'public' ? 'public' : data.type === 'custom' ? 'custom' : 'unknown';

      // Get actual tier information from response
      const tierKey: LicenseTierKey = (data.tierKey as LicenseTierKey) || 'unknown';
      const tierName = data.tierName || 'Unknown';

      // Get grant type information from response
      const grantType = data.grantType as LicenseGrantType | undefined;
      const isBeta = data.isBeta === true || grantType === 'beta';

      // Convert API features object to array of enabled features
      const features: string[] = data.features
        ? Object.entries(data.features)
            .filter(([, enabled]) => Boolean(enabled))
            .map(([key]) => key)
            .sort()
        : [];

      // For na- licenses, no periodic revalidation needed
      const isNotelyAi = this.cachedLicense?.licenseKey?.toUpperCase().startsWith('NA-');
      const nextValidationAt = isNotelyAi
        ? null
        : new Date(
            now.getTime() + ((data.limits?.validation_interval_minutes as number) || 60) * 60 * 1000
          ).toISOString();

      // For fetched licenses, we don't have the license key, so we preserve existing or use null
      const existingLicenseKey = this.cachedLicense?.licenseKey || null;

      const storedLicense: StoredLicense = {
        status: 'active',
        type,
        tierKey,
        tierName,
        grantType,
        isBeta,
        validationMode: 'online',
        expiresAt: data.expiresAt || null,
        lastValidatedAt: now.toISOString(),
        nextValidationAt,
        features,
        issuedTo: data.userId || null,
        statusMessage: null,
        licenseKey: existingLicenseKey,
        // Preserve activation state from cache
        activationId: this.cachedLicense?.activationId || null,
        activatedEmail: this.cachedLicense?.activatedEmail || null,
        activatedAt: this.cachedLicense?.activatedAt || null,
        offlineToken: this.cachedLicense?.offlineToken || null,
        offlineGraceDeadline: this.cachedLicense?.offlineGraceDeadline || null,
        isActivated: this.cachedLicense?.isActivated || false,
      };

      await this.persist(storedLicense);
      this.emitChange(storedLicense);

      logger.info('LicenseService: Successfully fetched and cached license from backend', {
        licenseId: data.licenseId,
        type: data.type,
        tierKey,
        tierName,
        productType: data.productType,
        expiresAt: data.expiresAt,
        features: features.length,
      });

      return this.stripInternalFields(storedLicense);
    } catch (error) {
      // Handle network errors
      if (error instanceof TypeError) {
        logger.error('LicenseService: Network error during license fetch', {
          error: error.message,
        });
        throw new Error('Network error: Unable to reach license server');
      }

      // Handle timeout errors
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        logger.error('LicenseService: Timeout during license fetch');
        throw new Error('License fetch timed out');
      }

      // Re-throw other errors
      throw error;
    }
  }

  onChanged(listener: (payload: LicensePayload) => void): () => void {
    this.on('changed', listener);
    return () => {
      this.off('changed', listener);
    };
  }

  private buildDefault(): StoredLicense {
    // Community Edition: all features unlocked, no license server dependency.
    // This build is not tied to a hosted platform — every feature is available
    // from first launch and never requires activation or online validation.
    const now = new Date().toISOString();
    return {
      status: 'active',
      type: 'custom',
      tierKey: 'notely-ai',
      tierName: 'Community Edition',
      grantType: 'promotional',
      isBeta: false,
      validationMode: 'offline',
      expiresAt: null,
      lastValidatedAt: now,
      nextValidationAt: null,
      features: [],
      issuedTo: 'Community User',
      statusMessage: null,
      licenseKey: 'COMMUNITY',
      activationId: 'community',
      activatedEmail: null,
      activatedAt: now,
      offlineToken: null,
      offlineGraceDeadline: null,
      isActivated: true,
    };
  }

  private stripInternalFields(record: StoredLicense): LicensePayload {
    const {
      status,
      type,
      tierKey,
      tierName,
      grantType,
      isBeta,
      validationMode,
      expiresAt,
      lastValidatedAt,
      nextValidationAt,
      features,
      issuedTo,
      statusMessage,
    } = record;
    return {
      status,
      type,
      tierKey,
      tierName,
      grantType,
      isBeta,
      validationMode,
      expiresAt,
      lastValidatedAt,
      nextValidationAt,
      features,
      issuedTo,
      statusMessage,
    };
  }

  private async persist(record: StoredLicense): Promise<void> {
    this.cachedLicense = record;
    try {
      await this.deps.settings.setJson(LICENSE_STORAGE_KEY, record);
    } catch (error) {
      logger.warn('LicenseService: Failed to persist license cache', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private emitChange(record: StoredLicense): void {
    const payload = this.stripInternalFields(record);
    this.emit('changed', payload);
  }

  private normalizeInput(value: string): string {
    return value.replace(/\s+/g, '').trim().toUpperCase();
  }

  private parseLicenseKey(key: string): {
    prefix: 'np' | 'nd' | 'na';
    jwt?: string;
    opaqueKey?: string;
  } {
    // Try JWT format first (np-/nd-/na- with JWT payload)
    const match = LICENSE_KEY_REGEX.exec(key);
    if (match) {
      const [, prefix, jwtToken] = match;
      return {
        prefix: prefix.toLowerCase() as 'np' | 'nd' | 'na',
        jwt: jwtToken,
      };
    }

    // Try opaque format (NA-XXXXX-XXXXX-XXXXX-XXXXX)
    if (NA_OPAQUE_KEY_REGEX.test(key)) {
      return {
        prefix: 'na',
        opaqueKey: key.toUpperCase(),
      };
    }

    throw new Error('License key format looks invalid. Double-check and try again.');
  }

  /**
   * Get the API base URL from settings or use default
   */
  async resolveApiUrl(): Promise<string> {
    const normalize = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

    try {
      const customApiUrl = normalize(await this.deps.settings.get('server.apiUrl'));
      if (customApiUrl) {
        logger.info('LicenseService: Using custom API URL from settings', {
          apiUrl: customApiUrl,
        });
        return customApiUrl;
      }
    } catch (error) {
      logger.debug('LicenseService: Failed to get custom API URL from settings', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const authServerUrl = normalize(await this.deps.settings.get('auth.serverUrl'));
      if (authServerUrl) {
        logger.info('LicenseService: Using auth server URL for license validation', {
          apiUrl: authServerUrl,
        });
        return authServerUrl;
      }
    } catch (error) {
      logger.debug('LicenseService: Failed to get auth server URL from settings', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('LicenseService: Using default API URL', {
      apiUrl: DEFAULT_API_URL,
    });
    return DEFAULT_API_URL;
  }

  /**
   * Validates a license key online via the license microservice API
   *
   * @param licenseKey - The normalized license key to validate
   * @returns A LicensePayload with online validation mode
   * @throws Error if online validation fails for any reason
   */
  private async validateOnline(licenseKey: string): Promise<LicensePayload> {
    const apiUrl = await this.resolveApiUrl();
    const validationUrl = `${apiUrl}/api/license/validate`;

    logger.info('LicenseService: Calling online validation endpoint', {
      url: validationUrl,
      licenseKeyPrefix: licenseKey.substring(0, 10) + '...',
    });

    try {
      const response = await pinnedFetch(validationUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          licenseKey,
        }),
        signal: AbortSignal.timeout(ONLINE_VALIDATION_TIMEOUT_MS),
      });

      // Check HTTP status
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else if (response.status >= 500) {
          throw new Error(`License server error (${response.status}). Please try again later.`);
        } else if (response.status === 403) {
          throw new Error('License validation rejected: Concurrent usage limit exceeded.');
        } else {
          throw new Error(`License validation failed with status ${response.status}`);
        }
      }

      const data: OnlineValidationResponse = await response.json();

      // Check if license is valid
      if (!data.valid) {
        const reason = data.reason || 'Unknown reason';
        logger.warn('LicenseService: License validation failed', { reason });

        // CRITICAL: Update cached license to reflect the invalid/revoked state
        // This ensures the UI shows the correct status instead of stale "active" cache
        const invalidLicense: StoredLicense = {
          status: 'invalid',
          type: 'unknown',
          tierKey: 'unknown',
          tierName: 'Unknown',
          validationMode: 'online',
          expiresAt: null,
          lastValidatedAt: new Date().toISOString(),
          nextValidationAt: null,
          features: [],
          issuedTo: this.cachedLicense?.issuedTo || null,
          statusMessage: reason,
          licenseKey: licenseKey,
          // Clear activation state on invalid license
          activationId: null,
          activatedEmail: null,
          activatedAt: null,
          offlineToken: null,
          offlineGraceDeadline: null,
          isActivated: false,
        };

        await this.persist(invalidLicense);
        this.emitChange(invalidLicense);

        logger.info('LicenseService: Updated cache to reflect invalid license status', {
          reason,
          previousStatus: this.cachedLicense?.status,
        });

        throw new Error(`License validation failed: ${reason}`);
      }

      // Extract license information from response
      const now = new Date();
      const parsed = this.parseLicenseKey(licenseKey);
      const type: LicenseTier = parsed.prefix === 'np' ? 'custom' : 'public';

      // Get actual tier information from response
      const tierKey: LicenseTierKey = (data.tierKey as LicenseTierKey) || 'unknown';
      const tierName = data.tierName || 'Unknown';

      // Get grant type information from response
      const grantType = data.grantType as LicenseGrantType | undefined;
      const isBeta = data.isBeta === true || grantType === 'beta';

      // Convert API features object to array of enabled features
      const features: string[] = data.features
        ? Object.entries(data.features)
            .filter(([, enabled]) => Boolean(enabled))
            .map(([key]) => key)
            .sort()
        : [];

      // For na- licenses, no periodic revalidation needed
      const nextValidationAt =
        parsed.prefix === 'na'
          ? null
          : new Date(
              now.getTime() +
                ((data.limits?.validation_interval_minutes as number) || 60) * 60 * 1000
            ).toISOString();

      const storedLicense: StoredLicense = {
        status: 'active',
        type,
        tierKey,
        tierName,
        grantType,
        isBeta,
        validationMode: 'online',
        expiresAt: data.expiresAt || null,
        lastValidatedAt: now.toISOString(),
        nextValidationAt,
        features,
        issuedTo: data.userId || null,
        statusMessage: null,
        licenseKey,
        // Preserve activation state from cache
        activationId: this.cachedLicense?.activationId || null,
        activatedEmail: this.cachedLicense?.activatedEmail || null,
        activatedAt: this.cachedLicense?.activatedAt || null,
        offlineToken: this.cachedLicense?.offlineToken || null,
        offlineGraceDeadline: this.cachedLicense?.offlineGraceDeadline || null,
        isActivated: this.cachedLicense?.isActivated || false,
      };

      await this.persist(storedLicense);
      this.emitChange(storedLicense);

      logger.info('LicenseService: Online validation successful and cached', {
        licenseId: data.licenseId,
        type: data.type,
        grantType,
        isBeta,
        productType: data.productType,
        expiresAt: data.expiresAt,
        features: features.length,
      });

      return this.stripInternalFields(storedLicense);
    } catch (error) {
      // Handle network errors
      if (error instanceof TypeError) {
        logger.error('LicenseService: Network error during online validation', {
          error: error.message,
        });
        throw new Error('Network error: Unable to reach license server');
      }

      // Handle timeout errors
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        logger.error('LicenseService: Timeout during online validation');
        throw new Error('License validation timed out');
      }

      // Re-throw validation errors
      throw error;
    }
  }
}
