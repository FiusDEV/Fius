import * as path from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';
import {
    getExecutionContext,
    ensureFiusGlobalDirectory,
    getFiusEnvPath,
} from '@fius/agent-management';

/**
 * Multi-layer environment variable loading with context awareness.
 * Loads environment variables in priority order:
 * 1. Shell environment (highest priority)
 * 2. Project .env (if in fius project)
 * 3. Global ~/.fius/.env (fallback)
 *
 * @param startPath Starting directory for project detection
 * @returns Combined environment variables object
 */
export async function loadEnvironmentVariables(
    startPath: string = process.cwd()
): Promise<Record<string, string>> {
    const context = getExecutionContext(startPath);
    const env: Record<string, string> = {};

    const globalEnvPath = path.join(homedir(), '.fius', '.env');
    try {
        const globalResult = dotenv.config({ path: globalEnvPath, processEnv: {} });
        if (globalResult.parsed) {
            Object.assign(env, globalResult.parsed);
        }
    } catch {
    }

    const cwdEnvPath = path.join(process.cwd(), '.env');
    try {
        const cwdResult = dotenv.config({ path: cwdEnvPath, processEnv: {} });
        if (cwdResult.parsed) {
            Object.assign(env, cwdResult.parsed);
        }
    } catch {
    }

    if (context === 'fius-source' || context === 'fius-project') {
        const projectEnvPath = getFiusEnvPath(startPath);
        if (projectEnvPath !== cwdEnvPath) {
            try {
                const projectResult = dotenv.config({ path: projectEnvPath, processEnv: {} });
                if (projectResult.parsed) {
                    Object.assign(env, projectResult.parsed);
                }
            } catch {
            }
        }
    }

    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && value !== '') {
            env[key] = value;
        }
    }

    return env;
}

/**
 * Apply layered environment loading to process.env.
 * This replaces the simple dotenv.config() with multi-layer loading.
 * Should be called at CLI startup before any schema validation.
 *
 * @param startPath Starting directory for project detection
 */
export async function applyLayeredEnvironmentLoading(
    startPath: string = process.cwd()
): Promise<void> {
    await ensureFiusGlobalDirectory();

    const layeredEnv = await loadEnvironmentVariables(startPath);
    Object.assign(process.env, layeredEnv);
}
