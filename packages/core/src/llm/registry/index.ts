import type { ValidatedLLMConfig } from '../schemas.js';
import type { Logger } from '../../logger/v2/types.js';
import type { LLMProvider, SupportedFileType } from '@fiusdev/llm';


export function getModelInfo(_provider: string, _model: string): any {
    return null;
}

export function getAllModelsForProvider(_provider: string): any[] {
    return [];
}

export function getSupportedFileTypesForModel(_provider: string, _model: string): SupportedFileType[] {
    return ['pdf', 'image'];
}

export function getEffectiveMaxInputTokens(
    config: ValidatedLLMConfig,
    _logger?: Logger
): number {
    return config.maxInputTokens ?? 128000;
}

export function resolveModelOrigin(
    provider: string,
    model: string,
    _logger?: Logger
): { provider: string; model: string } {
    return { provider, model };
}

export function getOpenRouterModelContextLength(model: string): number | undefined {
    return undefined;
}

export function getMaxInputTokensForModel(_provider: string, _model: string, _logger?: any): number {
    return 128000;
}
