import type { LLMProvider, SupportedFileType } from '@fiusdev/llm';
import type { ModelInfo } from '@fiusdev/llm';


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
