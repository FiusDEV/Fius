import type { CompactionStrategy } from '../../context/compaction/types.js';
import type { LanguageModel } from 'ai';
import type { CodexRateLimitSnapshot } from '../providers/codex-app-server.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import type { LlmAuthResolver } from '../auth/types.js';
import type { Logger } from '../../logger/v2/types.js';
import type { LLMProvider } from '@fius/llm';
import type { MessageQueueService } from '../../session/message-queue.js';
import type { AgentRunContext } from '../../runtime/run-context.js';
import type { TurnDriverState } from '../executor/turn-executor.js';

export type LLMServiceConfig = {
    provider: LLMProvider;
    model: LanguageModel;
    configuredMaxInputTokens?: number | null;
    modelMaxInputTokens?: number | null;
};

export interface CreateLLMServiceOptions {
    usageScopeId?: string | undefined;
    compactionStrategy?: CompactionStrategy | null | undefined;
    executionControl?: LLMExecutionControl | undefined;
    cwd?: string | undefined;
    authResolver?: LlmAuthResolver | null | undefined;
    steerQueue: MessageQueueService;
    followUpQueue: MessageQueueService;
}

export type LLMExecutionControl = {
    followUpQueueMode?: 'core-continuation' | 'host-run' | undefined;
};

export type CreateTurnDriverOptions = {
    streaming?: boolean;
    signal?: AbortSignal;
    runContext?: AgentRunContext;
    state?: TurnDriverState;
};

export interface FiusProviderContext {
    sessionId?: string;
    clientSource?: 'cli' | 'web' | 'sdk';
    cwd?: string;
    authResolver?: LlmAuthResolver | null;
    logger?: Logger | undefined;
    onCodexRateLimitStatus?: (snapshot: CodexRateLimitSnapshot) => void;
}

export interface LanguageModelFactoryInput {
    config: ValidatedLLMConfig;
    context: FiusProviderContext;
}

export interface LanguageModelFactoryContext extends LanguageModelFactoryInput {
    createDefaultLanguageModel: () => Promise<LanguageModel>;
}

export type LanguageModelFactory = (context: LanguageModelFactoryContext) => Promise<LanguageModel>;

export interface LLMTokenUsage {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}
