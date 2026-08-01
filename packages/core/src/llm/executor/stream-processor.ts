import { StreamTextResult, ToolSet as VercelToolSet } from 'ai';
import { ContextManager } from '../../context/manager.js';
import { SessionEventBus, LLMFinishReason } from '../../events/index.js';
import { StreamProcessorResult } from './types.js';
import type { AssistantOutputLifecycle, SanitizedToolResult } from '../../context/types.js';
import type { Logger } from '../../logger/v2/types.js';
import { FiusLogComponent } from '../../logger/v2/types.js';
import type { ModelToolCall } from './types.js';
import { getUsagePricingMetadata } from '../usage-metadata.js';
import type { TokenUsageCostBreakdown } from '@fiusdev/llm';
import type { LLMProvider, LLMPricingStatus, ReasoningVariant, TokenUsage } from '@fiusdev/llm';
import { extractProviderErrorDetails, mapProviderError } from './provider-error.js';

type UsageLike = {
    inputTokens?: number | null | undefined;
    outputTokens?: number | null | undefined;
    totalTokens?: number | null | undefined;
    reasoningTokens?: number | null | undefined;
    cachedInputTokens?: number | null | undefined;
    inputTokenDetails?: {
        noCacheTokens?: number | null | undefined;
        cacheReadTokens?: number | null | undefined;
        cacheWriteTokens?: number | null | undefined;
    };
};

function finiteUsageCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

type FullStreamPart =
    StreamTextResult<VercelToolSet, unknown>['fullStream'] extends AsyncIterable<infer Part>
        ? Part
        : never;

function assistantOutputForFinishReason(finishReason: LLMFinishReason): AssistantOutputLifecycle {
    switch (finishReason) {
        case 'cancelled':
            return { status: 'stopped', reason: 'cancelled' };
        case 'error':
            return { status: 'stopped', reason: 'failed' };
        default:
            return { status: 'complete' };
    }
}

type ToolInputStartEvent = Extract<FullStreamPart, { type: 'tool-input-start' }> & {
    toolCallId?: string;
    toolName?: string;
    id?: string;
    name?: string;
};

type ToolInputDeltaEvent = Extract<FullStreamPart, { type: 'tool-input-delta' }> & {
    toolCallId?: string;
    toolName?: string;
    inputTextDelta?: string;
    argsTextDelta?: string;
    delta?: string;
    textDelta?: string;
    id?: string;
    name?: string;
};

type ToolInputEndEvent = Extract<FullStreamPart, { type: 'tool-input-end' }> & {
    toolCallId?: string;
    id?: string;
};

export interface StreamProcessorConfig {
    provider: LLMProvider;
    model: string;
    displayName?: string;
    usageScopeId?: string;
    estimatedInputTokens?: number;
    reasoningVariant?: ReasoningVariant;
    reasoningBudgetTokens?: number;
}

export class StreamProcessor {
    private assistantMessageId: string | null = null;
    private actualTokens: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    private finishReason: LLMFinishReason = 'unknown';
    private reasoningText: string = '';
    private reasoningMetadata: Record<string, unknown> | undefined;
    private accumulatedText: string = '';
    private logger: Logger;
    private hasStepUsage = false;
    private readonly usageScopeId: string | undefined;
    private modelToolCalls: ModelToolCall[] = [];
    private pendingToolCalls: Map<string, { toolName: string }> = new Map();
    private partialToolCalls: Map<string, { toolName: string; argsText: string }> = new Map();

    constructor(
        private contextManager: ContextManager,
        private eventBus: SessionEventBus,
        private abortSignal: AbortSignal,
        private config: StreamProcessorConfig,
        logger: Logger,
        private streaming: boolean = true,
        private emitFatalErrors: boolean = true
    ) {
        this.logger = logger.createChild(FiusLogComponent.EXECUTOR);
        this.usageScopeId = config.usageScopeId;
    }

