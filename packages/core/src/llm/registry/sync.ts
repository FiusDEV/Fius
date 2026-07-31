import type { LLMProvider, SupportedFileType } from '@fius/llm';
import type { ModelInfo } from '@fius/llm';


export async function buildModelsByProviderFromRemote(_options?: {
    modelsDevUrl?: string;
    userAgent?: string;
    timeoutMs?: number;
    logger?: { debug: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}): Promise<Record<string, ModelInfo[]>> {
    return {};
}

export async function buildModelsByProvider(_options?: {
    logger?: { debug: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}): Promise<Record<string, ModelInfo[]>> {
    return {};
}
