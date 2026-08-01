import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureFiusGlobalDirectory, getFiusEnvPath, logger } from '@fiusdev/core';
import { getFiusApiClient } from './api-client.js';
import { loadAuth, storeAuth } from './service.js';

export type FiusApiKeyProvisionStatusLevel = 'info' | 'success' | 'warning' | 'error';

export interface FiusApiKeyProvisionStatus {
    level: FiusApiKeyProvisionStatusLevel;
    message: string;
}

export interface EnsureFiusApiKeyOptions {
    onStatus?: ((status: FiusApiKeyProvisionStatus) => void) | undefined;
}

async function ensureOwnerOnlyPermissions(filePath: string): Promise<void> {
    try {
        await fs.chmod(filePath, 0o600);
    } catch (error) {
        logger.warn('Failed to set permissions on env file', {
            filePath,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function saveFiusApiKeyToEnv(apiKey: string): Promise<void> {
    const envVar = 'FIUS_API_KEY';
    const targetEnvPath = getFiusEnvPath();

    await ensureFiusGlobalDirectory();
    await fs.mkdir(path.dirname(targetEnvPath), { recursive: true });

    let envContent = '';
    try {
        envContent = await fs.readFile(targetEnvPath, 'utf-8');
    } catch {
    }

    const lines = envContent.split('\n');
    const keyPattern = new RegExp(`^${envVar}=`);
    const keyIndex = lines.findIndex((line) => keyPattern.test(line));

    if (keyIndex >= 0) {
        lines[keyIndex] = `${envVar}=${apiKey}`;
    } else {
        lines.push(`${envVar}=${apiKey}`);
    }

    const nextContent = lines.filter(Boolean).join('\n') + '\n';
    await fs.writeFile(targetEnvPath, nextContent, { encoding: 'utf-8', mode: 0o600 });
    await ensureOwnerOnlyPermissions(targetEnvPath);
    process.env[envVar] = apiKey;
}

export async function removeFiusApiKeyFromEnv(options: { expectedValue?: string } = {}): Promise<{
    removed: boolean;
    targetEnvPath: string;
}> {
    const envVar = 'FIUS_API_KEY';
    const targetEnvPath = getFiusEnvPath();
    const clearProcessEnv = () => {
        const currentValue = process.env[envVar];
        if (!currentValue) return;
        if (!options.expectedValue || currentValue === options.expectedValue) {
            delete process.env[envVar];
        }
    };

    let envContent = '';
    try {
        envContent = await fs.readFile(targetEnvPath, 'utf-8');
    } catch {
        clearProcessEnv();
        return { removed: false, targetEnvPath };
    }

    const lines = envContent.split('\n');
    const keyPattern = new RegExp(`^${envVar}=(.*)$`);
    const keyLineIndex = lines.findIndex((line) => keyPattern.test(line));

    if (keyLineIndex < 0) {
        clearProcessEnv();
        return { removed: false, targetEnvPath };
    }

    if (options.expectedValue) {
        const match = lines[keyLineIndex]?.match(keyPattern);
        const currentValue = match?.[1] ?? '';
        if (currentValue !== options.expectedValue) {
            clearProcessEnv();
            return { removed: false, targetEnvPath };
        }
    }

    lines.splice(keyLineIndex, 1);

    const nextLines = lines.filter(Boolean);
    const nextContent = nextLines.length ? nextLines.join('\n') + '\n' : '';

    try {
        await fs.writeFile(targetEnvPath, nextContent, { encoding: 'utf-8', mode: 0o600 });
        await ensureOwnerOnlyPermissions(targetEnvPath);
    } catch (error) {
        clearProcessEnv();
        throw new Error(
            `Failed to remove ${envVar} from ${targetEnvPath}: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    clearProcessEnv();
    return { removed: true, targetEnvPath };
}

export async function ensureFiusApiKeyForAuthToken(
    authToken: string,
    options: EnsureFiusApiKeyOptions = {}
): Promise<{ fiusApiKey: string; keyId: string | null } | null> {
    const status = (level: FiusApiKeyProvisionStatusLevel, message: string) =>
        options.onStatus?.({ level, message });

    try {
        const apiClient = getFiusApiClient();
        const auth = await loadAuth();

        if (!auth) {
            throw new Error('Authentication state not found');
        }

        if (auth.fiusApiKey) {
            status('info', 'Validating existing API key...');

            const isValid = await apiClient.validateFiusApiKey(auth.fiusApiKey);
            if (isValid) {
                status('success', 'Existing key is valid');
                if (!auth.fiusApiKeySource && auth.fiusKeyId) {
                    await storeAuth({
                        ...auth,
                        fiusApiKeySource: 'provisioned',
                    });
                }
                await saveFiusApiKeyToEnv(auth.fiusApiKey);
                return { fiusApiKey: auth.fiusApiKey, keyId: auth.fiusKeyId ?? null };
            }

            status('warning', 'Existing key is invalid, rotating...');
            const rotated = await apiClient.provisionFiusApiKey(authToken, 'Fius CLI Key', true);

            await storeAuth({
                ...auth,
                fiusApiKey: rotated.fiusApiKey,
                fiusKeyId: rotated.keyId,
                fiusApiKeySource: 'provisioned',
            });
            await saveFiusApiKeyToEnv(rotated.fiusApiKey);
            status('success', 'New key provisioned');
            return { fiusApiKey: rotated.fiusApiKey, keyId: rotated.keyId };
        }

        status('info', 'Provisioning Fius API key...');
        const provisioned = await apiClient.provisionFiusApiKey(authToken);

        await storeAuth({
            ...auth,
            fiusApiKey: provisioned.fiusApiKey,
            fiusKeyId: provisioned.keyId,
            fiusApiKeySource: 'provisioned',
        });
        await saveFiusApiKeyToEnv(provisioned.fiusApiKey);
        status('success', 'Fius API key provisioned');

        return { fiusApiKey: provisioned.fiusApiKey, keyId: provisioned.keyId };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to ensure FIUS_API_KEY', { error: errorMessage });
        status('error', `Failed to provision Fius API key: ${errorMessage}`);
        return null;
    }
}