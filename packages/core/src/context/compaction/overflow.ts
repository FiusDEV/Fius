import type { TokenUsage } from '@fiusdev/llm';


export interface ModelLimits {
    
    contextWindow: number;
}


export function isOverflow(
    tokens: TokenUsage,
    modelLimits: ModelLimits,
    thresholdPercent: number = 0.9
): boolean {
    const { contextWindow } = modelLimits;
    const effectiveLimit = Math.floor(contextWindow * thresholdPercent);
    const inputTokens = tokens.inputTokens ?? 0;
    return inputTokens > effectiveLimit;
}


export function getCompactionTarget(
    modelLimits: ModelLimits,
    targetPercentage: number = 0.7
): number {
    const { contextWindow } = modelLimits;
    return Math.floor(contextWindow * targetPercentage);
}
