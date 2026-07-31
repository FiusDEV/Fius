import { generateText, type LanguageModel } from 'ai';
import type { InternalMessage, ToolCall } from '../../types.js';
import { isAssistantMessage, isToolMessage } from '../../types.js';
import type { Logger } from '../../../logger/v2/types.js';
import { isOverflow, type ModelLimits } from '../overflow.js';
import type { CompactionRuntimeContext, CompactionSettings, CompactionStrategy } from '../types.js';


export interface ReactiveOverflowOptions {
    
    preserveLastNTurns?: number;

    
    maxSummaryTokens?: number;

    
    summaryPrompt?: string;
}

export interface ReactiveOverflowCompactionStrategyOptions {
    enabled?: boolean | undefined;
    maxContextTokens?: number | undefined;
    thresholdPercent?: number | undefined;
    strategy?: ReactiveOverflowOptions | undefined;
}

const DEFAULT_OPTIONS: Required<ReactiveOverflowOptions> = {
    preserveLastNTurns: 2,
    maxSummaryTokens: 2000,
    summaryPrompt: `You are a conversation summarizer creating a structured summary for session continuation.

Analyze the conversation and produce a summary in the following XML format:

<session_compaction>
  <conversation_history>
    A concise summary of what happened in the conversation:
    - Tasks attempted and their outcomes (success/failure/in-progress)
    - Important decisions made
    - Key information discovered (file paths, configurations, errors encountered)
    - Tools used and their results
  </conversation_history>

  <current_task>
    The most recent task or instruction the user requested that may still be in progress.
    Be specific - include the exact request and current status.
  </current_task>

  <important_context>
    Critical state that must be preserved:
    - File paths being worked on
    - Variable values or configurations
    - Error messages that need addressing
    - Any pending actions or next steps
  </important_context>
</session_compaction>

IMPORTANT: The assistant will continue working based on this summary. Ensure the current_task section clearly states what needs to be done next.

Conversation to summarize:
{conversation}`,
};


export class ReactiveOverflowCompactionStrategy implements CompactionStrategy {
    readonly name = 'reactive-overflow';

    private readonly settings: CompactionSettings;
    private readonly strategyOptions: Required<ReactiveOverflowOptions>;

    constructor(options: ReactiveOverflowCompactionStrategyOptions = {}) {
        this.settings = {
            enabled: options.enabled ?? true,
            maxContextTokens: options.maxContextTokens,
            thresholdPercent: options.thresholdPercent ?? 0.9,
        };
        this.strategyOptions = {
            ...DEFAULT_OPTIONS,
            ...(options.strategy ?? {}),
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

    shouldCompact(inputTokens: number, modelLimits: ModelLimits): boolean {
        if (!this.settings.enabled) {
            return false;
        }
        return isOverflow({ inputTokens }, modelLimits, this.settings.thresholdPercent);
    }

    async compact(
        history: readonly InternalMessage[],
        context: CompactionRuntimeContext
    ): Promise<InternalMessage[]> {
        if (!this.settings.enabled) {
            return [];
        }

        const { model, logger } = context;

        if (history.length <= 2) {
            logger.debug(
                'ReactiveOverflowCompactionStrategy: History too short, skipping compaction'
            );
            return [];
        }

        let existingSummaryIndex = -1;
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg?.metadata?.isSummary === true || msg?.metadata?.isSessionSummary === true) {
                existingSummaryIndex = i;
                break;
            }
        }

        if (existingSummaryIndex !== -1) {
            const messagesAfterSummary = history.slice(existingSummaryIndex + 1);

            if (messagesAfterSummary.length <= 4) {
                logger.debug(
                    `ReactiveOverflowCompactionStrategy: Only ${messagesAfterSummary.length} messages after existing summary, skipping re-compaction`
                );
                return [];
            }

            logger.info(
                `ReactiveOverflowCompactionStrategy: Found existing summary at index ${existingSummaryIndex}, ` +
                    `working with ${messagesAfterSummary.length} messages after it`
            );

            return this.compactSubset(
                messagesAfterSummary,
                history,
                existingSummaryIndex,
                model,
                logger
            );
        }

        const { toSummarize, toKeep } = this.splitHistory(history);

        if (toSummarize.length === 0) {
            logger.debug('ReactiveOverflowCompactionStrategy: No messages to summarize');
            return [];
        }

        const currentTaskMessage = this.findCurrentTaskMessage(history);

        logger.info(
            `ReactiveOverflowCompactionStrategy: Summarizing ${toSummarize.length} messages, keeping ${toKeep.length}`
        );

        const summary = await this.generateSummary(toSummarize, currentTaskMessage, model, logger);

        const summaryMessage: InternalMessage = {
            role: 'assistant',
            assistantOutput: { status: 'complete' },
            content: [{ type: 'text', text: summary }],
            timestamp: Date.now(),
            metadata: {
                isSummary: true,
                summarizedAt: Date.now(),
                originalMessageCount: toSummarize.length,
                originalFirstTimestamp: toSummarize[0]?.timestamp,
                originalLastTimestamp: toSummarize[toSummarize.length - 1]?.timestamp,
            },
        };

        return [summaryMessage];
    }

