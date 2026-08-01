import React from 'react';
import { Sparkles, FlaskConical, Zap } from 'lucide-react';
import type { LLMProvider } from '@fiusdev/llm';

export const PROVIDER_LOGOS: Record<string, string> = {
    fius: '/favicon.png',
};

export const PROVIDER_PRICING_URLS: Partial<Record<string, string>> = {
    fius: 'https://fius.dev/pricing',
};

export function formatPricingLines(pricing?: {
    inputPerM?: number;
    outputPerM?: number;
    cacheReadPerM?: number;
    cacheWritePerM?: number;
    currency?: 'USD';
    unit?: 'per_million_tokens';
}): string[] {
    if (!pricing) return [];
    if (pricing.inputPerM == null || pricing.outputPerM == null) return [];
    const currency = pricing.currency || 'USD';
    const cur = currency === 'USD' ? '$' : '';
    const lines: string[] = [];
    lines.push(
        `Cost: ${cur}${pricing.inputPerM.toFixed(2)} in / ${cur}${pricing.outputPerM.toFixed(2)} out per 1M tokens`
    );
    if (pricing.cacheReadPerM != null) {
        lines.push(`Cache read: ${cur}${pricing.cacheReadPerM.toFixed(2)} per 1M tokens`);
    }
    if (pricing.cacheWritePerM != null) {
        lines.push(`Cache write: ${cur}${pricing.cacheWritePerM.toFixed(2)} per 1M tokens`);
    }
    return lines;
}

export const COLORED_LOGOS: readonly string[] = [
    'fius',
] as const;

export const needsDarkModeInversion = (provider: string): boolean => {
    return !COLORED_LOGOS.includes(provider);
};

export const hasLogo = (provider: string): boolean => {
    return !!PROVIDER_LOGOS[provider];
};

export const CAPABILITY_ICONS = {
    image: <span className="text-sm">🖼️</span>,
    audio: <span className="text-sm">🎵</span>,
    video: <span className="text-sm">🎬</span>,
    pdf: <span className="text-sm">📄</span>,
    document: <span className="text-sm">📝</span>,

    reasoning: <span className="text-sm">🧠</span>,
    experimental: (
        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground hover:text-amber-500 transition-colors cursor-help" />
    ),
    new: (
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground hover:text-yellow-500 transition-colors cursor-help" />
    ),
    realtime: (
        <Zap className="h-3.5 w-3.5 text-muted-foreground hover:text-blue-500 transition-colors cursor-help" />
    ),
};
