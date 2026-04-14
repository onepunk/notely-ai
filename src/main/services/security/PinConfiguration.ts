/**
 * Certificate Pin Configuration
 *
 * Pin values and domain matching are handled in the native C++ addon
 * where they are stored as obfuscated byte arrays. The native addon is REQUIRED.
 *
 * Pin Sources:
 * - https://pki.goog/repository/ (Google Trust Services root certificates)
 * - Extracted from api.yourdomain.com certificate chain
 */

import type { DomainPinConfig, PinEntry } from './types';

// Native addon is required - app cannot run without it
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const native: typeof import('../../../../native/index') = require('notely-native');

/**
 * Get pin entries for a specific domain.
 *
 * @param hostname - The hostname to get pins for
 * @returns Array of pin strings, or empty array if no pins configured
 */
export function getPinsForDomain(hostname: string): string[] {
  return native.getPinsForDomain(hostname);
}

/**
 * Get full pin configuration for a domain.
 *
 * @param hostname - The hostname to get configuration for
 * @returns DomainPinConfig or undefined if not configured
 */
export function getPinConfigForDomain(hostname: string): DomainPinConfig | undefined {
  const pins = getPinsForDomain(hostname);
  if (pins.length === 0) return undefined;
  return {
    domain: hostname,
    pins: pins.map((pin) => ({ pin, description: '' })),
  };
}

/**
 * Check if a domain requires certificate pinning.
 *
 * @param hostname - The hostname to check
 * @returns true if pinning is configured for this domain
 */
export function requiresPinning(hostname: string): boolean {
  return native.requiresPinning(hostname);
}

/**
 * Check if a URL requires certificate pinning.
 *
 * Pinning only applies to Notely Cloud: *.yourdomain.com on standard port (443).
 */
export function requiresPinningForUrl(url: string): boolean {
  return native.requiresPinningForUrl(url);
}

/**
 * Check if a hostname + port combination requires pinning.
 *
 * Pinning only applies to Notely Cloud: *.yourdomain.com on standard port (443).
 */
export function requiresPinningWithPort(hostname: string, port?: number | string): boolean {
  const portNum =
    port === undefined || port === '' ? 443 : typeof port === 'string' ? parseInt(port, 10) : port;

  return native.requiresPinningWithPort(hostname, portNum);
}

/**
 * Get all configured pins across all domains.
 * Useful for logging and debugging.
 */
export function getAllConfiguredPins(): { domain: string; pins: PinEntry[] }[] {
  const domains = ['yourdomain.com', '*.yourdomain.com'];
  return domains.map((domain) => ({
    domain,
    pins: native.getPinsForDomain(domain.replace('*.', '')).map((pin: string) => ({
      pin,
      description: '',
    })),
  }));
}
