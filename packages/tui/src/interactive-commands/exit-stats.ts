

import type { SessionMetadata } from '@fius/core';

type ExitTokenUsage = NonNullable<SessionMetadata['tokenUsage']>;

const TOKEN_USAGE_FIELDS: ReadonlyArray<keyof ExitTokenUsage> = [
    'inputTokens',
    'outputTokens',
    'reasoningTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens',
];

export interface ExitSessionStats {
    sessionId?: string;
    duration?: string;
    messageCount: {
        total: number;
        user: number;
        assistant: number;
    };
    tokenUsage?: NonNullable<SessionMetadata['tokenUsage']>;
    estimatedCost?: SessionMetadata['estimatedCost'];
    modelStats?: NonNullable<SessionMetadata['modelStats']>;
    usageNote?: string;
}

let exitStats: ExitSessionStats | null = null;

export function setExitStats(stats: ExitSessionStats): void {
    exitStats = stats;
}

export function getExitStats(): ExitSessionStats | null {
    return exitStats;
}

export function clearExitStats(): void {
    exitStats = null;
}

export function hasMeaningfulTokenUsage(
    tokenUsage: SessionMetadata['tokenUsage'] | undefined
): tokenUsage is ExitTokenUsage {
    if (!tokenUsage) {
        return false;
    }

    return TOKEN_USAGE_FIELDS.some((field) => (tokenUsage[field] ?? 0) > 0);
}
