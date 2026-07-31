import chalk from 'chalk';
import { existsSync, promises as fs } from 'fs';
import { z } from 'zod';
import { getFiusGlobalPath, logger } from '@fius/core';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants.js';

const AUTH_CONFIG_FILE = 'auth.json';

export interface AuthConfig {
    /** Supabase access token from OAuth login (optional if using --api-key) */
    token?: string | undefined;
    refreshToken?: string | undefined;
    userId?: string | undefined;
    email?: string | undefined;
    expiresAt?: number | undefined;
    createdAt: number;
    /** Fius API key for gateway access (from --api-key or provisioned after OAuth) */
    fiusApiKey?: string | undefined;
    fiusKeyId?: string | undefined;
    fiusApiKeySource?: 'provisioned' | 'user-supplied' | undefined;
}

const AuthConfigSchema = z
    .object({
        token: z.string().min(1).optional(),
        refreshToken: z.string().optional(),
        userId: z.string().optional(),
        email: z.string().email().optional(),
        expiresAt: z.number().optional(),
        createdAt: z.number(),
        fiusApiKey: z.string().optional(),
        fiusKeyId: z.string().optional(),
        fiusApiKeySource: z.enum(['provisioned', 'user-supplied']).optional(),
    })
    .refine((data) => data.token || data.fiusApiKey, {
        message: 'Either token (from OAuth) or fiusApiKey (from --api-key) is required',
    });

export async function storeAuth(config: AuthConfig): Promise<void> {
    const authPath = getFiusGlobalPath('', AUTH_CONFIG_FILE);
    const fiusDir = getFiusGlobalPath('', '');

    await fs.mkdir(fiusDir, { recursive: true });
    await fs.writeFile(authPath, JSON.stringify(config, null, 2), { mode: 0o600 });

    logger.debug(`Stored auth config at: ${authPath}`);
}

export async function loadAuth(): Promise<AuthConfig | null> {
    const authPath = getFiusGlobalPath('', AUTH_CONFIG_FILE);

    if (!existsSync(authPath)) {
        return null;
    }

    try {
        const content = await fs.readFile(authPath, 'utf-8');
        const config = JSON.parse(content);

        const validated = AuthConfigSchema.parse(config);

        if (validated.expiresAt && validated.expiresAt < Date.now()) {
            if (!validated.refreshToken) {
                await removeAuth();
                return null;
            }
        }

        return validated;
    } catch (error) {
        logger.warn(`Invalid auth config, removing: ${error}`);
        await removeAuth();
        return null;
    }
}

export async function removeAuth(): Promise<void> {
    const authPath = getFiusGlobalPath('', AUTH_CONFIG_FILE);

    if (existsSync(authPath)) {
        await fs.unlink(authPath);
        logger.debug(`Removed auth config from: ${authPath}`);
    }
}

export async function isAuthenticated(): Promise<boolean> {
    const auth = await loadAuth();
    return auth !== null;
}

async function resolveAuthToken(options: { quiet: boolean }): Promise<string | null> {
    const auth = await loadAuth();

    if (!auth) {
        return null;
    }

    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    const isExpiringSoon = auth.expiresAt && auth.expiresAt < now + fiveMinutes;

    if (!isExpiringSoon) {
        return auth.token ?? null;
    }

    if (!auth.refreshToken) {
        logger.debug('Token expired but no refresh token available');
        await removeAuth();
        return null;
    }

    logger.debug('Access token expired or expiring soon, refreshing...');
    if (!options.quiet) {
        console.log(chalk.cyan('рџ”„ Access token expiring soon, refreshing...'));
    }

    const refreshResult = await refreshAccessToken(auth.refreshToken);

    if (!refreshResult) {
        logger.debug('Token refresh failed, removing auth');
        if (!options.quiet) {
            console.log(chalk.red('вќЊ Token refresh failed. Please login again.'));
        }
        await removeAuth();
        return null;
    }

    const newExpiresAt = Date.now() + refreshResult.expiresIn * 1000;
    await storeAuth({
        ...auth,
        token: refreshResult.accessToken,
        refreshToken: refreshResult.refreshToken,
        expiresAt: newExpiresAt,
    });

    logger.debug('Token refreshed successfully');
    if (!options.quiet) {
        console.log(chalk.green('вњ… Access token refreshed successfully'));
    }
    return refreshResult.accessToken;
}

export async function getAuthToken(): Promise<string | null> {
    return resolveAuthToken({ quiet: false });
}

export async function getAuthTokenQuietly(): Promise<string | null> {
    return resolveAuthToken({ quiet: true });
}

export async function getFiusApiKey(): Promise<string | null> {
    if (process.env.FIUS_API_KEY?.trim()) {
        return process.env.FIUS_API_KEY;
    }
    const auth = await loadAuth();
    return auth?.fiusApiKey || null;
}

async function refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
} | null> {
    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
                refresh_token: refreshToken,
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            logger.debug(`Token refresh failed: ${response.status}`);
            return null;
        }

        const data = await response.json();

        if (!data.access_token || !data.refresh_token) {
            logger.debug('Token refresh response missing required tokens');
            return null;
        }

        logger.debug('Successfully refreshed access token');
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in || 3600,
        };
    } catch (error) {
        logger.debug(
            `Token refresh error: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }
}

export function getAuthFilePath(): string {
    return getFiusGlobalPath('', AUTH_CONFIG_FILE);
}