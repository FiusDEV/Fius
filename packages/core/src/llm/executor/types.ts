import type { TokenUsage } from '@fius/llm';
import { LLMFinishReason } from '../../events/index.js';

export type ModelToolCall = {
    toolCallId: string;
    toolName: string;
    input: unknown;
};

export interface ExecutorResult {
    text: string;
    stepCount: number;
    usage: TokenUsage | null;
    finishReason: LLMFinishReason;
}

export interface StreamProcessorResult {
    text: string;
    finishReason: LLMFinishReason;
    usage: TokenUsage;
    toolCalls: ModelToolCall[];
}
