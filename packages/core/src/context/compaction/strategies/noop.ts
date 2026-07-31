import type { InternalMessage } from '../../types.js';
import type { ModelLimits } from '../overflow.js';
import type { CompactionRuntimeContext, CompactionSettings, CompactionStrategy } from '../types.js';


export class NoOpCompactionStrategy implements CompactionStrategy {
    readonly name = 'noop';

    private readonly settings: CompactionSettings;

    constructor(
        options: {
            enabled?: boolean | undefined;
            maxContextTokens?: number | undefined;
            thresholdPercent?: number | undefined;
        } = {}
    ) {
        this.settings = {
            enabled: options.enabled ?? true,
            maxContextTokens: options.maxContextTokens,
            thresholdPercent: options.thresholdPercent ?? 0.9,
        };
    }

    getSettings(): CompactionSettings {
        return this.settings;
    }

    getModelLimits(modelContextWindow: number): ModelLimits {
        const capped =
            this.settings.enabled && this.settings.maxContextTokens !== undefined
                ? Math.min(modelContextWindow, this.settings.maxContextTokens)
                : modelContextWindow;

        return { contextWindow: capped };
    }

    shouldCompact(_inputTokens: number, _modelLimits: ModelLimits): boolean {
        return false;
    }

    
    async compact(
        _history: readonly InternalMessage[],
        _context: CompactionRuntimeContext
    ): Promise<InternalMessage[]> {
        return [];
    }
}
