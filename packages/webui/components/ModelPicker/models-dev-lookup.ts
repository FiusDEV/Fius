/**
 * Shared utility for looking up model capabilities from models.dev
 */

interface ModelsDevModel {
    name: string;
    description?: string;
    limit?: { context?: number; output?: number };
    modalities?: { input?: string; output?: string };
    cost?: { input?: number; output?: number };
    reasoning?: boolean;
    tool_call?: boolean;
    structured_output?: boolean;
    temperature?: boolean;
    attachment?: boolean;
}

export interface ModelCapabilities {
    fileTypes: string[];
    tools: boolean;
    reasoning: boolean;
    structured: boolean;
    temperature: boolean;
    attachment: boolean;
}

interface ModelsDevProvider {
    name: string;
    api?: string;
    env?: string[];
    models: Record<string, ModelsDevModel>;
}

type ModelsDevData = Record<string, ModelsDevProvider>;

let cachedData: ModelsDevData | null = null;
let cachePromise: Promise<ModelsDevData> | null = null;

async function fetchModelsDevData(): Promise<ModelsDevData> {
    if (cachedData) return cachedData;
    if (cachePromise) return cachePromise;

    cachePromise = (async () => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const resp = await fetch('https://models.dev/api.json', { signal: controller.signal });
            clearTimeout(timeout);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            cachedData = data;
            return data;
        } catch {
            cachePromise = null;
            return {};
        }
    })();

    return cachePromise;
}

function containsModality(value: string | string[] | undefined, target: string): boolean {
    if (!value) return false;
    if (Array.isArray(value)) return value.includes(target);
    return String(value).includes(target);
}

export function getSupportedFileTypesFromModelsDev(model: ModelsDevModel): string[] {
    const types: string[] = [];
    const input = model.modalities?.input;
    const output = model.modalities?.output;
    if (containsModality(input, 'image') || containsModality(output, 'image')) types.push('image');
    if (containsModality(input, 'audio') || containsModality(output, 'audio')) types.push('audio');
    if (containsModality(input, 'video') || containsModality(output, 'video')) types.push('video');
    if (containsModality(input, 'pdf') || containsModality(output, 'pdf')) types.push('pdf');
    if (containsModality(input, 'document') || containsModality(output, 'document')) types.push('document');
    return types;
}

export function getModelCapabilitiesFromModelsDev(model: ModelsDevModel): ModelCapabilities {
    return {
        fileTypes: getSupportedFileTypesFromModelsDev(model),
        tools: model.tool_call ?? false,
        reasoning: model.reasoning ?? false,
        structured: model.structured_output ?? false,
        temperature: model.temperature ?? false,
        attachment: model.attachment ?? false,
    };
}

/**
 * Look up a model on models.dev by provider display name and model name.
 * Returns ModelCapabilities if found, undefined if not found.
 * Only searches within the matched provider — never guesses from other providers.
 *
 * Search strategy:
 * 1. Try exact provider ID match (lowercase displayProvider)
 * 2. Try all providers, match by provider name (case-insensitive)
 * 3. If provider found, search for model within that provider only
 */
export async function lookupModelCapabilities(
    displayProvider: string,
    modelName: string
): Promise<ModelCapabilities | undefined> {
    if (!displayProvider || !modelName) return undefined;

    const data = await fetchModelsDevData();
    if (!data || Object.keys(data).length === 0) return undefined;

    const normalizedModelName = modelName.trim().toLowerCase();
    const normalizedProvider = displayProvider.trim().toLowerCase();

    let provider = data[normalizedProvider];

    if (!provider) {
        for (const [id, p] of Object.entries(data)) {
            if (p.name?.toLowerCase() === normalizedProvider) {
                provider = p;
                break;
            }
        }
    }

    if (provider?.models) {
        if (provider.models[normalizedModelName]) {
            return getModelCapabilitiesFromModelsDev(provider.models[normalizedModelName]);
        }

        const slashIdx = normalizedModelName.indexOf('/');
        if (slashIdx !== -1) {
            const modelId = normalizedModelName.slice(slashIdx + 1);
            if (provider.models[modelId]) {
                return getModelCapabilitiesFromModelsDev(provider.models[modelId]);
            }
        }

        for (const [id, model] of Object.entries(provider.models)) {
            if (id.toLowerCase().includes(normalizedModelName) || normalizedModelName.includes(id.toLowerCase())) {
                return getModelCapabilitiesFromModelsDev(model);
            }
        }
    }

    return undefined;
}
