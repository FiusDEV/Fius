import { readFileSync, existsSync } from 'fs';
import { getFiusGlobalPath } from '@fius/core';
import { getModelDisplayName } from '@fius/llm';

export interface PlatformModel {
    name: string;
    displayName: string;
    provider: string; // "fius" for all gateway models
}

export interface PlatformModelsResult {
    plan: string;
    models: PlatformModel[];
}

function readFiusApiKey(): string | null {
    try {
        const authPath = getFiusGlobalPath('', 'auth.json');
        if (!existsSync(authPath)) return null;
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
        return auth.fiusApiKey || null;
    } catch {
        return null;
    }
}


export async function fetchPlatformModels(): Promise<PlatformModelsResult> {
    try {
        const apiKey = readFiusApiKey();
        if (!apiKey) return { plan: 'free', models: [] };

        const baseUrl = process.env.FIUS_PLATFORM_URL || process.env.FIUS_API_URL || 'https://fius.dev';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const resp = await fetch(`${baseUrl}/api/cli/user`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) return { plan: 'free', models: [] };

        const data = await resp.json();
        const plan = data.plan || 'free';
        const allowedModels: string[] = Array.isArray(data.allowed_models) ? data.allowed_models : [];
        const planModels: string[] = Array.isArray(data.plan_models) ? data.plan_models : [];

        const effectiveModels = allowedModels.length > 0 ? allowedModels : planModels;

        const models: PlatformModel[] = effectiveModels.map((name) => ({
            name,
            displayName: getModelDisplayName(name),
            provider: 'fius',
        }));

        const result = { plan, models };
        return result;
    } catch {
        return { plan: 'free', models: [] };
    }
}
