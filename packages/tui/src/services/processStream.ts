

import type React from 'react';
import type { StreamingEvent, SanitizedToolResult } from '@fius/core';
import { createDebugLogger } from '../utils/debugLog.js';
import { ApprovalType as ApprovalTypeEnum, ApprovalStatus, LLMErrorCode } from '@fius/core';
import type { Message, UIState, ToolStatus } from '../state/types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import { generateMessageId } from '../utils/idGenerator.js';
import { checkForSplit } from '../utils/streamSplitter.js';
import { formatToolHeader, shouldHideTool } from '../utils/messageFormatting.js';
import { isAutoApprovableInEditMode } from '../utils/toolUtils.js';
import { captureAnalytics } from '../host/index.js';
import chalk from 'chalk';


function buildErrorContent(error: unknown, prefix: string): string {
    const errorMessage = error instanceof Error ? error.message : String(error);
    let errorContent = `${prefix}${errorMessage}`;

    // Add recovery guidance if available (for FiusRuntimeError)
    if (error instanceof Error && 'recovery' in error && error.recovery) {
        const recoveryMessages = Array.isArray(error.recovery) ? error.recovery : [error.recovery];
        errorContent += '\n\n' + recoveryMessages.map((msg) => ` ${msg}`).join('\n');
    }

    return errorContent;
}

function getErrorCode(error: unknown): string | null {
    if (typeof error !== 'object' || error === null) {
        return null;
    }

    const code = Reflect.get(error, 'code');
    return typeof code === 'string' && code.length > 0 ? code : null;
}

function extractInsufficientCreditsBalance(error: unknown): number | null {
    if (typeof error === 'object' && error !== null) {
        const context = Reflect.get(error, 'context');
        if (typeof context === 'object' && context !== null) {
            const balance = Reflect.get(context, 'balance');
            if (typeof balance === 'number' && Number.isFinite(balance)) {
                return balance;
            }
            if (typeof balance === 'string') {
                const parsed = Number.parseFloat(balance);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }
        }
    }

    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/Balance:\s*\$?(-?[\d.]+)/i);
    if (!match) {
        return null;
    }

    const parsed = Number.parseFloat(match[1] ?? '');
    return Number.isFinite(parsed) ? parsed : null;
}

function buildInsufficientCreditsContent(balance: number | null): string {
    if (balance === null) {
        return 'Out of Fius credits.\nUse the billing prompt to top up and retry your request.';
    }

    return `Out of Fius credits. Current balance: $${balance.toFixed(2)}.\nUse the billing prompt to top up and retry your request.`;
}


export interface ProcessStreamSetters {
    
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    
    setPendingMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    
    setDequeuedBuffer: React.Dispatch<React.SetStateAction<Message[]>>;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    
    setSession: React.Dispatch<React.SetStateAction<import('../state/types.js').SessionState>>;
    
    setSteerMessages: React.Dispatch<React.SetStateAction<import('@fius/core').QueuedMessage[]>>;
    
    setQueuedMessages: React.Dispatch<React.SetStateAction<import('@fius/core').QueuedMessage[]>>;
    
    setApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
    
    setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
}


export interface ProcessStreamOptions {
    
    useStreaming?: boolean;
    
    autoApproveEditsRef: { current: boolean };
    
    bypassPermissionsRef: { current: boolean };
    
    eventBus: Pick<import('@fius/core').AgentEventBus, 'emit'>;
    
    soundService?: import('../utils/soundNotification.js').SoundNotificationService;
    
    setTodos?: React.Dispatch<React.SetStateAction<import('../state/types.js').TodoItem[]>>;
}


interface StreamState {
    messageId: string | null;
    content: string;
    reasoning: string;
    
    reasoningFinalized: boolean;
    
    lastInputTokens: number;
    
    cumulativeOutputTokens: number;
    
    finalizedContent: string;
    
    splitCounter: number;
    
    textFinalizedBeforeTool: boolean;
    
    nonStreamingAccumulatedText: string;
    nonStreamingAccumulatedReasoning: string;
}

function hasMeaningfulTokenUsageForAnalytics(
    tokenUsage: Extract<StreamingEvent, { name: 'llm:response' }>['tokenUsage'],
    estimatedCost?: number
): boolean {
    if (estimatedCost !== undefined) {
        return true;
    }

    return (
        (tokenUsage.inputTokens ?? 0) > 0 ||
        (tokenUsage.outputTokens ?? 0) > 0 ||
        (tokenUsage.reasoningTokens ?? 0) > 0 ||
        (tokenUsage.cacheReadTokens ?? 0) > 0 ||
        (tokenUsage.cacheWriteTokens ?? 0) > 0 ||
        (tokenUsage.totalTokens ?? 0) > 0
    );
}


