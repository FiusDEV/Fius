import { type FiusApiKeyProvisionStatus, ensureFiusApiKeyForAuthToken } from './fius-api-key.js';
import type { OAuthResult } from './oauth.js';
import { loadAuth, storeAuth, type AuthConfig } from './service.js';
import type { DeviceApiKeyLoginResult } from './types.js';

export interface PersistOAuthLoginOptions {
    onProvisionStatus?: ((status: FiusApiKeyProvisionStatus) => void) | undefined;
}

export interface PersistedLoginResult {
    email?: string | undefined;
    userId?: string | undefined;
    keyId?: string | undefined;
    hasFiusApiKey: boolean;
}

function isSameAuthenticatedUser(
    existingAuth: AuthConfig | null,
    user: OAuthResult['user']
): boolean {
    if (!existingAuth || !user) {
        return false;
    }

    if (existingAuth.userId && user.id) {
        return existingAuth.userId === user.id;
    }

    if (existingAuth.email && user.email) {
        return existingAuth.email.toLowerCase() === user.email.toLowerCase();
    }

    return false;
}

function getPreservedFiusApiKey(
    existingAuth: AuthConfig | null,
    user: OAuthResult['user']
): Pick<AuthConfig, 'fiusApiKey' | 'fiusKeyId' | 'fiusApiKeySource'> | null {
    if (!existingAuth?.fiusApiKey || !isSameAuthenticatedUser(existingAuth, user)) {
        return null;
    }

    const isProvisionedKey =
        existingAuth.fiusApiKeySource === 'provisioned' ||
        (existingAuth.fiusApiKeySource === undefined && Boolean(existingAuth.fiusKeyId));

    if (!isProvisionedKey) {
        return null;
    }

    return {
        fiusApiKey: existingAuth.fiusApiKey,
        ...(existingAuth.fiusKeyId ? { fiusKeyId: existingAuth.fiusKeyId } : {}),
        fiusApiKeySource: 'provisioned',
    };
}

export async function persistOAuthLoginResult(
    result: OAuthResult,
    options: PersistOAuthLoginOptions = {}
): Promise<PersistedLoginResult> {
    const existingAuth = await loadAuth();
    const expiresAt = result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined;
    const preservedFiusApiKey = getPreservedFiusApiKey(existingAuth, result.user);

    await storeAuth({
        token: result.accessToken,
        refreshToken: result.refreshToken,
        userId: result.user?.id,
        email: result.user?.email,
        createdAt: Date.now(),
        expiresAt,
        ...(preservedFiusApiKey ?? {}),
    });

    const ensured = await ensureFiusApiKeyForAuthToken(result.accessToken, {
        onStatus: options.onProvisionStatus,
    });

    return {
        email: result.user?.email,
        userId: result.user?.id,
        keyId: ensured?.keyId ?? preservedFiusApiKey?.fiusKeyId ?? undefined,
        hasFiusApiKey: Boolean(ensured?.fiusApiKey ?? preservedFiusApiKey?.fiusApiKey),
    };
}

export async function persistDeviceApiKeyLoginResult(
    result: DeviceApiKeyLoginResult
): Promise<PersistedLoginResult> {
    await storeAuth({
        fiusApiKey: result.fiusApiKey,
        fiusKeyId: result.fiusKeyId,
        fiusApiKeySource: 'provisioned',
        createdAt: Date.now(),
        email: result.email,
    });

    return {
        email: result.email,
        keyId: result.fiusKeyId,
        hasFiusApiKey: true,
    };
}