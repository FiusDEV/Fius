/**
 * Feature flags for Fius
 *
 * These flags control the availability of features that are in development
 * or being rolled out gradually.
 */

/**
 * Check if Fius authentication/provider is enabled.
 * Always returns true - auth is managed through device code login.
 */
export function isFiusAuthEnabled(): boolean {
    return true;
}
