/**
 * Event Handler Registry
 *
 * Maps StreamingEvent types to Zustand store actions.
 * Replaces the 200+ LOC switch statement in useChat.ts with a registry pattern.
 *
 * Each handler is responsible for:
 * - Extracting relevant data from the event
 * - Calling the appropriate store action(s)
 * - Keeping side effects simple and focused
 *
 * @see packages/webui/components/hooks/useChat.ts (original implementation)
 */

import type {
    ApprovalStatus,
    StreamingEvent,
    StreamingEventName,
    ToolPresentationSnapshotV1,
} from '@fius/core';
import { useChatStore, generateMessageId } from '../stores/chatStore.js';
import { useAgentStore } from '../stores/agentStore.js';
import { useApprovalStore } from '../stores/approvalStore.js';
import { usePreferenceStore } from '../stores/preferenceStore.js';
import { useTodoStore } from '../stores/todoStore.js';
import type { ClientEventBus } from './EventBus.js';
import { captureTokenUsage } from '../analytics/capture.js';

/**
 * Derive a human-readable display name from a raw model ID string.
 * E.g. "poolside/laguna-s-2.1:free" → "Laguna S 2.1"
 */
function getModelDisplayNameFromId(modelId: string): string {
    if (!modelId) return '';
    const ACRONYMS = new Set(['gpt', 'o1', 'o3', 'o4', 'glm', 'vl']);
    let name = modelId.replace(/:free$/i, '').replace(/:paid$/i, '').replace(/-free$/i, '');
    const slashIndex = name.indexOf('/');
    if (slashIndex !== -1) name = name.slice(slashIndex + 1);
    return name
        .split(/[-_]/)
        .map((w) => {
            const lower = w.toLowerCase();
            if (ACRONYMS.has(lower)) return w.toUpperCase();
            if (/^\d+[bB]?$/.test(w)) return w.toUpperCase();
            return w.charAt(0).toUpperCase() + w.slice(1);
        })
        .join(' ');
}

interface ChunkBufferEntry {
    sessionId: string;
    content: string;
    chunkType: 'text' | 'reasoning';
}

const chunkBuffers = new Map<string, ChunkBufferEntry[]>();
const chunkRafIds = new Map<string, number>();

function flushChunkBuffer(sessionId: string): void {
    const buffer = chunkBuffers.get(sessionId);
    if (!buffer || buffer.length === 0) return;

    const chatStore = useChatStore.getState();
    const sessionState = chatStore.getSessionState(sessionId);

    if (!sessionState.streamingMessage) {
        const first = buffer[0];
        const newMessage = {
            id: generateMessageId(),
            role: 'assistant' as const,
            content: first.chunkType === 'text' ? first.content : '',
            reasoning: first.chunkType === 'reasoning' ? first.content : undefined,
            createdAt: Date.now(),
            sessionId,
        };
        chatStore.setStreamingMessage(sessionId, newMessage);
        for (let i = 1; i < buffer.length; i++) {
            chatStore.appendToStreamingMessage(sessionId, buffer[i].content, buffer[i].chunkType);
        }
    } else {
        for (const entry of buffer) {
            chatStore.appendToStreamingMessage(sessionId, entry.content, entry.chunkType);
        }
    }

    chunkBuffers.set(sessionId, []);
    chunkRafIds.delete(sessionId);
}

function bufferChunk(sessionId: string, content: string, chunkType: 'text' | 'reasoning'): void {
    if (!chunkBuffers.has(sessionId)) {
        chunkBuffers.set(sessionId, []);
    }
    chunkBuffers.get(sessionId)!.push({ sessionId, content, chunkType });

    if (!chunkRafIds.has(sessionId)) {
        const rafId = requestAnimationFrame(() => flushChunkBuffer(sessionId));
        chunkRafIds.set(sessionId, rafId);
    }
}

type EventHandler<T = StreamingEvent> = (event: T) => void;

type EventByName<T extends StreamingEventName> = Extract<StreamingEvent, { name: T }>;