    async process(
        streamFn: () => StreamTextResult<VercelToolSet, unknown>
    ): Promise<StreamProcessorResult> {
        const startedAtMs = Date.now();
        const markTiming = (name: string): number => {
            return Date.now() - startedAtMs;
        };
        const stream = streamFn();
        let lastDeltaReceivedAtMs: number | null = null;
        let lastReasoningDeltaReceivedAtMs: number | null = null;
        let lastTextDeltaReceivedAtMs: number | null = null;
        let reasoningDeltaCount = 0;
        let textDeltaCount = 0;

        const handleToolInputStart = (evt: ToolInputStartEvent) => {
            const toolCallId = evt.toolCallId ?? evt.id ?? undefined;
            const toolName = evt.toolName ?? evt.name ?? 'unknown';
            if (toolCallId) {
                this.partialToolCalls.set(toolCallId, { toolName, argsText: '' });
            }
        };

        const handleToolInputDelta = (evt: ToolInputDeltaEvent) => {
            const toolCallId = evt.toolCallId ?? evt.id ?? undefined;
            const toolName = evt.toolName ?? evt.name ?? 'unknown';
            if (!toolCallId) return;
            const entry = this.partialToolCalls.get(toolCallId) ?? { toolName, argsText: '' };
            const deltaText =
                evt.argsTextDelta ?? evt.inputTextDelta ?? evt.delta ?? evt.textDelta ?? '';
            if (typeof deltaText === 'string' && deltaText.length > 0) {
                entry.argsText += deltaText;
                this.partialToolCalls.set(toolCallId, entry);
                const parsed = tryParsePartialJson(entry.argsText);
                if (parsed) {
                    this.eventBus.emit('llm:tool-call-partial', {
                        toolName: entry.toolName,
                        args: parsed,
                        callId: toolCallId,
                    });
                }
            }
        };

        const handleToolInputEnd = (evt: ToolInputEndEvent) => {
            const toolCallId = evt.toolCallId ?? evt.id ?? undefined;
            const entry = toolCallId ? this.partialToolCalls.get(toolCallId) : undefined;
            if (toolCallId && entry) {
                const parsed = tryParsePartialJson(entry.argsText);
                if (parsed) {
                    this.eventBus.emit('llm:tool-call-partial', {
                        toolName: entry.toolName,
                        args: parsed,
                        callId: toolCallId,
                        isComplete: true,
                    });
                }
                this.partialToolCalls.delete(toolCallId);
            }
        };

        try {
            for await (const event of stream.fullStream) {
                switch (event.type) {
                    case 'text-delta':
                        if (textDeltaCount === 0) {
                            markTiming('first_text_delta_received');
                        }
                        textDeltaCount += 1;
                        lastTextDeltaReceivedAtMs = markTiming('last_text_delta_received');
                        lastDeltaReceivedAtMs = lastTextDeltaReceivedAtMs;
                        if (!this.assistantMessageId) {
                            this.assistantMessageId = await this.contextManager.addAssistantMessage(
                                '',
                                [],
                                {
                                    assistantOutput: { status: 'draft' },
                                }
                            );
                        }

                        await this.contextManager.appendAssistantText(
                            this.assistantMessageId!,
                            event.text
                        );

                        this.accumulatedText += event.text;

                        if (this.streaming) {
                            this.eventBus.emit('llm:chunk', {
                                chunkType: 'text',
                                content: event.text,
                            });
                        }
                        markTiming('last_text_delta_emitted');
                        break;

                    case 'reasoning-delta':
                        if (reasoningDeltaCount === 0) {
                            markTiming('first_reasoning_delta_received');
                        }
                        reasoningDeltaCount += 1;
                        lastReasoningDeltaReceivedAtMs = markTiming(
                            'last_reasoning_delta_received'
                        );
                        lastDeltaReceivedAtMs = lastReasoningDeltaReceivedAtMs;
                        this.reasoningText += event.text;

                        if (event.providerMetadata) {
                            this.mergeReasoningMetadata(event.providerMetadata);
                        }

                        if (this.streaming) {
                            this.eventBus.emit('llm:chunk', {
                                chunkType: 'reasoning',
                                content: event.text,
                            });
                        }
                        markTiming('last_reasoning_delta_emitted');
                        break;

                    case 'tool-input-start': {
                        handleToolInputStart(event);
                        break;
                    }

                    case 'tool-input-delta': {
                        handleToolInputDelta(event);
                        break;
                    }

                    case 'tool-input-end': {
                        handleToolInputEnd(event);
                        break;
                    }

                    case 'tool-call': {
                        if (!this.assistantMessageId) {
                            this.assistantMessageId = await this.createAssistantMessage();
                        }

                        const toolCall: Parameters<typeof this.contextManager.addToolCall>[1] = {
                            id: event.toolCallId,
                            type: 'function',
                            function: {
                                name: event.toolName,
                                arguments: JSON.stringify(event.input),
                            },
                        };
                        const shouldPersistProviderMetadata =
                            this.config.provider === 'google' || this.config.provider === 'vertex';

                        if (shouldPersistProviderMetadata && event.providerMetadata) {
                            toolCall.providerOptions = {
                                ...event.providerMetadata,
                            } as Record<string, unknown>;
                        }

                        await this.contextManager.addToolCall(this.assistantMessageId!, toolCall);
                        this.modelToolCalls.push({
                            toolCallId: event.toolCallId,
                            toolName: event.toolName,
                            input: event.input,
                        });

                        this.pendingToolCalls.set(event.toolCallId, {
                            toolName: event.toolName,
                        });
                        this.partialToolCalls.delete(event.toolCallId);

                        break;
                    }

                    case 'finish-step':
                        if (event.usage) {
                            const providerMetadata = this.getProviderMetadata(event);
                            const stepUsage = this.normalizeUsage(event.usage, providerMetadata);

                            this.actualTokens = {
                                inputTokens:
                                    (this.actualTokens.inputTokens ?? 0) +
                                    (stepUsage.inputTokens ?? 0),
                                outputTokens:
                                    (this.actualTokens.outputTokens ?? 0) +
                                    (stepUsage.outputTokens ?? 0),
                                totalTokens:
                                    (this.actualTokens.totalTokens ?? 0) +
                                    (stepUsage.totalTokens ?? 0),
                                ...(stepUsage.reasoningTokens !== undefined && {
                                    reasoningTokens:
                                        (this.actualTokens.reasoningTokens ?? 0) +
                                        stepUsage.reasoningTokens,
                                }),
                                cacheReadTokens:
                                    (this.actualTokens.cacheReadTokens ?? 0) +
                                    (stepUsage.cacheReadTokens ?? 0),
                                cacheWriteTokens:
                                    (this.actualTokens.cacheWriteTokens ?? 0) +
                                    (stepUsage.cacheWriteTokens ?? 0),
                            };
                            this.hasStepUsage = true;
                        }
                        break;

                    case 'finish': {
                        const finishEventReceivedAtMs = markTiming('finish_event_received');
                        this.finishReason = event.finishReason;

                        const providerMetadata = this.getProviderMetadata(event);
                        const fallbackUsage = this.normalizeUsage(
                            event.totalUsage,
                            providerMetadata
                        );
                        const usage = this.hasStepUsage ? { ...this.actualTokens } : fallbackUsage;

                        if (this.hasStepUsage) {
                            const fallbackInput = fallbackUsage.inputTokens ?? 0;
                            if ((usage.inputTokens ?? 0) === 0 && fallbackInput > 0) {
                                this.logger.debug(
                                    'Backfilling inputTokens from fallback usage (step reported 0)',
                                    { stepValue: usage.inputTokens, fallbackValue: fallbackInput }
                                );
                                usage.inputTokens = fallbackInput;
                            }
                            const fallbackOutput = fallbackUsage.outputTokens ?? 0;
                            if ((usage.outputTokens ?? 0) === 0 && fallbackOutput > 0) {
                                this.logger.debug(
                                    'Backfilling outputTokens from fallback usage (step reported 0)',
                                    { stepValue: usage.outputTokens, fallbackValue: fallbackOutput }
                                );
                                usage.outputTokens = fallbackOutput;
                            }
                            const fallbackCacheRead = fallbackUsage.cacheReadTokens ?? 0;
                            if ((usage.cacheReadTokens ?? 0) === 0 && fallbackCacheRead > 0) {
                                usage.cacheReadTokens = fallbackCacheRead;
                            }
                            const fallbackCacheWrite = fallbackUsage.cacheWriteTokens ?? 0;
                            if ((usage.cacheWriteTokens ?? 0) === 0 && fallbackCacheWrite > 0) {
                                usage.cacheWriteTokens = fallbackCacheWrite;
                            }
                            const fallbackTotalTokens = fallbackUsage.totalTokens ?? 0;
                            if ((usage.totalTokens ?? 0) === 0 && fallbackTotalTokens > 0) {
                                usage.totalTokens = fallbackTotalTokens;
                            }
                            if (
                                usage.reasoningTokens === undefined &&
                                fallbackUsage.reasoningTokens !== undefined
                            ) {
                                usage.reasoningTokens = fallbackUsage.reasoningTokens;
                            }
                        }

                        this.actualTokens = usage;

                        const pricingMetadata = getUsagePricingMetadata({
                            provider: this.config.provider,
                            model: this.config.model,
                            tokenUsage: usage,
                        });

                        this.logger.info('LLM response complete', {
                            finishReason: event.finishReason,
                            contentLength: this.accumulatedText.length,
                            ...(this.reasoningText && {
                                reasoningLength: this.reasoningText.length,
                            }),
                            usage,
                            provider: this.config.provider,
                            model: this.config.model,
                        });

                        markTiming('metadata_persist_started');
                        await this.persistAssistantResponseMetadata(
                            usage,
                            pricingMetadata,
                            assistantOutputForFinishReason(this.finishReason)
                        );
                        markTiming('metadata_persist_finished');

                        markTiming('llm_response_emit_started');
                        this.emitLLMResponse({
                            tokenUsage: usage,
                            finishReason: this.finishReason,
                            ...pricingMetadata,
                        });
                        markTiming('llm_response_emitted');
                        break;
                    }

                    case 'error': {
                        const err = mapProviderError({
                            error: event.error,
                            provider: this.config.provider,
                            model: this.config.model,
                        });
                        await this.persistFailedToolResults(err.message);
                        throw event.error;
                    }

                    case 'abort': {
                        this.logger.debug('Stream aborted, emitting partial response');
                        this.finishReason = 'cancelled';

                        await this.persistCancelledToolResults();

                        const abortPricingMetadata = getUsagePricingMetadata({
                            provider: this.config.provider,
                            model: this.config.model,
                            tokenUsage: this.actualTokens,
                        });
                        await this.persistAssistantResponseMetadata(
                            this.actualTokens,
                            abortPricingMetadata,
                            { status: 'stopped', reason: 'cancelled' }
                        );

                        this.emitLLMResponse({
                            tokenUsage: this.actualTokens,
                            finishReason: 'cancelled',
                            ...abortPricingMetadata,
                        });

                        return {
                            text: this.accumulatedText,
                            finishReason: 'cancelled',
                            usage: this.actualTokens,
                            toolCalls: this.modelToolCalls,
                        };
                    }
                }
            }
        } catch (error) {
            const isAbortError =
                (error instanceof Error && error.name === 'AbortError') || this.abortSignal.aborted;

            if (isAbortError) {
                this.logger.debug('Stream cancelled, emitting partial response');
                this.finishReason = 'cancelled';

                await this.persistCancelledToolResults();

                const abortPricingMetadata = getUsagePricingMetadata({
                    provider: this.config.provider,
                    model: this.config.model,
                    tokenUsage: this.actualTokens,
                });
                await this.persistAssistantResponseMetadata(
                    this.actualTokens,
                    abortPricingMetadata,
                    { status: 'stopped', reason: 'cancelled' }
                );

                this.emitLLMResponse({
                    tokenUsage: this.actualTokens,
                    finishReason: 'cancelled',
                    ...abortPricingMetadata,
                });

                return {
                    text: this.accumulatedText,
                    finishReason: 'cancelled',
                    usage: this.actualTokens,
                    toolCalls: this.modelToolCalls,
                };
            }

            const mappedError = mapProviderError({
                error,
                provider: this.config.provider,
                model: this.config.model,
            });
            const failurePricingMetadata = getUsagePricingMetadata({
                provider: this.config.provider,
                model: this.config.model,
                tokenUsage: this.actualTokens,
            });
            await this.persistAssistantResponseMetadata(this.actualTokens, failurePricingMetadata, {
                status: 'stopped',
                reason: 'failed',
            });

            if (!this.emitFatalErrors) {
                this.logger.error('Stream processing failed', { error: mappedError });
                throw error;
            }

            if (this.emitFatalErrors) {
                this.eventBus.emit('llm:error', {
                    error: mappedError,
                    context: 'StreamProcessor',
                    recoverable: false,
                    details: extractProviderErrorDetails({
                        error,
                        provider: this.config.provider,
                        model: this.config.model,
                    }),
                });
            }
            this.logger.error('Stream processing failed', { error: mappedError });
            throw mappedError;
        }

        markTiming('full_stream_iterator_completed');

        if (this.modelToolCalls.length === 0 && this.accumulatedText) {
            const parsed = this.parseTextToolCalls(this.accumulatedText);
            if (parsed.toolCalls.length > 0) {
                this.modelToolCalls.push(...parsed.toolCalls);
                if (parsed.cleanText !== undefined) {
                    this.accumulatedText = parsed.cleanText;
                }
            }
        }

        return {
            text: this.accumulatedText,
            finishReason: this.finishReason,
            usage: this.actualTokens,
            toolCalls: this.modelToolCalls,
        };
    }