    private async compactSubset(
        messagesAfterSummary: readonly InternalMessage[],
        fullHistory: readonly InternalMessage[],
        existingSummaryIndex: number,
        model: LanguageModel,
        logger: Logger
    ): Promise<InternalMessage[]> {
        const { toSummarize, toKeep } = this.splitHistory(messagesAfterSummary);

        if (toSummarize.length === 0) {
            logger.debug('ReactiveOverflowCompactionStrategy: No messages to summarize in subset');
            return [];
        }

        const currentTaskMessage = this.findCurrentTaskMessage(fullHistory);

        logger.info(
            `ReactiveOverflowCompactionStrategy (re-compact): Summarizing ${toSummarize.length} messages after existing summary, keeping ${toKeep.length}`
        );

        const summary = await this.generateSummary(toSummarize, currentTaskMessage, model, logger);

        const absoluteOriginalMessageCount = existingSummaryIndex + 1 + toSummarize.length;

        const summaryMessage: InternalMessage = {
            role: 'assistant',
            assistantOutput: { status: 'complete' },
            content: [{ type: 'text', text: summary }],
            timestamp: Date.now(),
            metadata: {
                isSummary: true,
                summarizedAt: Date.now(),
                originalMessageCount: absoluteOriginalMessageCount,
                isRecompaction: true,
                originalFirstTimestamp: toSummarize[0]?.timestamp,
                originalLastTimestamp: toSummarize[toSummarize.length - 1]?.timestamp,
            },
        };

        return [summaryMessage];
    }

    
    private findCurrentTaskMessage(history: readonly InternalMessage[]): string | null {
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg?.role === 'user') {
                if (typeof msg.content === 'string') {
                    return msg.content;
                } else if (Array.isArray(msg.content)) {
                    const textParts = msg.content
                        .filter(
                            (part): part is { type: 'text'; text: string } => part.type === 'text'
                        )
                        .map((part) => part.text)
                        .join('\n');
                    if (textParts.length > 0) {
                        return textParts;
                    }
                }
            }
        }
        return null;
    }

    
    private splitHistory(history: readonly InternalMessage[]): {
        toSummarize: readonly InternalMessage[];
        toKeep: readonly InternalMessage[];
    } {
        const turnsToKeep = this.strategyOptions.preserveLastNTurns;

        const userMessageIndices: number[] = [];
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i]?.role === 'user') {
                userMessageIndices.unshift(i);
                if (userMessageIndices.length >= turnsToKeep) {
                    break;
                }
            }
        }

        if (userMessageIndices.length > 0) {
            const splitIndex = userMessageIndices[0];
            if (splitIndex !== undefined && splitIndex > 0) {
                return {
                    toSummarize: history.slice(0, splitIndex),
                    toKeep: history.slice(splitIndex),
                };
            }
        }

        const minKeep = 3;
        const maxKeepPercent = 0.2;
        const keepCount = Math.max(minKeep, Math.floor(history.length * maxKeepPercent));

        if (keepCount >= history.length) {
            return {
                toSummarize: [],
                toKeep: history,
            };
        }

        return {
            toSummarize: history.slice(0, -keepCount),
            toKeep: history.slice(-keepCount),
        };
    }

    
    private async generateSummary(
        messages: readonly InternalMessage[],
        currentTask: string | null,
        model: LanguageModel,
        logger: Logger
    ): Promise<string> {
        const formattedConversation = this.formatMessagesForSummary(messages);

        let conversationWithContext = formattedConversation;
        if (currentTask) {
            conversationWithContext += `\n\n--- CURRENT TASK (most recent user request) ---\n${currentTask}`;
        }

        const prompt = this.strategyOptions.summaryPrompt.replace(
            '{conversation}',
            conversationWithContext
        );

        try {
            const result = await generateText({
                model,
                prompt,
                maxOutputTokens: this.strategyOptions.maxSummaryTokens,
            });

            return `[Session Compaction Summary]\n${result.text}`;
        } catch (error) {
            logger.error(
                `ReactiveOverflowCompactionStrategy: Failed to generate summary - ${error instanceof Error ? error.message : String(error)}`
            );
            return this.createFallbackSummary(messages, currentTask);
        }
    }

    
    private formatMessagesForSummary(messages: readonly InternalMessage[]): string {
        return messages
            .map((msg) => {
                const role = msg.role.toUpperCase();
                let content: string;

                if (typeof msg.content === 'string') {
                    content = msg.content;
                } else if (Array.isArray(msg.content)) {
                    content = msg.content
                        .filter(
                            (part): part is { type: 'text'; text: string } => part.type === 'text'
                        )
                        .map((part) => part.text)
                        .join('\n');
                } else {
                    content = '[no content]';
                }

                if (content.length > 2000) {
                    content = content.slice(0, 2000) + '... [truncated]';
                }

                if (isAssistantMessage(msg) && msg.toolCalls && msg.toolCalls.length > 0) {
                    const toolNames = msg.toolCalls
                        .map((tc: ToolCall) => tc.function.name)
                        .join(', ');
                    content += `\n[Used tools: ${toolNames}]`;
                }

                if (isToolMessage(msg)) {
                    return `TOOL (${msg.name}): ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`;
                }

                return `${role}: ${content}`;
            })
            .join('\n\n');
    }

    
    private createFallbackSummary(
        messages: readonly InternalMessage[],
        currentTask: string | null
    ): string {
        const userMessages = messages.filter((m) => m.role === 'user');
        const assistantWithTools = messages.filter(
            (m): m is InternalMessage & { role: 'assistant'; toolCalls: ToolCall[] } =>
                isAssistantMessage(m) && !!m.toolCalls && m.toolCalls.length > 0
        );

        const userTopics = userMessages
            .slice(-3)
            .map((m) => {
                const text =
                    typeof m.content === 'string'
                        ? m.content
                        : Array.isArray(m.content)
                          ? m.content
                                .filter(
                                    (p): p is { type: 'text'; text: string } => p.type === 'text'
                                )
                                .map((p) => p.text)
                                .join(' ')
                          : '';
                return text.slice(0, 100);
            })
            .join('; ');

        const toolsUsed = [
            ...new Set(
                assistantWithTools.flatMap((m) => m.toolCalls.map((tc) => tc.function.name))
            ),
        ].join(', ');

        let fallback = `[Session Compaction Summary - Fallback]
<session_compaction>
  <conversation_history>
    User discussed: ${userTopics || 'various topics'}
    Tools used: ${toolsUsed || 'none'}
    Messages summarized: ${messages.length}
  </conversation_history>`;

        if (currentTask) {
            fallback += `
  <current_task>
    ${currentTask.slice(0, 500)}${currentTask.length > 500 ? '...' : ''}
  </current_task>`;
        }

        fallback += `
  <important_context>
    Note: This is a fallback summary due to LLM error. Context may be incomplete.
  </important_context>
</session_compaction>`;

        return fallback;
    }
}
