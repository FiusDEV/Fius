import { readFileSync, existsSync } from 'fs';
import { getFiusGlobalPath } from './path.js';

export const PROVIDER_API_KEY_MAP: Record<string, string[]> = {};

export function getPrimaryApiKeyEnvVar(provider: string): string {
    return '';
}

function readFiusApiKeyFromAuthJson(): string | undefined {
    try {
        const authPath = getFiusGlobalPath('', 'auth.json');
        if (!existsSync(authPath)) return undefined;
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
        return auth.fiusApiKey || undefined;
    } catch {
        return undefined;
    }
}

export function resolveApiKeyForProvider(provider: string): string | undefined {
    if (provider === 'fius-gateway' || provider === 'fius') {
        return process.env.FIUS_API_KEY || readFiusApiKeyFromAuthJson() || undefined;
    }
    return undefined;
}