export async function processStream(
    iterator: AsyncIterableIterator<StreamingEvent>,
    setters: ProcessStreamSetters,
    options: ProcessStreamOptions
): Promise<void> {
    const {
        setMessages,
        setPendingMessages,
        setDequeuedBuffer,
        setUi,
        setSession: _setSession,
        setSteerMessages,
        setQueuedMessages,
        setApproval,
        setApprovalQueue,
    } = setters;
    const useStreaming = options?.useStreaming ?? true;

    // Link approval IDs to tool call IDs so we can finalize tool UI when an approval
    // is cancelled/denied (otherwise tool messages can remain stuck in "Waiting...").
    const approvalIdToToolCallId = new Map<string, string>();

    // Track streaming state (synchronous, not React state)
    const state: StreamState = {
        messageId: null,
        content: '',
        reasoning: '',
        reasoningFinalized: false,
        lastInputTokens: 0,
        cumulativeOutputTokens: 0,
        finalizedContent: '',
        splitCounter: 0,
        textFinalizedBeforeTool: false,
        nonStreamingAccumulatedText: '',
        nonStreamingAccumulatedReasoning: '',
    };

    // LOCAL PENDING TRACKING - mirrors React state synchronously
    // This allows us to flatten nested setState calls (which caused ordering bugs).
    // See: https://github.com/facebook/react/issues/8132 - nested setState not supported
    let localPending: Message[] = [];

    
    const extractTextContent = (content: import('@fius/core').ContentPart[]): string => {
        return content
            .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    };

    const formatQueuedMessagesForDisplay = (
        messages: import('@fius/core').QueuedMessage[]
    ): string => {
        const userMessages = messages.filter((message) => message.kind !== 'background');
        if (userMessages.length === 0) {
            return '';
        }
        if (userMessages.length === 1) {
            return extractTextContent(userMessages[0]?.content ?? []) || '[attachment]';
        }
        return userMessages
            .map((message, index) => {
                const prefix =
                    userMessages.length === 2 ? (index === 0 ? 'First' : 'Also') : `[${index + 1}]`;
                const content = extractTextContent(message.content) || '[attachment]';
                return `${prefix}: ${content}`;
            })
            .join('\n\n');
    };

    const removeDequeuedMessagesFromState = (
        event: Extract<StreamingEvent, { name: 'message:dequeued' }>
    ): void => {
        const dequeuedIds = new Set(
            event.ids ?? event.messages?.map((message) => message.id) ?? []
        );
        if (dequeuedIds.size === 0) {
            if (event.queue === 'steer') {
                setSteerMessages([]);
            } else {
                setQueuedMessages([]);
            }
            return;
        }
        if (event.queue === 'steer') {
            setSteerMessages((prev) => prev.filter((message) => !dequeuedIds.has(message.id)));
        } else {
            setQueuedMessages((prev) => prev.filter((message) => !dequeuedIds.has(message.id)));
        }
    };

    
    const finalizeMessage = (messageId: string, updates: Partial<Message> = {}) => {
        const msg = localPending.find((m) => m.id === messageId);
        if (msg) {
            // Add to messages FIRST (sibling call, not nested)
            setMessages((prev) => [...prev, { ...msg, ...updates }]);
        }
        // Update local tracking
        localPending = localPending.filter((m) => m.id !== messageId);
        // Then update React state (sibling call)
        setPendingMessages(localPending);
    };

    
    const finalizeAllPending = () => {
        if (localPending.length > 0) {
            // Add to messages FIRST (sibling call, not nested)
            const toFinalize = [...localPending];
            setMessages((prev) => [...prev, ...toFinalize]);
        }
        // Update local tracking
        localPending = [];
        // Then update React state (sibling call)
        setPendingMessages([]);
    };

    
    const flushDequeuedBuffer = () => {
        setDequeuedBuffer((buffer) => {
            if (buffer.length > 0) {
                setMessages((prev) => [...prev, ...buffer]);
            }
            return [];
        });
    };

    
    const addToPending = (msg: Message) => {
        localPending = [...localPending, msg];
        setPendingMessages(localPending);
    };

    
    const updatePending = (messageId: string, updates: Partial<Message>) => {
        localPending = localPending.map((m) => (m.id === messageId ? { ...m, ...updates } : m));
        setPendingMessages(localPending);
    };

    
    const removeFromPending = (messageId: string) => {
        localPending = localPending.filter((m) => m.id !== messageId);
        setPendingMessages(localPending);
    };

    
    const clearPending = () => {
        localPending = [];
        setPendingMessages([]);
    };

    
    const updatePendingStatus = (messageId: string, status: ToolStatus) => {
        localPending = localPending.map((msg) =>
            msg.id === messageId ? { ...msg, toolStatus: status } : msg
        );
        setPendingMessages(localPending);
    };

    
    const progressiveFinalize = (content: string): string => {
        const splitResult = checkForSplit(content);

        if (splitResult.shouldSplit && splitResult.before && splitResult.after !== undefined) {
            // Add the completed portion directly to finalized messages
            state.splitCounter++;
            const splitId = `${state.messageId}-split-${state.splitCounter}`;
            const beforeContent = splitResult.before;
            const afterContent = splitResult.after;
            const isFirstSplit = state.splitCounter === 1;

            // STEP 1: Clear pending message content to avoid showing stale content
            // during React's batched render cycle
            if (state.messageId) {
                localPending = localPending.map((m) =>
                    m.id === state.messageId ? { ...m, content: '', isContinuation: true } : m
                );
                setPendingMessages(localPending);
            }

            // STEP 2: Add split message to finalized
            const splitReasoning =
                !state.reasoningFinalized && state.reasoning ? state.reasoning : undefined;
            setMessages((prev) => [
                ...prev,
                {
                    id: splitId,
                    role: 'assistant' as const,
                    content: beforeContent,
                    ...(splitReasoning ? { reasoning: splitReasoning } : {}),
                    timestamp: new Date(),
                    isStreaming: false,
                    // First split shows the indicator, subsequent splits are continuations
                    isContinuation: !isFirstSplit,
                },
            ]);

            // If we've emitted reasoning into a finalized message, don't show it again on the tail.
            if (splitReasoning) {
                state.reasoningFinalized = true;
                state.reasoning = '';
                if (state.messageId) {
                    localPending = localPending.map((m) =>
                        m.id === state.messageId ? { ...m, reasoning: undefined } : m
                    );
                    setPendingMessages(localPending);
                }
            }

            // STEP 3: Restore pending with afterContent
            if (state.messageId) {
                localPending = localPending.map((m) =>
                    m.id === state.messageId ? { ...m, content: afterContent } : m
                );
                setPendingMessages(localPending);
            }

            // Track total finalized content for final message assembly
            state.finalizedContent += beforeContent;

            // Return only the remaining content for pending
            return afterContent;
        }

        return content;
    };

    const resolveFinalReasoning = (eventReasoning: string | undefined): string | undefined => {
        if (state.reasoningFinalized) {
            return undefined;
        }

        if (!useStreaming && state.nonStreamingAccumulatedReasoning) {
            return state.nonStreamingAccumulatedReasoning;
        }

        return eventReasoning;
    };

    // Debug logging: enable via FIUS_DEBUG_STREAM=true
    const debug = createDebugLogger('stream');
    debug.reset();
    debug.log('CONFIG', { useStreaming });

    try {
        for await (const event of iterator) {
            debug.log(`EVENT: ${event.name}`, {
                ...(event.name === 'llm:chunk' &&
                    'chunkType' in event && {
                        chunkType: event.chunkType,
                        contentLen: event.content?.length,
                    }),
                ...(event.name === 'llm:tool-call' &&
                    'toolName' in event && {
                        toolName: event.toolName,
                    }),
            });

            switch (event.name) {
                case 'llm:thinking': {
                    debug.log('THINKING: resetting state', {
                        prevMessageId: state.messageId,
                        prevContentLen: state.content.length,
                    });
                    // Flush dequeued buffer to messages at start of new run
                    // This ensures user messages appear after the previous response
                    flushDequeuedBuffer();

                    // Start thinking state, reset streaming state
                    setUi((prev) => ({ ...prev, isThinking: true }));
                    state.messageId = null;
                    state.content = '';
                    state.reasoning = '';
                    state.reasoningFinalized = false;
                    state.lastInputTokens = 0;
                    state.cumulativeOutputTokens = 0;
                    state.finalizedContent = '';
                    state.splitCounter = 0;
                    state.textFinalizedBeforeTool = false;
                    state.nonStreamingAccumulatedText = '';
                    state.nonStreamingAccumulatedReasoning = '';
                    break;
                }

                case 'llm:chunk': {
                    // In non-streaming mode, accumulate text but don't update UI
                    // We need to track text so we can add it BEFORE tool calls (ordering fix)
                    if (!useStreaming) {
                        if (event.chunkType === 'text') {
                            state.nonStreamingAccumulatedText += event.content;
                            debug.log('CHUNK (non-stream): accumulated', {
                                chunkLen: event.content?.length,
                                totalLen: state.nonStreamingAccumulatedText.length,
                                preview: state.nonStreamingAccumulatedText.slice(0, 50),
                            });
                        } else if (event.chunkType === 'reasoning') {
                            state.nonStreamingAccumulatedReasoning += event.content;
                        }
                        break;
                    }

                    // End thinking state when first chunk arrives
                    setUi((prev) => ({ ...prev, isThinking: false }));

                    if (event.chunkType === 'reasoning') {
                        if (state.reasoningFinalized) break;

                        // Create streaming message on first reasoning chunk
                        if (!state.messageId) {
                            const newId = generateMessageId('assistant');
                            state.messageId = newId;
                            state.reasoning = event.content;
                            state.content = '';
                            state.finalizedContent = '';
                            state.splitCounter = 0;

                            addToPending({
                                id: newId,
                                role: 'assistant',
                                content: '',
                                reasoning: event.content,
                                timestamp: new Date(),
                                isStreaming: true,
                            });
                        } else {
                            state.reasoning += event.content;
                            updatePending(state.messageId, { reasoning: state.reasoning });
                        }
                        break;
                    }

                    if (event.chunkType === 'text') {
                        debug.log('CHUNK (stream): text', {
                            hasMessageId: !!state.messageId,
                            chunkLen: event.content?.length,
                            currentContentLen: state.content.length,
                            preview: event.content?.slice(0, 30),
                        });
                        // Create streaming message on first text chunk
                        if (!state.messageId) {
                            const newId = generateMessageId('assistant');
                            state.messageId = newId;
                            state.content = event.content;
                            state.reasoning = '';
                            state.reasoningFinalized = false;
                            state.finalizedContent = '';
                            state.splitCounter = 0;

                            // Add to PENDING (not messages) - renders dynamically
                            addToPending({
                                id: newId,
                                role: 'assistant',
                                content: event.content,
                                timestamp: new Date(),
                                isStreaming: true,
                            });
                        } else {
                            // Accumulate content
                            state.content += event.content;

                            // Check for progressive finalization (move completed paragraphs to Static)
                            // progressiveFinalize updates pending message internally when split occurs
                            const pendingContent = progressiveFinalize(state.content);
                            const splitOccurred = pendingContent !== state.content;

                            // Update state with remaining content
                            state.content = pendingContent;

                            // Only update pending if no split occurred (split already handled by progressiveFinalize)
                            if (!splitOccurred) {
                                const messageId = state.messageId;
                                // Mark as continuation if we've had any splits
                                const isContinuation = state.splitCounter > 0;
                                updatePending(messageId, {
                                    content: pendingContent,
                                    isContinuation,
                                });
                            }
                        }
                    }
                    break;
                }

                case 'llm:response': {
                    // In non-streaming mode, end thinking state when response arrives
                    // (In streaming mode, thinking ends when first chunk arrives)
                    if (!useStreaming) {
                        setUi((prev) => ({ ...prev, isThinking: false }));
                    }

                    // Track token usage: replace input (last context), accumulate output
                    // Subtract cacheWriteTokens to exclude system prompt on first call
                    const rawInputTokens = event.tokenUsage.inputTokens ?? 0;
                    const cacheWriteTokens = event.tokenUsage.cacheWriteTokens ?? 0;
                    const inputTokens = Math.max(0, rawInputTokens - cacheWriteTokens);
                    if (inputTokens > 0) {
                        state.lastInputTokens = inputTokens;
                    }
                    if (event.tokenUsage.outputTokens) {
                        state.cumulativeOutputTokens += event.tokenUsage.outputTokens;
                    }

                    // Track token usage analytics
                    if (
                        hasMeaningfulTokenUsageForAnalytics(event.tokenUsage, event.estimatedCost)
                    ) {
                        // Calculate estimate accuracy if both estimate and actual are available
                        let estimateAccuracyPercent: number | undefined;
                        const actualInputTokens = event.tokenUsage.inputTokens;
                        if (event.estimatedInputTokens !== undefined && actualInputTokens) {
                            const diff = event.estimatedInputTokens - actualInputTokens;
                            estimateAccuracyPercent = Math.round((diff / actualInputTokens) * 100);
                        }

                        captureAnalytics('fius_llm_tokens_consumed', {
                            source: 'cli',
                            sessionId: event.sessionId,
                            provider: event.provider,
                            model: event.model,
                            reasoningVariant: event.reasoningVariant ?? undefined,
                            reasoningBudgetTokens: event.reasoningBudgetTokens ?? undefined,
                            inputTokens: event.tokenUsage.inputTokens,
                            outputTokens: event.tokenUsage.outputTokens,
                            reasoningTokens: event.tokenUsage.reasoningTokens,
                            totalTokens: event.tokenUsage.totalTokens,
                            cacheReadTokens: event.tokenUsage.cacheReadTokens,
                            cacheWriteTokens: event.tokenUsage.cacheWriteTokens,
                            estimatedCostUsd: event.estimatedCost,
                            inputCostUsd: event.costBreakdown?.inputUsd,
                            outputCostUsd: event.costBreakdown?.outputUsd,
                            reasoningCostUsd: event.costBreakdown?.reasoningUsd,
                            cacheReadCostUsd: event.costBreakdown?.cacheReadUsd,
                            cacheWriteCostUsd: event.costBreakdown?.cacheWriteUsd,
                            estimatedInputTokens: event.estimatedInputTokens,
                            estimateAccuracyPercent,
                        });
                    }

                    const finalContent = event.content || '';
                    if (!state.reasoningFinalized && !state.reasoning && event.reasoning) {
                        state.reasoning = event.reasoning;
                    }

                    if (state.messageId) {
                        // Finalize existing streaming message (streaming mode)
                        const messageId = state.messageId;
                        const content = state.content || finalContent;
                        const reasoning =
                            !state.reasoningFinalized && state.reasoning
                                ? state.reasoning
                                : undefined;

                        // If no text but reasoning exists, show reasoning as content
                        const displayContent = content || (reasoning ? `[Thinking] ${reasoning}` : '');

                        if (displayContent) {
                            // Move from pending to finalized
                            finalizeMessage(messageId, {
                                content: displayContent,
                                ...(reasoning && content ? { reasoning } : {}),
                                isStreaming: false,
                            });
                        }

                        // Reset for potential next response (multi-step)
                        state.messageId = null;
                        state.content = '';
                        state.reasoning = '';
                        state.reasoningFinalized = false;
                    } else if (!state.textFinalizedBeforeTool) {
                        // No streaming message exists - add directly to finalized
                        // This handles: non-streaming mode, or multi-step turns after tool calls
                        // Skip if text was already finalized before tools (avoid duplication)
                        const reasoning = resolveFinalReasoning(event.reasoning);
                        // If no text content but reasoning exists, show reasoning as content
                        const displayContent = finalContent || (reasoning ? `[Thinking] ${reasoning}` : '') || '';
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('assistant'),
                                role: 'assistant',
                                content: displayContent,
                                ...(reasoning && finalContent ? { reasoning } : {}),
                                timestamp: new Date(),
                                isStreaming: false,
                            },
                        ]);
                    }

                    if (!useStreaming) {
                        state.nonStreamingAccumulatedText = '';
                        state.nonStreamingAccumulatedReasoning = '';
                    }
                    // Reset the flag for this response (new text after tools will create new message)
                    state.textFinalizedBeforeTool = false;
                    break;
                }

                case 'interaction:blocked': {
                    setUi((prev) => ({ ...prev, isThinking: false }));

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: event.messageId,
                            role: 'assistant',
                            content: event.content,
                            timestamp: new Date(),
                            isStreaming: false,
                        },
                    ]);
                    break;
                }

                case 'llm:tool-call': {
                    if (shouldHideTool(event.toolName)) {
                        break;
                    }
                    debug.log('TOOL-CALL: state check', {
                        toolName: event.toolName,
                        hasMessageId: !!state.messageId,
                        contentLen: state.content.length,
                        nonStreamAccumLen: state.nonStreamingAccumulatedText.length,
                        contentPreview: state.content.slice(0, 50),
                        nonStreamPreview: state.nonStreamingAccumulatedText.slice(0, 50),
                        useStreaming,
                    });
                    // ORDERING FIX: Add any accumulated text BEFORE adding tool
                    // This ensures text appears before tools in the message list.

                    // Streaming mode: handle pending assistant message before tool
                    if (state.messageId) {
                        if (state.content) {
                            // Finalize pending message with content
                            const messageId = state.messageId;
                            const content = state.content;
                            const isContinuation = state.splitCounter > 0;
                            debug.log('TOOL-CALL: finalizing pending message', {
                                messageId,
                                contentLen: content.length,
                            });
                            finalizeMessage(messageId, {
                                content,
                                isStreaming: false,
                                isContinuation,
                            });
                            // Mark that we finalized text early - prevents duplicate in llm:response
                            state.textFinalizedBeforeTool = true;
                            // Explicitly reset reasoning tracking (was preserved via msg spread in finalizeMessage)
                            const hadReasoning = state.reasoningFinalized || !!state.reasoning;
                            state.reasoning = '';
                            state.reasoningFinalized = hadReasoning;
                        } else {
                            const hasReasoning = !state.reasoningFinalized && !!state.reasoning;
                            if (hasReasoning) {
                                // Model reasoned then called a tool directly (no text) — preserve reasoning
                                finalizeMessage(state.messageId, {
                                    content: '',
                                    reasoning: state.reasoning,
                                    isStreaming: false,
                                });
                                state.reasoning = '';
                                state.reasoningFinalized = true;
                            } else {
                                // Empty pending message (first chunk had no content) - remove it
                                // This prevents empty bullets when LLM/SDK sends empty initial chunk
                                debug.log('TOOL-CALL: removing empty pending message', {
                                    messageId: state.messageId,
                                });
                                removeFromPending(state.messageId);
                            }
                        }
                        state.messageId = null;
                        state.content = '';
                    } else {
                        debug.log('TOOL-CALL: no pending message to finalize');
                    }

                    // Non-streaming mode: add accumulated text/reasoning as finalized message
                    // (Ordering fix: emit assistant content before the tool call)
                    if (
                        !useStreaming &&
                        (state.nonStreamingAccumulatedText ||
                            state.nonStreamingAccumulatedReasoning)
                    ) {
                        const content = state.nonStreamingAccumulatedText;
                        const reasoning = state.nonStreamingAccumulatedReasoning || undefined;
                        debug.log('TOOL-CALL: adding non-stream accumulated content', {
                            contentLen: content.length,
                            reasoningLen: reasoning?.length ?? 0,
                        });

                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('assistant'),
                                role: 'assistant',
                                content,
                                ...(reasoning ? { reasoning } : {}),
                                timestamp: new Date(),
                                isStreaming: false,
                            },
                        ]);

                        const hadText = !!content;
                        const hadReasoning = !!reasoning;
                        state.nonStreamingAccumulatedText = '';
                        state.nonStreamingAccumulatedReasoning = '';

                        // Mark that we finalized text early - prevents duplicate in llm:response
                        if (hadText) {
                            state.textFinalizedBeforeTool = true;
                        }
                        if (hadReasoning) {
                            state.reasoningFinalized = true;
                        }
                    }

                    const toolMessageId = event.callId
                        ? `tool-${event.callId}`
                        : generateMessageId('tool');

                    // Format tool header using shared utility
                    const { header: toolContent } = formatToolHeader({
                        toolName: event.toolName,
                        args: (event.args as Record<string, unknown>) || {},
                        ...(event.presentationSnapshot !== undefined && {
                            presentationSnapshot: event.presentationSnapshot,
                        }),
                    });

                    // Add call description if present (dim styling, on new line)
                    // NOTE: This should come from tool call metadata (e.g., __meta.callDescription),
                    // not from tool args, to keep approval + history consistent.
                    let finalToolContent = toolContent;
                    const callDescription = event.callDescription;
                    if (typeof callDescription === 'string' && callDescription.trim().length > 0) {
                        finalToolContent += `\n${chalk.dim(callDescription)}`;
                    }

                    // Tool calls start in 'pending' state (don't know if approval needed yet)
                    // Status transitions: pending → pending_approval (if approval needed) → running → finished
                    // Or for pre-approved: pending → running → finished
                    addToPending({
                        id: toolMessageId,
                        role: 'tool',
                        content: finalToolContent,
                        timestamp: new Date(),
                        toolStatus: 'pending',
                    });

                    // Track tool called analytics
                    captureAnalytics('fius_tool_called', {
                        source: 'cli',
                        sessionId: event.sessionId,
                        toolName: event.toolName,
                    });
                    break;
                }

                case 'llm:tool-result': {
                    if (shouldHideTool(event.toolName)) {
                        break;
                    }
                    // Extract structured display data and content from sanitized result
                    const sanitized = event.sanitized as SanitizedToolResult | undefined;
                    const toolDisplayData = sanitized?.meta?.display;
                    const toolContent = sanitized?.content;

                    // Generate text preview for fallback display
                    let resultPreview = '';
                    try {
                        const result = event.sanitized || event.rawResult;
                        if (result) {
                            let resultStr = '';
                            if (typeof result === 'string') {
                                resultStr = result;
                            } else if (result && typeof result === 'object') {
                                const resultObj = result as {
                                    content?: unknown[];
                                    text?: string;
                                };
                                if (Array.isArray(resultObj.content)) {
                                    resultStr = resultObj.content
                                        .filter(
                                            (item): item is { type: string; text?: string } =>
                                                typeof item === 'object' &&
                                                item !== null &&
                                                'type' in item &&
                                                item.type === 'text'
                                        )
                                        .map((item) => item.text || '')
                                        .join('\n');
                                } else if (resultObj.text) {
                                    resultStr = resultObj.text;
                                } else {
                                    resultStr = JSON.stringify(result, null, 2);
                                }
                            }

                            const maxChars = 400;
                            if (resultStr.length > maxChars) {
                                resultPreview = resultStr.slice(0, maxChars) + '\n...';
                            } else {
                                resultPreview = resultStr;
                            }
                        }
                    } catch {
                        resultPreview = '';
                    }

                    if (event.callId) {
                        const toolMessageId = `tool-${event.callId}`;
                        // Finalize tool message - move to messages with result and display data
                        finalizeMessage(toolMessageId, {
                            toolResult: resultPreview,
                            toolStatus: 'finished',
                            isError: !event.success,
                            ...(toolDisplayData && { toolDisplayData }),
                            ...(toolContent && { toolContent }),
                        });
                    }

                    // Handle plan_review tool results - update UI state when plan is approved
                    if (event.toolName === 'plan_review' && event.success !== false) {
                        try {
                            const planReviewResult = event.rawResult as {
                                approved?: boolean;
                            } | null;
                            if (planReviewResult?.approved) {
                                // User approved the plan - no action needed
                            }
                        } catch {
                            // Silently ignore parsing errors - plan mode state remains unchanged
                        }
                    }

                    // Track tool result analytics
                    captureAnalytics('fius_tool_result', {
                        source: 'cli',
                        sessionId: event.sessionId,
                        toolName: event.toolName || 'unknown',
                        success: event.success !== false,
                    });
                    break;
                }

                case 'llm:error': {
                    const insufficientCredits =
                        getErrorCode(event.error) === LLMErrorCode.INSUFFICIENT_CREDITS;
                    const insufficientCreditsBalance = insufficientCredits
                        ? extractInsufficientCreditsBalance(event.error)
                        : null;
                    const errorContent = insufficientCredits
                        ? buildInsufficientCreditsContent(insufficientCreditsBalance)
                        : buildErrorContent(event.error, 'Error: ');

                    // Add error message to finalized
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: errorContent,
                            timestamp: new Date(),
                        },
                    ]);

                    // Only stop processing for non-recoverable errors (fatal)
                    // Tool errors are recoverable - agent continues after them
                    if (event.recoverable !== true) {
                        // Cancel any streaming message in pending
                        if (state.messageId) {
                            removeFromPending(state.messageId);
                            state.messageId = null;
                            state.content = '';
                        }

                        // Clear any remaining pending messages
                        clearPending();

                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            isCancelling: false,
                            isThinking: false,
                            ...(insufficientCredits
                                ? {
                                      activeOverlay: 'insufficient-credits' as const,
                                      insufficientCredits: {
                                          balanceUsd: insufficientCreditsBalance,
                                      },
                                  }
                                : {}),
                        }));
                    }
                    break;
                }

                case 'llm:unsupported-input': {
                    // Show warning for unsupported features (e.g., model doesn't support tool calling)
                    const warningContent = '⚠  ' + event.errors.join('\n⚠  ');

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('warning'),
                            role: 'system',
                            content: warningContent,
                            timestamp: new Date(),
                        },
                    ]);
                    break;
                }

                case 'run:complete': {
                    const { durationMs } = event;
                    // Total = lastInput + cumulativeOutput (avoids double-counting shared context)
                    const totalTokens = state.lastInputTokens + state.cumulativeOutputTokens;

                    // Ensure any remaining pending messages are finalized
                    finalizeAllPending();

                    // Add run summary message at the END (not inserted in middle)
                    // IMPORTANT: Ink's <Static> tracks rendered items by array position, not key.
                    // Inserting in the middle shifts existing items, causing them to re-render.
                    // Always append to avoid duplicate rendering.
                    if (durationMs > 0 || totalTokens > 0) {
                        const summaryMessage = {
                            id: generateMessageId('summary'),
                            role: 'system' as const,
                            content: '', // Content rendered via styledType
                            timestamp: new Date(),
                            styledType: 'run-summary' as const,
                            styledData: {
                                durationMs,
                                totalTokens,
                            },
                        };

                        setMessages((prev) => [...prev, summaryMessage]);
                    }

                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        isCancelling: false,
                        isThinking: false,
                        isCompacting: false,
                    }));

                    // Play completion sound to notify user task is done
                    options.soundService?.playCompleteSound();
                    break;
                }

                case 'message:dequeued': {
                    // Queued message is being processed
                    // NOTE: llm:thinking only fires ONCE at the start of execute(),
                    // NOT when each queued message starts. So we must finalize here.

                    // 1. Finalize any pending from previous response
                    //    This ensures the previous assistant response is in messages
                    //    before we add the next user message
                    finalizeAllPending();

                    if (event.messages?.some((message) => message.kind === 'background')) {
                        const userText = event.messages
                            ? formatQueuedMessagesForDisplay(event.messages)
                            : '';
                        if (userText) {
                            setMessages((prev) => [
                                ...prev,
                                {
                                    id: generateMessageId('user'),
                                    role: 'user' as const,
                                    content: userText,
                                    timestamp: new Date(),
                                },
                            ]);
                        }
                        removeDequeuedMessagesFromState(event);
                        setUi((prev) => ({ ...prev, isProcessing: true }));
                        break;
                    }

                    // 2. Add user message directly to messages (not buffer)
                    //    The buffer approach doesn't work because llm:thinking
                    //    doesn't fire between queued message runs
                    const textContent = extractTextContent(event.content);

                    if (textContent || event.content.length > 0) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('user'),
                                role: 'user' as const,
                                content: textContent || '[attachment]',
                                timestamp: new Date(),
                            },
                        ]);
                    }

                    // Clear queue state - message was consumed
                    removeDequeuedMessagesFromState(event);

                    // Set processing state for the queued message run
                    setUi((prev) => ({ ...prev, isProcessing: true }));
                    break;
                }

                case 'tool:running': {
                    // Tool execution actually started (after approval if needed)
                    // Update status from 'pending' or 'pending_approval' to 'running'
                    const runningToolId = `tool-${event.toolCallId}`;
                    updatePendingStatus(runningToolId, 'running');
                    break;
                }

                // Note: context:compacting and context:compacted are handled in useAgentEvents.ts
                // as the single source of truth for both manual /compact and auto-compaction

                case 'approval:request': {
                    // Handle approval requests in processStream (NOT useAgentEvents) to ensure
                    // proper ordering - text messages must be added BEFORE approval UI shows.
                    // This fixes a race condition where direct event bus subscription in
                    // useAgentEvents fired before the iterator processed llm:tool-call.

                    // Check for bypass permissions mode FIRST
                    // Read from ref to get latest value (may have changed mid-stream)
                    const bypassPermissions = options.bypassPermissionsRef.current;
                    const autoApproveEdits = options.autoApproveEditsRef.current;
                    const { eventBus } = options;

                    if (
                        bypassPermissions &&
                        (event.type === ApprovalTypeEnum.TOOL_APPROVAL ||
                            event.type === ApprovalTypeEnum.COMMAND_APPROVAL)
                    ) {
                        if (event.type === ApprovalTypeEnum.TOOL_APPROVAL) {
                            const { toolName } = event.metadata;
                            if (toolName === 'plan_create' || toolName === 'plan_review') {
                                // Plan tools - no action needed
                            }
                        }

                        eventBus.emit('approval:response', {
                            approvalId: event.approvalId,
                            status: ApprovalStatus.APPROVED,
                            sessionId: event.sessionId,
                            hostRuntime: event.hostRuntime,
                            data: {},
                        });
                        break;
                    }

                    if (autoApproveEdits && event.type === ApprovalTypeEnum.TOOL_APPROVAL) {
                        // Type is narrowed - metadata is now ToolApprovalMetadata
                        const { toolName, approvalKey } = event.metadata;

                        if (approvalKey === undefined && isAutoApprovableInEditMode(toolName)) {
                            // Auto-approve immediately - emit response and let tool:running handle status
                            eventBus.emit('approval:response', {
                                approvalId: event.approvalId,
                                status: ApprovalStatus.APPROVED,
                                sessionId: event.sessionId,
                                hostRuntime: event.hostRuntime,
                                data: {},
                            });
                            break;
                        }
                    }

                    // Manual approval needed - update tool status to 'pending_approval'
                    // Extract toolCallId based on approval type
                    const toolCallId =
                        event.type === ApprovalTypeEnum.TOOL_APPROVAL
                            ? event.metadata.toolCallId
                            : undefined;
                    if (toolCallId) {
                        approvalIdToToolCallId.set(event.approvalId, toolCallId);
                        updatePendingStatus(`tool-${toolCallId}`, 'pending_approval');
                    }

                    // Show approval UI (moved from useAgentEvents for ordering)
                    if (
                        event.type === ApprovalTypeEnum.TOOL_APPROVAL ||
                        event.type === ApprovalTypeEnum.COMMAND_APPROVAL ||
                        event.type === ApprovalTypeEnum.ELICITATION
                    ) {
                        const newApproval: ApprovalRequest = {
                            approvalId: event.approvalId,
                            type: event.type,
                            timestamp: event.timestamp,
                            metadata: event.metadata,
                        };

                        if (event.sessionId !== undefined) {
                            newApproval.sessionId = event.sessionId;
                        }
                        if (event.hostRuntime !== undefined) {
                            newApproval.hostRuntime = event.hostRuntime;
                        }
                        if (event.timeout !== undefined) {
                            newApproval.timeout = event.timeout;
                        }

                        // Queue if there's already an approval, otherwise show immediately
                        setApproval((current) => {
                            if (current !== null) {
                                setApprovalQueue((queue) => [...queue, newApproval]);
                                return current;
                            }
                            setUi((prev) => ({ ...prev, activeOverlay: 'approval' }));
                            return newApproval;
                        });

                        // Play approval sound to notify user
                        options.soundService?.playApprovalSound();
                    }
                    break;
                }

                case 'approval:response': {
                    // Handle approval responses.
                    //
                    // 1) Dismiss auto-approved parallel tool calls (existing behavior)
                    // 2) Finalize tool UI immediately for denied/cancelled approvals so tool
                    //    messages don't remain stuck in "Waiting..." (pending_approval).
                    // 3) For approved: immediately update to 'running' so tool doesn't stay
                    //    stuck at "Waiting..." while waiting for tool:running event.

                    const { approvalId } = event;

                    const toolCallId = approvalIdToToolCallId.get(approvalId);
                    if (toolCallId) {
                        approvalIdToToolCallId.delete(approvalId);

                        if (event.status === ApprovalStatus.APPROVED) {
                            // Immediately transition from pending_approval to running
                            // so the UI doesn't stay stuck at "Waiting..."
                            updatePendingStatus(`tool-${toolCallId}`, 'running');
                        } else {
                            // Denied/cancelled - finalize immediately
                            finalizeMessage(`tool-${toolCallId}`, {
                                toolStatus: 'finished',
                                toolResult: 'Cancelled',
                                isError: true,
                            });
                        }
                    }

                    // Step 1: Remove from queue if present
                    setApprovalQueue((queue) => queue.filter((a) => a.approvalId !== approvalId));

                    // Step 2: If this is the current approval, dismiss and show next
                    // We use the same pattern as completeApproval in OverlayContainer:
                    // setApprovalQueue as coordinator, calling setApproval inside
                    setApproval((currentApproval) => {
                        if (currentApproval?.approvalId !== approvalId) {
                            return currentApproval; // Not current, nothing to do
                        }

                        // Current approval was responded to - show next or close
                        // Note: queue was already filtered in Step 1, so we read updated queue
                        setApprovalQueue((queue) => {
                            if (queue.length > 0) {
                                const [next, ...rest] = queue;
                                if (next) {
                                    setApproval(next);
                                    setUi((prev) => ({ ...prev, activeOverlay: 'approval' }));
                                    return rest;
                                }
                            }

                            setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                            return [];
                        });

                        return null; // Clear current while setApprovalQueue handles next
                    });

                    break;
                }

                case 'service:event': {
                    // Handle service events - extensible pattern for non-core services
                    debug.log('SERVICE-EVENT received', {
                        service: event.service,
                        eventType: event.event,
                        toolCallId: event.toolCallId,
                        sessionId: event.sessionId,
                    });

                    // Handle agent-spawner progress events
                    if (event.service === 'agent-spawner' && event.event === 'progress') {
                        const { toolCallId, data } = event;
                        // Guard against null/non-object data payloads
                        if (toolCallId && data && typeof data === 'object') {
                            // Update the tool message with sub-agent progress
                            const toolMessageId = `tool-${toolCallId}`;
                            const progressData = data as {
                                task: string;
                                agentId: string;
                                runtimeAgentId?: string;
                                subAgentLogFilePath?: string;
                                toolsCalled: number;
                                currentTool: string;
                                currentArgs?: Record<string, unknown>;
                                tokenUsage?: {
                                    input: number;
                                    output: number;
                                    total: number;
                                };
                            };
                            debug.log('SERVICE-EVENT updating progress', {
                                toolMessageId,
                                toolsCalled: progressData.toolsCalled,
                                currentTool: progressData.currentTool,
                                tokenUsage: progressData.tokenUsage,
                            });
                            updatePending(toolMessageId, {
                                subAgentProgress: {
                                    task: progressData.task,
                                    agentId: progressData.agentId,
                                    ...(progressData.runtimeAgentId !== undefined && {
                                        runtimeAgentId: progressData.runtimeAgentId,
                                    }),
                                    ...(progressData.subAgentLogFilePath !== undefined && {
                                        subAgentLogFilePath: progressData.subAgentLogFilePath,
                                    }),
                                    toolsCalled: progressData.toolsCalled,
                                    currentTool: progressData.currentTool,
                                    ...(progressData.currentArgs && {
                                        currentArgs: progressData.currentArgs,
                                    }),
                                    ...(progressData.tokenUsage && {
                                        tokenUsage: progressData.tokenUsage,
                                    }),
                                },
                            });
                        }
                    }

                    // Handle todo update events
                    if (event.service === 'todo' && event.event === 'updated') {
                        const { data, sessionId } = event;
                        if (data && typeof data === 'object' && sessionId) {
                            const todoData = data as {
                                todos?: Array<{
                                    id: string;
                                    sessionId: string;
                                    content: string;
                                    activeForm: string;
                                    status: 'pending' | 'in_progress' | 'completed';
                                    position: number;
                                    createdAt: Date | string;
                                    updatedAt: Date | string;
                                }>;
                                stats?: { created: number; updated: number; deleted: number };
                            };
                            if (!Array.isArray(todoData.todos)) {
                                debug.log('SERVICE-EVENT todo updated: invalid payload', {
                                    sessionId,
                                });
                                break;
                            }
                            debug.log('SERVICE-EVENT todo updated', {
                                sessionId,
                                todoCount: todoData.todos.length,
                                stats: todoData.stats,
                            });
                            // Update todos state via the setter passed in options
                            if (options.setTodos) {
                                options.setTodos(todoData.todos);
                            }
                        }
                    }
                    break;
                }

                // Ignore other events
                default:
                    break;
            }
        }
    } catch (error) {
        // Handle iterator errors (e.g., aborted)
        if (error instanceof Error && error.name === 'AbortError') {
            // Expected when cancelled, clean up UI state
            clearPending();
            setUi((prev) => ({
                ...prev,
                isProcessing: false,
                isCancelling: false,
                isThinking: false,
            }));
        } else {
            // Unexpected error, show to user
            clearPending();

            const errorContent = buildErrorContent(error, 'Stream error: ');

            setMessages((prev) => [
                ...prev,
                {
                    id: generateMessageId('error'),
                    role: 'system',
                    content: errorContent,
                    timestamp: new Date(),
                },
            ]);
            setUi((prev) => ({
                ...prev,
                isProcessing: false,
                isCancelling: false,
                isThinking: false,
            }));
        }
    }
}
