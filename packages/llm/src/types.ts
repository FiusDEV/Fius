export const LLM_PROVIDERS = ['fius'] as readonly string[];
export type LLMProvider = string;

export const LLM_PRICING_STATUSES = ['estimated', 'unpriced'] as const;
export type LLMPricingStatus = (typeof LLM_PRICING_STATUSES)[number];

export const SUPPORTED_FILE_TYPES = ['pdf', 'image', 'audio', 'video', 'document'] as const;
export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];

export type ReasoningVariant = string;

export interface LLMReasoningConfig {
    variant: ReasoningVariant;
    budgetTokens?: number | undefined;
}

/**
 * Context interface for message formatters.
 * Provides runtime information for model-aware processing.
 */
export interface LLMContext {
    provider: LLMProvider;
    model: string;
    displayName?: string;
}

export interface LLMUpdateContext {
    provider?: LLMProvider;
    model?: string;
    suggestedAction?: string;
}

export interface TokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}