const handlers = new Map<StreamingEventName, EventHandler<StreamingEvent>>();

function registerHandler<TName extends StreamingEventName>(
    name: TName,
    handler: EventHandler<EventByName<TName>>
): void {
    handlers.set(name, handler as EventHandler<StreamingEvent>);
}

function finalizeStreamingIfNeeded(sessionId: string): void {
    const chatStore = useChatStore.getState();
    const sessionState = chatStore.getSessionState(sessionId);

    if (sessionState.streamingMessage) {
        chatStore.finalizeStreamingMessage(sessionId, {});
    }
}

function stripToolNameForMatching(name: string): string {
    if (name.startsWith('mcp--')) {
        const trimmed = name.substring('mcp--'.length);
        const parts = trimmed.split('--');
        return parts.length >= 2 ? parts.slice(1).join('--') : trimmed;
    }
    return name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolPresentationSnapshotV1(value: unknown): value is ToolPresentationSnapshotV1 {
    return isRecord(value) && value.version === 1;
}

function getApprovalRequestToolContext(event: EventByName<'approval:request'>): {
    approvalId: string;
    toolCallId?: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    presentationSnapshot?: EventByName<'llm:tool-call'>['presentationSnapshot'];
    approvalType: EventByName<'approval:request'>['type'];
} {
    const metadata: Record<string, unknown> = isRecord(event.metadata) ? event.metadata : {};
    const toolName = typeof metadata['toolName'] === 'string' ? metadata['toolName'] : 'unknown';
    const toolCallId =
        typeof metadata['toolCallId'] === 'string' ? metadata['toolCallId'] : undefined;
    const presentationSnapshot = isToolPresentationSnapshotV1(metadata['presentationSnapshot'])
        ? metadata['presentationSnapshot']
        : undefined;
    const toolArgs = isRecord(metadata['args']) ? metadata['args'] : {};

    return {
        approvalId: event.approvalId,
        toolCallId,
        toolName,
        toolArgs,
        presentationSnapshot,
        approvalType: event.type,
    };
}

function hasMeaningfulTokenUsageForAnalytics(
    tokenUsage: EventByName<'llm:response'>['tokenUsage'],
    estimatedCost?: number
): boolean {
    if (estimatedCost !== undefined) {
        return true;
    }

    if (!tokenUsage) {
        return false;
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

function handleLLMThinking(event: EventByName<'llm:thinking'>): void {
    const { sessionId } = event;

    useChatStore.getState().setProcessing(sessionId, true);

    useAgentStore.getState().setThinking(sessionId);
}

/**
 * llm:chunk - LLM sent streaming chunk
 * Appends content to streaming message (text or reasoning)
 *
 * When streaming is disabled (user preference), chunks are skipped
 * and the full content comes via llm:response instead.
 */
function handleLLMChunk(event: EventByName<'llm:chunk'>): void {
    const isStreaming = usePreferenceStore.getState().isStreaming;
    if (!isStreaming) {
        return;
    }

    const { sessionId, content, chunkType = 'text' } = event;

    bufferChunk(sessionId, content, chunkType);
}

/**
 * llm:response - LLM sent final response
 * Finalizes streaming message OR creates assistant message if needed
 *
 * Handles three scenarios:
 * 1. Streaming mode: streaming message exists → finalize with content and metadata
 * 2. Non-streaming mode: no streaming message → create new assistant message
 * 3. Multi-turn: assistant message already in messages array → update it
 */
function handleLLMResponse(event: EventByName<'llm:response'>): void {
    const {
        sessionId,
        content,
        reasoning,
        tokenUsage,
        model,
        displayName,
        provider,
        estimatedCost,
        costBreakdown,
        estimatedInputTokens,
        reasoningVariant,
        reasoningBudgetTokens,
    } = event;
    const chatStore = useChatStore.getState();
    const sessionState = chatStore.getSessionState(sessionId);
    const finalContent = typeof content === 'string' ? content : '';

const effectiveDisplayName = displayName || (model ? getModelDisplayNameFromId(model) : undefined);

    flushChunkBuffer(sessionId);

    if (sessionState.streamingMessage) {
        chatStore.finalizeStreamingMessage(sessionId, {
            content: finalContent,
            ...(reasoning && { reasoning }),
            tokenUsage,
            ...(model && { model }),
            ...(effectiveDisplayName && { displayName: effectiveDisplayName }),
            ...(provider && { provider }),
        });

        if (hasMeaningfulTokenUsageForAnalytics(tokenUsage, estimatedCost)) {
            let estimateAccuracyPercent: number | undefined;
            const actualInputTokens = tokenUsage?.inputTokens;
            if (estimatedInputTokens !== undefined && actualInputTokens) {
                const diff = estimatedInputTokens - actualInputTokens;
                estimateAccuracyPercent = Math.round((diff / actualInputTokens) * 100);
            }

            captureTokenUsage({
                sessionId,
                provider,
                model,
                reasoningVariant,
                reasoningBudgetTokens,
                inputTokens: tokenUsage?.inputTokens,
                outputTokens: tokenUsage?.outputTokens,
                reasoningTokens: tokenUsage?.reasoningTokens,
                totalTokens: tokenUsage?.totalTokens,
                cacheReadTokens: tokenUsage?.cacheReadTokens,
                cacheWriteTokens: tokenUsage?.cacheWriteTokens,
                estimatedCostUsd: estimatedCost,
                inputCostUsd: costBreakdown?.inputUsd,
                outputCostUsd: costBreakdown?.outputUsd,
                reasoningCostUsd: costBreakdown?.reasoningUsd,
                cacheReadCostUsd: costBreakdown?.cacheReadUsd,
                cacheWriteCostUsd: costBreakdown?.cacheWriteUsd,
                estimatedInputTokens,
                estimateAccuracyPercent,
            });
        }
        return;
    }

    const messages = sessionState.messages;

    let recentAssistantMsg = null;
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant') {
            recentAssistantMsg = msg;
            break;
        }
        if (msg.role === 'user') {
            break;
        }
    }

    if (recentAssistantMsg) {
        chatStore.updateMessage(sessionId, recentAssistantMsg.id, {
            content: finalContent || recentAssistantMsg.content,
            ...(reasoning && { reasoning }),
            tokenUsage,
            ...(model && { model }),
            ...(effectiveDisplayName && { displayName: effectiveDisplayName }),
            ...(provider && { provider }),
        });
    } else if (finalContent) {
        chatStore.addMessage(sessionId, {
            id: generateMessageId(),
            role: 'assistant',
            content: finalContent,
            ...(reasoning && { reasoning }),
            tokenUsage,
            ...(model && { model }),
            ...(effectiveDisplayName && { displayName: effectiveDisplayName }),
            ...(provider && { provider }),
            createdAt: Date.now(),
            sessionId,
        });
    }

    if (hasMeaningfulTokenUsageForAnalytics(tokenUsage, estimatedCost)) {
        let estimateAccuracyPercent: number | undefined;
        const actualInputTokens = tokenUsage?.inputTokens;
        if (estimatedInputTokens !== undefined && actualInputTokens) {
            const diff = estimatedInputTokens - actualInputTokens;
            estimateAccuracyPercent = Math.round((diff / actualInputTokens) * 100);
        }

        captureTokenUsage({
            sessionId,
            provider,
            model,
            reasoningVariant,
            reasoningBudgetTokens,
            inputTokens: tokenUsage?.inputTokens,
            outputTokens: tokenUsage?.outputTokens,
            reasoningTokens: tokenUsage?.reasoningTokens,
            totalTokens: tokenUsage?.totalTokens,
            cacheReadTokens: tokenUsage?.cacheReadTokens,
            cacheWriteTokens: tokenUsage?.cacheWriteTokens,
            estimatedCostUsd: estimatedCost,
            inputCostUsd: costBreakdown?.inputUsd,
            outputCostUsd: costBreakdown?.outputUsd,
            reasoningCostUsd: costBreakdown?.reasoningUsd,
            cacheReadCostUsd: costBreakdown?.cacheReadUsd,
            cacheWriteCostUsd: costBreakdown?.cacheWriteUsd,
            estimatedInputTokens,
            estimateAccuracyPercent,
        });
    }
}

/**
 * interaction:blocked - User interaction was blocked before an LLM call.
 * Creates the persisted assistant message without usage metadata.
 */
function handleInteractionBlocked(event: EventByName<'interaction:blocked'>): void {
    const { sessionId, content, provider, model, displayName, messageId } = event;
    const chatStore = useChatStore.getState();

    finalizeStreamingIfNeeded(sessionId);
    chatStore.addMessage(sessionId, {
        id: messageId,
        role: 'assistant',
        content,
        provider,
        model,
        ...(displayName && { displayName }),
        createdAt: Date.now(),
        sessionId,
    });
    chatStore.setProcessing(sessionId, false);
    useAgentStore.getState().setIdle();
}

/**
 * llm:tool-call - LLM requested a tool call
 * Adds a tool message to the chat
 *
 * Checks if an approval message already exists for this tool to avoid duplicates.
 * This handles cases where approval:request arrives before llm:tool-call.
 */
function handleToolCall(event: EventByName<'llm:tool-call'>): void {
    const { sessionId, toolName, args, callId, presentationSnapshot } = event;
    const chatStore = useChatStore.getState();

    finalizeStreamingIfNeeded(sessionId);

    const messages = chatStore.getMessages(sessionId);

    const existingMessage = messages.find(
        (m) => m.role === 'tool' && m.toolCallId === callId && m.toolResult === undefined
    );

    if (existingMessage) {
        chatStore.updateMessage(sessionId, existingMessage.id, {
            toolArgs: args,
            ...(presentationSnapshot !== undefined && { presentationSnapshot }),
        });
        console.debug('[handlers] Tool call message already exists:', existingMessage.id);
        return;
    }

    const cleanToolName = stripToolNameForMatching(toolName);

    const pendingApprovalMessage = messages.find((m) => {
        if (m.role !== 'tool' || m.toolResult !== undefined) return false;
        if (m.requireApproval !== true || m.approvalStatus !== 'pending') return false;
        if (m.toolCallId === callId) return true;

        if (m.toolName === toolName) return true;
        if (m.toolName && stripToolNameForMatching(m.toolName) === cleanToolName) return true;

        return false;
    });

    if (pendingApprovalMessage) {
        chatStore.updateMessage(sessionId, pendingApprovalMessage.id, {
            toolCallId: callId,
            toolArgs: args,
            ...(presentationSnapshot !== undefined && { presentationSnapshot }),
        });
        console.debug(
            '[handlers] Updated existing approval message with callId:',
            pendingApprovalMessage.id
        );
        return;
    }

    const toolMessage = {
        id: `tool-${callId}`,
        role: 'tool' as const,
        content: null,
        toolName,
        ...(presentationSnapshot !== undefined && { presentationSnapshot }),
        toolArgs: args,
        toolCallId: callId,
        createdAt: Date.now(),
        sessionId,
    };

    chatStore.addMessage(sessionId, toolMessage);

    useAgentStore.getState().setExecutingTool(sessionId, toolName);
}

/**
 * llm:tool-result - LLM returned a tool result
 * Updates the tool message with the result
 *
 * Finds the tool message by multiple strategies:
 * 1. Direct match by toolCallId
 * 2. Message with id `tool-${callId}` or `approval-${callId}`
 * 3. Most recent pending tool message (fallback)
 */
function handleToolResult(event: EventByName<'llm:tool-result'>): void {
    const {
        sessionId,
        callId,
        success,
        sanitized,
        requireApproval,
        approvalStatus,
        presentationSnapshot,
    } = event;
    const chatStore = useChatStore.getState();

    let message = callId ? chatStore.getMessageByToolCallId(sessionId, callId) : undefined;

    if (!message && callId) {
        const messages = chatStore.getMessages(sessionId);
        message = messages.find((m) => m.id === `tool-${callId}` || m.id === `approval-${callId}`);
    }

    if (!message) {
        const messages = chatStore.getMessages(sessionId);
        const pendingTools = messages
            .filter((m) => m.role === 'tool' && m.toolResult === undefined)
            .sort((a, b) => b.createdAt - a.createdAt);

        message = pendingTools.find((m) => m.id.startsWith('approval-')) || pendingTools[0];
    }

    if (message) {
        chatStore.updateMessage(sessionId, message.id, {
            toolResult: sanitized,
            toolResultMeta: sanitized?.meta,
            toolResultSuccess: success,
            ...(presentationSnapshot !== undefined && { presentationSnapshot }),
            ...(requireApproval !== undefined && { requireApproval }),
            ...(approvalStatus !== undefined && { approvalStatus }),
        });
    } else {
        console.warn('[handlers] Could not find tool message to update for callId:', callId);
    }
}

/**
 * llm:error - LLM encountered an error
 * Sets error state and stops processing
 */
function handleLLMError(event: EventByName<'llm:error'>): void {
    const { sessionId, error, context, recoverable } = event;
    const chatStore = useChatStore.getState();

    const messages = sessionId ? chatStore.getMessages(sessionId) : [];
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : undefined;

    chatStore.setError(sessionId, {
        id: generateMessageId(),
        message: error?.message || 'Unknown error',
        timestamp: Date.now(),
        context,
        recoverable,
        sessionId,
        anchorMessageId: lastMsg?.id,
    });

    chatStore.setProcessing(sessionId, false);

    useAgentStore.getState().setIdle();
}

function handleApprovalRequest(event: EventByName<'approval:request'>): void {
    const sessionId = event.sessionId || '';
    const chatStore = useChatStore.getState();

    if (sessionId) {
        finalizeStreamingIfNeeded(sessionId);
    }

    useApprovalStore.getState().addApproval(event);

    const { approvalId, toolCallId, toolName, toolArgs, presentationSnapshot, approvalType } =
        getApprovalRequestToolContext(event);

    const cleanToolName = stripToolNameForMatching(toolName);

    const messages = chatStore.getMessages(sessionId);
    const existingToolMessage = toolCallId
        ? messages.find(
              (m) =>
                  m.role === 'tool' &&
                  m.toolResult === undefined &&
                  m.requireApproval !== true &&
                  m.toolCallId === toolCallId
          )
        : messages.find((m) => {
              if (m.role !== 'tool' || m.toolResult !== undefined) return false;
              if (m.requireApproval === true) return false;
              if (m.toolName === toolName) return true;
              if (m.toolName && stripToolNameForMatching(m.toolName) === cleanToolName) {
                  return true;
              }
              return false;
          });

    if (existingToolMessage) {
        chatStore.updateMessage(sessionId, existingToolMessage.id, {
            requireApproval: true,
            approvalStatus: 'pending',
            toolResultSuccess: undefined,
            ...(presentationSnapshot !== undefined && { presentationSnapshot }),
        });
        console.debug(
            '[handlers] Updated existing tool message with approval:',
            existingToolMessage.id
        );
    } else if (sessionId) {
        const existingApprovalMessage = toolCallId
            ? messages.find(
                  (m) =>
                      m.role === 'tool' &&
                      m.requireApproval === true &&
                      m.approvalStatus === 'pending' &&
                      m.toolResult === undefined &&
                      m.toolCallId === toolCallId
              )
            : messages.find(
                  (m) =>
                      m.role === 'tool' &&
                      m.requireApproval === true &&
                      m.approvalStatus === 'pending' &&
                      m.toolResult === undefined &&
                      (m.toolName === toolName ||
                          (m.toolName && stripToolNameForMatching(m.toolName) === cleanToolName))
              );

        if (existingApprovalMessage) {
            console.debug(
                '[handlers] Approval message already exists:',
                existingApprovalMessage.id
            );
        } else {
            const approvalMessage = {
                id: `approval-${approvalId}`,
                role: 'tool' as const,
                content: null,
                toolName,
                ...(presentationSnapshot !== undefined && { presentationSnapshot }),
                toolArgs,
                toolCallId: toolCallId ?? approvalId,
                createdAt: Date.now(),
                sessionId,
                requireApproval: true,
                approvalStatus: 'pending' as const,
                ...(approvalType && { approvalType }),
            };
            chatStore.addMessage(sessionId, approvalMessage);
        }
    }

    if (sessionId) {
        useAgentStore.getState().setAwaitingApproval(sessionId);
    }
}

function handleApprovalResponse(event: EventByName<'approval:response'>): void {
    const { status } = event;
    const sessionId = event.sessionId || '';
    const approvalId = event.approvalId;

    useApprovalStore.getState().processResponse(event);

    if (sessionId && approvalId) {
        const chatStore = useChatStore.getState();
        const messages = chatStore.getMessages(sessionId);

        const approvalMessage = messages.find(
            (m) =>
                m.id === `approval-${approvalId}` ||
                (m.toolCallId === approvalId && m.requireApproval)
        );

        if (approvalMessage) {
            const approvalStatus =
                status === ('approved' as ApprovalStatus) ? 'approved' : 'rejected';
            chatStore.updateMessage(sessionId, approvalMessage.id, {
                approvalStatus,
                ...(approvalStatus === 'rejected' && { toolResultSuccess: false }),
            });
            console.debug(
                '[handlers] Updated approval status:',
                approvalMessage.id,
                approvalStatus
            );
        }
    }

    const approved = status === ('approved' as ApprovalStatus);

    if (approved) {
        if (sessionId) {
            useAgentStore.getState().setThinking(sessionId);
        }
    } else {
        useAgentStore.getState().setIdle();
        if (sessionId) {
            useChatStore.getState().setProcessing(sessionId, false);
        }
    }
}

/**
 * run:complete - Agent run completed
 * Sets processing=false and agent status to idle
 */
function handleRunComplete(event: EventByName<'run:complete'>): void {
    const { sessionId } = event;
    const chatStore = useChatStore.getState();

    chatStore.setProcessing(sessionId, false);

    useAgentStore.getState().setIdle();
}

function handleSessionTitleUpdated(event: EventByName<'session:title-updated'>): void {
    console.debug('[handlers] session:title-updated', event.sessionId, event.title);
}

function handleMessageDequeued(event: EventByName<'message:dequeued'>): void {
    const { sessionId, content } = event;
    const chatStore = useChatStore.getState();

    const textContent = content
        .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

    const imagePart = content.find(
        (part): part is Extract<typeof part, { type: 'image' }> => part.type === 'image'
    );

    const filePart = content.find(
        (part): part is Extract<typeof part, { type: 'file' }> => part.type === 'file'
    );

    if (textContent || content.length > 0) {
        const imageDataValue =
            imagePart && typeof imagePart.image === 'string'
                ? {
                      image: imagePart.image,
                      mimeType: imagePart.mimeType ?? 'image/jpeg',
                  }
                : undefined;

        const userMessage = {
            id: generateMessageId(),
            role: 'user' as const,
            content: textContent || '[attachment]',
            createdAt: Date.now(),
            sessionId,
            imageData: imageDataValue,
            fileData: filePart
                ? {
                      data: typeof filePart.data === 'string' ? filePart.data : '',
                      mimeType: filePart.mimeType,
                      filename: filePart.filename,
                  }
                : undefined,
        };

        chatStore.addMessage(sessionId, userMessage);
    }
}

function handleContextCompacted(event: EventByName<'context:compacted'>): void {
    console.debug(
        `[handlers] Context compacted: ${event.originalTokens.toLocaleString()} → ${event.compactedTokens.toLocaleString()} tokens (${event.originalMessages} → ${event.compactedMessages} messages) via ${event.strategy}`
    );
}

function handleServiceEvent(event: EventByName<'service:event'>): void {
    const { service, event: eventType, toolCallId, sessionId, data } = event;

    if (service === 'agent-spawner' && eventType === 'progress' && toolCallId && sessionId) {
        const chatStore = useChatStore.getState();
        const progressData = data as {
            task: string;
            agentId: string;
            toolsCalled: number;
            currentTool: string;
            currentArgs?: Record<string, unknown>;
        };

        const messages = chatStore.getMessages(sessionId);
        const toolMessage = messages.find((m) => m.role === 'tool' && m.toolCallId === toolCallId);

        if (toolMessage) {
            chatStore.updateMessage(sessionId, toolMessage.id, {
                subAgentProgress: {
                    task: progressData.task,
                    agentId: progressData.agentId,
                    toolsCalled: progressData.toolsCalled,
                    currentTool: progressData.currentTool,
                    currentArgs: progressData.currentArgs,
                },
            });
        }
    }

    if (service === 'todo' && eventType === 'updated' && sessionId) {
        const todoData = data as {
            todos: Array<{
                id: string;
                sessionId: string;
                content: string;
                activeForm: string;
                status: 'pending' | 'in_progress' | 'completed';
                position: number;
                createdAt: Date | string;
                updatedAt: Date | string;
            }>;
            stats: { created: number; updated: number; deleted: number };
        };

        useTodoStore.getState().setTodos(sessionId, todoData.todos);
    }
}

/**
 * llm:switched - LLM configuration was switched
 * Dispatches a window event so React components can refetch currentLLM
 */
function handleLLMSwitched(event: EventByName<'llm:switched'>): void {
    console.debug('[handlers] llm:switched', event.sessionIds, event.newConfig?.model);
    window.dispatchEvent(new CustomEvent('llm:switched', { detail: event }));
}

/**
 * Register all handlers in the registry
 * Call this once during initialization
 */
export function registerHandlers(): void {
    handlers.clear();

    registerHandler('llm:thinking', handleLLMThinking);
    registerHandler('llm:chunk', handleLLMChunk);
    registerHandler('llm:response', handleLLMResponse);
    registerHandler('interaction:blocked', handleInteractionBlocked);
    registerHandler('llm:tool-call', handleToolCall);
    registerHandler('llm:tool-result', handleToolResult);
    registerHandler('llm:error', handleLLMError);
    registerHandler('approval:request', handleApprovalRequest);
    registerHandler('approval:response', handleApprovalResponse);
    registerHandler('run:complete', handleRunComplete);
    registerHandler('llm:switched', handleLLMSwitched);
    registerHandler('session:title-updated', handleSessionTitleUpdated);
    registerHandler('message:dequeued', handleMessageDequeued);
    registerHandler('context:compacted', handleContextCompacted);
    registerHandler('service:event', handleServiceEvent);
}

/**
 * Get a handler for a specific event name
 *
 * @param name - Event name
 * @returns Handler function or undefined if not registered
 */
export function getHandler(name: string): EventHandler<StreamingEvent> | undefined {
    return handlers.get(name as StreamingEventName);
}

/**
 * Setup event handlers for the EventBus
 * Registers all handlers and subscribes them to the bus
 *
 * @param bus - ClientEventBus instance
 *
 * @example
 * ```tsx
 * const bus = useEventBus();
 * useEffect(() => {
 *   const cleanup = setupEventHandlers(bus);
 *   return cleanup;
 * }, [bus]);
 * ```
 */
export function setupEventHandlers(bus: ClientEventBus): () => void {
    registerHandlers();

    const subscriptions: Array<{ unsubscribe: () => void }> = [];

    handlers.forEach((handler, eventName) => {
        const subscription = bus.on(eventName, handler);
        subscriptions.push(subscription);
    });

    return () => {
        subscriptions.forEach((sub) => sub.unsubscribe());
    };
}

export {
    handleLLMThinking,
    handleLLMChunk,
    handleLLMResponse,
    handleInteractionBlocked,
    handleToolCall,
    handleToolResult,
    handleLLMError,
    handleApprovalRequest,
    handleApprovalResponse,
    handleRunComplete,
    handleSessionTitleUpdated,
    handleMessageDequeued,
    handleContextCompacted,
    handleServiceEvent,
};
