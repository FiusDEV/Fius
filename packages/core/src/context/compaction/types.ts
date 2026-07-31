import type { LanguageModel } from 'ai';
import type { Logger } from '../../logger/v2/types.js';
import type { InternalMessage } from '../types.js';
import type { ModelLimits } from './overflow.js';

export interface CompactionSettings {
    enabled: boolean;
    
    maxContextTokens?: number | undefined;
    
    thresholdPercent: number;
}

export interface CompactionRuntimeContext {
    sessionId: string;
    model: LanguageModel;
    logger: Logger;
}


export type CompactionStrategy = {
    
    readonly name: string;

    
    getSettings(): CompactionSettings;

    
    getModelLimits(modelContextWindow: number): ModelLimits;

    
    shouldCompact(inputTokens: number, modelLimits: ModelLimits): boolean;

    
    compact(
        history: readonly InternalMessage[],
        context: CompactionRuntimeContext
    ): Promise<InternalMessage[]>;
};
