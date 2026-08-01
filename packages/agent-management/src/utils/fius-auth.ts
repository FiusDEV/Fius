/**
 * Fius Authentication Utilities
 *
 * Provides functions to check fius authentication status.
 * Used by both CLI and server to determine if user can use fius features.
 */

import { existsSync, promises as fs } from 'fs';
import { z } from 'zod';
import { getFiusGlobalPath } from '@fiusdev/core';

const AUTH_CONFIG_FILE = 'auth.json';

/**
 * Minimal schema for checking auth status.
 * We only need enough state to tell whether Fius auth is still usable.
 */
const AuthConfigSchema = z
    .object({
        token: z.string().min(1).optional(),
        refreshToken: z.string().optional(),
        expiresAt: z.number().optional(),
        createdAt: z.number().optional(),
        fiusApiKey: z.string().optional(),
        fiusKeyId: z.string().optional(),
        fiusApiKeySource: z.enum(['provisioned', 'user-supplied']).optional(),
    })
    .refine((data) => data.token || data.fiusApiKey, {
        message: 'Either token or fiusApiKey is required',
    });

type AuthConfig = z.output<typeof AuthConfigSchema>;

async function loadAuthConfig(): Promise<AuthConfig | null> {
    const authPath = getFiusGlobalPath('', AUTH_CONFIG_FILE);

    if (!existsSync(authPath)) {
        return null;
    }

    try {
        const content = await fs.readFile(authPath, 'utf-8');
        const config = JSON.parse(content);
        const validated = AuthConfigSchema.safeParse(config);

        if (!validated.success) {
            return null;
        }

        const auth = validated.data;

        if (auth.expiresAt && auth.expiresAt < Date.now()) {
            if (!auth.refreshToken && !auth.fiusApiKey) {
                return null;
            }
        }

        return auth;
    } catch {
        return null;
    }
}

/**
 * Check if user is authenticated with Fius.
 * Returns true when auth.json contains usable Fius auth state.
 */
export async function isFiusAuthenticated(): Promise<boolean> {
    return (await loadAuthConfig()) !== null;
}

/**
 * Get the fius API key from auth config or environment.
 */
export async function getFiusApiKeyFromAuth(): Promise<string | null> {
    const auth = await loadAuthConfig();
    if (auth?.fiusApiKey?.trim()) {
        const apiKey = auth.fiusApiKey.trim();
        process.env.FIUS_API_KEY = apiKey;
        return apiKey;
    }

    if (process.env.FIUS_API_KEY?.trim()) {
        return process.env.FIUS_API_KEY;
    }

    return null;
}

/**
 * Check if user can use Fius provider.
 * Requires BOTH:
 * 1. User has usable Fius auth state (token, refresh-backed login, or stored API key)
 * 2. Has FIUS_API_KEY (from auth config or environment)
 */
export async function canUseFiusProvider(): Promise<boolean> {
    const authenticated = await isFiusAuthenticated();
    if (!authenticated) return false;

    const apiKey = await getFiusApiKeyFromAuth();
    if (!apiKey) return false;

    return true;
}
