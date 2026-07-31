import type { LLMProvider, LLMReasoningConfig } from '@fius/llm';

export interface ProviderOptionsConfig {
    provider: LLMProvider;
    model: string;
    reasoning?: LLMReasoningConfig | undefined;
}

export function buildProviderOptions(
    _config: ProviderOptionsConfig
): Record<string, Record<string, unknown>> | undefined {
    return undefined;
}

export function getEffectiveReasoningBudgetTokens(
    _providerOptions?: Record<string, Record<string, unknown>> | null,
    _reasoning?: LLMReasoningConfig,
    _provider?: LLMProvider,
    _model?: string
): number | undefined {
    return _reasoning?.budgetTokens;
}