    private parseTextToolCalls(text: string): { toolCalls: ModelToolCall[]; cleanText?: string } {
        const toolCalls: ModelToolCall[] = [];
        let cleanText = text;

        const jsonBlockRegex = /```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/g;
        const inlineJsonRegex = /\{"(?:tool|toolName)"\s*:\s*"[^"]+"[\s\S]*?\}/g;

        const extractToolCall = (jsonStr: string): ModelToolCall | null => {
            try {
                const obj = JSON.parse(jsonStr);
                let toolName: string | undefined;
                let input: Record<string, unknown> = {};

                if (obj.tool && typeof obj.tool === 'string') {
                    toolName = obj.tool;
                    const { tool, ...rest } = obj;
                    input = rest;
                } else if (obj.toolName && typeof obj.toolName === 'string') {
                    toolName = obj.toolName;
                    input = obj.input || {};
                }

                if (toolName) {
                    return {
                        toolCallId: `text-parsed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        toolName,
                        input,
                    };
                }
            } catch {
            }
            return null;
        };

        let match;
        while ((match = jsonBlockRegex.exec(text)) !== null) {
            const jsonStr = match[1];
            if (jsonStr) {
                const tc = extractToolCall(jsonStr);
                if (tc) {
                    toolCalls.push(tc);
                    cleanText = cleanText.replace(match[0], '').trim();
                }
            }
        }

        if (toolCalls.length === 0) {
            while ((match = inlineJsonRegex.exec(text)) !== null) {
                const tc = extractToolCall(match[0]);
                if (tc) {
                    toolCalls.push(tc);
                    cleanText = cleanText.replace(match[0], '').trim();
                }
            }
        }

        if (toolCalls.length > 0) {
            return { toolCalls, cleanText };
        }
        return { toolCalls };
    }

    private getCacheTokensFromProviderMetadata(
        providerMetadata: Record<string, unknown> | undefined
    ): { cacheReadTokens: number; cacheWriteTokens: number } {
        const anthropicMeta = providerMetadata?.['anthropic'] as Record<string, number> | undefined;
        const bedrockMeta = providerMetadata?.['bedrock'] as
            | { usage?: Record<string, number> }
            | undefined;

        const cacheWriteTokens =
            finiteUsageCount(anthropicMeta?.['cacheCreationInputTokens']) ??
            finiteUsageCount(bedrockMeta?.usage?.['cacheWriteInputTokens']) ??
            0;
        const cacheReadTokens =
            finiteUsageCount(anthropicMeta?.['cacheReadInputTokens']) ??
            finiteUsageCount(bedrockMeta?.usage?.['cacheReadInputTokens']) ??
            0;

        return { cacheReadTokens, cacheWriteTokens };
    }

    private normalizeUsage(
        usage: UsageLike | undefined,
        providerMetadata?: Record<string, unknown>
    ): TokenUsage {
        const inputTokensRaw = finiteUsageCount(usage?.inputTokens) ?? 0;
        const outputTokens = finiteUsageCount(usage?.outputTokens) ?? 0;
        const totalTokens = finiteUsageCount(usage?.totalTokens) ?? 0;
        const reasoningTokens = finiteUsageCount(usage?.reasoningTokens);
        const cachedInputTokens = finiteUsageCount(usage?.cachedInputTokens);
        const inputTokenDetails = usage?.inputTokenDetails;

        const providerCache = this.getCacheTokensFromProviderMetadata(providerMetadata);
        const cacheReadTokens =
            finiteUsageCount(inputTokenDetails?.cacheReadTokens) ??
            cachedInputTokens ??
            providerCache.cacheReadTokens ??
            0;
        const cacheWriteTokens =
            finiteUsageCount(inputTokenDetails?.cacheWriteTokens) ??
            providerCache.cacheWriteTokens ??
            0;

        const needsCacheWriteAdjustment =
            inputTokenDetails === undefined &&
            cachedInputTokens !== undefined &&
            providerCache.cacheWriteTokens > 0;
        const noCacheTokens =
            finiteUsageCount(inputTokenDetails?.noCacheTokens) ??
            (cachedInputTokens !== undefined
                ? inputTokensRaw -
                  cachedInputTokens -
                  (needsCacheWriteAdjustment ? providerCache.cacheWriteTokens : 0)
                : inputTokensRaw);

        return {
            inputTokens: Math.max(0, noCacheTokens),
            outputTokens,
            totalTokens,
            ...(reasoningTokens !== undefined && { reasoningTokens }),
            cacheReadTokens,
            cacheWriteTokens,
        };
    }

    private getProviderMetadata(
        event: Record<string, unknown>
    ): Record<string, unknown> | undefined {
        const metadata =
            'providerMetadata' in event
                ? (event as { providerMetadata?: Record<string, unknown> }).providerMetadata
                : undefined;
        if (!metadata || typeof metadata !== 'object') {
            return undefined;
        }
        return metadata;
    }

    private getReasoningResponseFields(): {
        reasoningVariant?: ReasoningVariant;
        reasoningBudgetTokens?: number;
    } {
        return {
            ...(this.config.reasoningVariant !== undefined && {
                reasoningVariant: this.config.reasoningVariant,
            }),
            ...(this.config.reasoningBudgetTokens !== undefined && {
                reasoningBudgetTokens: this.config.reasoningBudgetTokens,
            }),
        };
    }

    private emitLLMResponse(config: {
        tokenUsage: TokenUsage;
        finishReason: LLMFinishReason;
        estimatedCost?: number;
        costBreakdown?: TokenUsageCostBreakdown;
        pricingStatus?: LLMPricingStatus;
    }): void {
        this.eventBus.emit('llm:response', {
            content: this.accumulatedText,
            ...(this.reasoningText && { reasoning: this.reasoningText }),
            provider: this.config.provider,
            model: this.config.model,
            ...(this.config.displayName && { displayName: this.config.displayName }),
            ...this.getReasoningResponseFields(),
            tokenUsage: config.tokenUsage,
            ...(this.assistantMessageId && { messageId: this.assistantMessageId }),
            ...(this.usageScopeId && { usageScopeId: this.usageScopeId }),
            ...(config.estimatedCost !== undefined && {
                estimatedCost: config.estimatedCost,
            }),
            ...(config.costBreakdown && {
                costBreakdown: config.costBreakdown,
            }),
            ...(config.pricingStatus && { pricingStatus: config.pricingStatus }),
            ...(this.config.estimatedInputTokens !== undefined && {
                estimatedInputTokens: this.config.estimatedInputTokens,
            }),
            finishReason: config.finishReason,
        });
    }

    private async persistAssistantResponseMetadata(
        tokenUsage: TokenUsage,
        pricingMetadata: ReturnType<typeof getUsagePricingMetadata>,
        assistantOutput: AssistantOutputLifecycle
    ): Promise<void> {
        if (!this.assistantMessageId) {
            return;
        }

        await this.contextManager.updateAssistantMessage(this.assistantMessageId, {
            tokenUsage,
            ...(pricingMetadata.estimatedCost !== undefined && {
                estimatedCost: pricingMetadata.estimatedCost,
            }),
            ...(pricingMetadata.pricingStatus && {
                pricingStatus: pricingMetadata.pricingStatus,
            }),
            ...(this.usageScopeId && {
                usageScopeId: this.usageScopeId,
            }),
            ...(this.reasoningText && { reasoning: this.reasoningText }),
            ...(this.reasoningMetadata && {
                reasoningMetadata: this.reasoningMetadata,
            }),
            assistantOutput,
        });
    }

    private mergeReasoningMetadata(providerMetadata: Record<string, unknown>): void {
        if (!this.reasoningMetadata) {
            this.reasoningMetadata = providerMetadata;
            return;
        }

        const isRecord = (value: unknown): value is Record<string, unknown> =>
            !!value && typeof value === 'object' && !Array.isArray(value);

        const previous = this.reasoningMetadata;
        const merged: Record<string, unknown> = { ...previous, ...providerMetadata };

        const previousOpenRouter = previous['openrouter'];
        const nextOpenRouter = providerMetadata['openrouter'];
        if (isRecord(previousOpenRouter) && isRecord(nextOpenRouter)) {
            const previousDetails = previousOpenRouter['reasoning_details'];
            const nextDetails = nextOpenRouter['reasoning_details'];
            const combinedDetails =
                Array.isArray(previousDetails) && Array.isArray(nextDetails)
                    ? [...previousDetails, ...nextDetails]
                    : Array.isArray(nextDetails)
                      ? nextDetails
                      : Array.isArray(previousDetails)
                        ? previousDetails
                        : undefined;

            merged['openrouter'] = {
                ...previousOpenRouter,
                ...nextOpenRouter,
                ...(combinedDetails ? { reasoning_details: combinedDetails } : {}),
            };
        }

        this.reasoningMetadata = merged;
    }

    private async createAssistantMessage(): Promise<string> {
        return this.contextManager.addAssistantMessage('', [], {
            assistantOutput: { status: 'draft' },
        });
    }

    private async persistCancelledToolResults(): Promise<void> {
        await this.persistPendingToolResults({
            logLabel: 'cancelled',
            resultText: 'Cancelled by user',
            errorMessage: 'Cancelled by user',
        });
    }

    private async persistFailedToolResults(errorMessage: string): Promise<void> {
        await this.persistPendingToolResults({
            logLabel: 'failed',
            resultText: `Error: ${errorMessage}`,
            errorMessage,
        });
    }

    private async persistPendingToolResults(options: {
        logLabel: 'cancelled' | 'failed';
        resultText: string;
        errorMessage: string;
    }): Promise<void> {
        if (this.pendingToolCalls.size === 0) return;

        this.logger.debug(
            `Persisting ${options.logLabel} results for ${this.pendingToolCalls.size} pending tool call(s)`
        );

        for (const [toolCallId, { toolName }] of this.pendingToolCalls) {
            const syntheticResult: SanitizedToolResult = {
                content: [{ type: 'text', text: options.resultText }],
                meta: {
                    toolName,
                    toolCallId,
                    success: false,
                },
            };

            await this.contextManager.addToolResult(
                toolCallId,
                toolName,
                syntheticResult,
                undefined
            );

            this.eventBus.emit('llm:tool-result', {
                toolName,
                callId: toolCallId,
                success: false,
                error: options.errorMessage,
            });
        }

        this.pendingToolCalls.clear();
    }
}

function tryParsePartialJson(input: string): Record<string, unknown> | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('{')) return null;

    let repaired = trimmed;

    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let isEscaped = false;

    for (let i = 0; i < repaired.length; i += 1) {
        const char = repaired[i];
        if (inString) {
            if (isEscaped) {
                isEscaped = false;
                continue;
            }
            if (char === '\\') {
                isEscaped = true;
                continue;
            }
            if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{') openBraces += 1;
        if (char === '}') openBraces = Math.max(0, openBraces - 1);
        if (char === '[') openBrackets += 1;
        if (char === ']') openBrackets = Math.max(0, openBrackets - 1);
    }

    if (!inString) {
        repaired = repaired.replace(/,\s*$/, '');
    }
    if (inString) {
        if (isEscaped) {
            repaired = repaired.slice(0, -1);
        }
        repaired += '"';
    }
    if (openBrackets > 0) {
        repaired += ']'.repeat(openBrackets);
    }
    if (openBraces > 0) {
        repaired += '}'.repeat(openBraces);
    }

    try {
        const parsed = JSON.parse(repaired) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        return null;
    }

    return null;
}
