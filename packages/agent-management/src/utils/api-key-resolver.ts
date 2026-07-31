/**
 * Utility for resolving API keys from environment variables.
 * All API keys are managed through the Fius platform auth system.
 */

export const PROVIDER_API_KEY_MAP: Record<string, string[]> = {};

export function getPrimaryApiKeyEnvVar(provider: string): string {
    return '';
}

export function resolveApiKeyForProvider(provider: string): string | undefined {
    return undefined;
}
