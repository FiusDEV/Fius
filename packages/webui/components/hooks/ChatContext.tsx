import React, {
    createContext,
    useContext,
    ReactNode,
    useEffect,
    useState,
    useCallback,
    useRef,
} from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useChat, Message, UIUserMessage, UIAssistantMessage, UIToolMessage } from './useChat';
import { usePendingApprovals } from './useApprovals';
import type { FilePart, ImagePart, ResourcePart, TextPart, UIResourcePart } from '../../types';
import type { SanitizedToolResult, ApprovalRequest } from '@fius/core';
import { getResourceKind } from '@fius/core';
import { useAnalytics } from '@/lib/analytics/index.js';
import { queryKeys } from '@/lib/queryKeys.js';
import { client } from '@/lib/client.js';
import { eventBus } from '@/lib/events/EventBus.js';
import { useMutation } from '@tanstack/react-query';
import {
    useAgentStore,
    useSessionStore,
    useChatStore,
    useCurrentSessionId,
    useIsWelcomeState,
    useSessionMessages,
} from '@/lib/stores/index.js';
import type { Attachment } from '../../lib/attachment-types.js';
import {
    mergeSessionProcessingState,
    resolveRestoredSessionActivity,
} from './session-processing.js';

type HistoryEndpoint = (typeof client.api.sessions)[':sessionId']['history'];

type HistoryResponse = Awaited<ReturnType<HistoryEndpoint['$get']>>;
type HistoryData = Awaited<ReturnType<Extract<HistoryResponse, { ok: true }>['json']>>;
type HistoryMessage = HistoryData['history'][number];

type ToolCall = NonNullable<HistoryMessage['toolCalls']>[number];

interface ChatContextType {
    messages: Message[];
    sendMessage: (content: string, attachments?: Attachment[]) => void;
    reset: () => void;
    switchSession: (sessionId: string) => void;
    loadSessionHistory: (sessionId: string) => Promise<void>;
    ensureSessionEventStream: (sessionId?: string) => Promise<void>;
    returnToWelcome: () => void;
    cancel: (sessionId?: string) => void;
}

async function fetchSessionActivityState(
    sessionId: string
): Promise<{ isBusy: boolean; hasPendingApprovals: boolean }> {
    const sessionResponse = await client.api.sessions[':sessionId'].load.$get({
        param: { sessionId },
    });

    if (!sessionResponse.ok) {
        throw new Error(`Failed to fetch session activity: ${sessionResponse.status}`);
    }

    const sessionData = await sessionResponse.json();
    const approvalsResponse = await client.api.approvals
        .$get({
            query: { sessionId },
        })
        .catch(() => null);
    const approvalsData =
        approvalsResponse && approvalsResponse.ok
            ? await approvalsResponse.json()
            : { approvals: [] };

    return {
        isBusy: sessionData.session.isBusy,
        hasPendingApprovals: approvalsData.approvals.length > 0,
    };
}

async function fetchSessionHistory(
    sessionId: string
): Promise<{ messages: Message[]; isBusy: boolean }> {
    const response = await client.api.sessions[':sessionId'].history.$get({
        param: { sessionId },
    });
    if (!response.ok) {
        throw new Error('Failed to fetch session history');
    }
    const data = await response.json();
    const history = data.history || [];
    return {
        messages: convertHistoryToMessages(history, sessionId),
        isBusy: data.isBusy ?? false,
    };
}

function convertHistoryToMessages(history: HistoryMessage[], sessionId: string): Message[] {
    const uiMessages: Message[] = [];
    const pendingToolCalls = new Map<string, number>();

    for (let index = 0; index < history.length; index++) {
        const msg = history[index];
        const createdAt = msg.timestamp ?? Date.now() - (history.length - index) * 1000;
        const baseId = `session-${sessionId}-${index}`;

        if (msg.role === 'system') {
            continue;
        }

        const deriveResources = (
            content: Array<TextPart | ImagePart | FilePart | ResourcePart | UIResourcePart>
        ): SanitizedToolResult['resources'] => {
            const resources: NonNullable<SanitizedToolResult['resources']> = [];

            for (const part of content) {
                if (
                    part.type === 'image' &&
                    typeof part.image === 'string' &&
                    part.image.startsWith('@blob:')
                ) {
                    const uri = part.image.substring(1);
                    resources.push({
                        uri,
                        kind: 'image',
                        mimeType: part.mimeType ?? 'image/jpeg',
                    });
                }

                if (
                    part.type === 'file' &&
                    typeof part.data === 'string' &&
                    part.data.startsWith('@blob:')
                ) {
                    const uri = part.data.substring(1);
                    const mimeType = part.mimeType ?? 'application/octet-stream';
                    const kind = getResourceKind(mimeType);

                    resources.push({
                        uri,
                        kind,
                        mimeType,
                        ...(part.filename ? { filename: part.filename } : {}),
                    });
                }

                if (part.type === 'resource') {
                    resources.push({
                        uri: part.uri,
                        kind: getResourceKind(part.mimeType),
                        mimeType: part.mimeType,
                        ...(part.name ? { filename: part.name } : {}),
                    });
                }
            }

            return resources.length > 0 ? resources : undefined;
        };

        if (msg.role === 'assistant') {
            if (msg.content) {
                let textContent: string | null = null;
                if (typeof msg.content === 'string') {
                    textContent = msg.content;
                } else if (Array.isArray(msg.content)) {
                    const textParts = (msg.content as unknown[])
                        .filter((part: unknown): part is TextPart => {
                            if (typeof part !== 'object' || part === null) return false;
                            const maybe = part as { type?: unknown; text?: unknown };
                            return maybe.type === 'text' && typeof maybe.text === 'string';
                        })
                        .map((part) => part.text);
                    textContent = textParts.length > 0 ? textParts.join('\n') : null;
                }

                const assistantMessage: UIAssistantMessage = {
                    id: baseId,
                    role: 'assistant',
                    content: textContent,
                    createdAt,
                    sessionId,
                    tokenUsage: msg.tokenUsage,
                    reasoning: msg.reasoning,
                    model: msg.model,
                    displayName: msg.displayName,
                    provider: msg.provider,
                };
                uiMessages.push(assistantMessage);
            }

            if (msg.toolCalls && msg.toolCalls.length > 0) {
                msg.toolCalls.forEach((toolCall: ToolCall, toolIndex: number) => {
                    let toolArgs: Record<string, unknown> = {};
                    if (toolCall?.function) {
                        try {
                            toolArgs = JSON.parse(toolCall.function.arguments || '{}');
                        } catch (e) {
                            console.warn(
                                `Failed to parse toolCall arguments for ${toolCall.function?.name || 'unknown'}: ${e}`
                            );
                            toolArgs = {};
                        }
                    }
                    const toolName = toolCall.function?.name || 'unknown';

                    const toolMessage: UIToolMessage = {
                        id: `${baseId}-tool-${toolIndex}`,
                        role: 'tool',
                        content: null,
                        createdAt: createdAt + toolIndex,
                        sessionId,
                        toolName,
                        toolArgs,
                        toolCallId: toolCall.id,
                    };

                    if (typeof toolCall.id === 'string' && toolCall.id.length > 0) {
                        pendingToolCalls.set(toolCall.id, uiMessages.length);
                    }

                    uiMessages.push(toolMessage);
                });
            }

            continue;
        }

        if (msg.role === 'tool') {
            const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
            const toolName = typeof msg.name === 'string' ? msg.name : 'unknown';
            const normalizedContent: Array<
                TextPart | ImagePart | FilePart | ResourcePart | UIResourcePart
            > = Array.isArray(msg.content)
                ? (msg.content as Array<
                      TextPart | ImagePart | FilePart | ResourcePart | UIResourcePart
                  >)
                : typeof msg.content === 'string'
                  ? [{ type: 'text', text: msg.content }]
                  : [];

            const inferredResources = deriveResources(normalizedContent);
            const success =
                'success' in msg && typeof msg.success === 'boolean' ? msg.success : true;
            const sanitizedFromHistory: SanitizedToolResult = {
                content: normalizedContent,
                ...(inferredResources ? { resources: inferredResources } : {}),
                meta: {
                    toolName,
                    toolCallId: toolCallId ?? `tool-${index}`,
                    success,
                },
            };

            const requireApproval: boolean | undefined =
                'requireApproval' in msg && typeof msg.requireApproval === 'boolean'
                    ? msg.requireApproval
                    : undefined;
            const approvalStatus: 'pending' | 'approved' | 'rejected' | undefined =
                'approvalStatus' in msg &&
                (msg.approvalStatus === 'pending' ||
                    msg.approvalStatus === 'approved' ||
                    msg.approvalStatus === 'rejected')
                    ? msg.approvalStatus
                    : undefined;

            if (toolCallId && pendingToolCalls.has(toolCallId)) {
                const messageIndex = pendingToolCalls.get(toolCallId)!;
                const existingMessage = uiMessages[messageIndex] as UIToolMessage;
                uiMessages[messageIndex] = {
                    ...existingMessage,
                    toolResult: sanitizedFromHistory,
                    toolResultMeta: sanitizedFromHistory.meta,
                    toolResultSuccess: sanitizedFromHistory.meta?.success,
                    ...(requireApproval !== undefined && { requireApproval }),
                    ...(approvalStatus !== undefined && { approvalStatus }),
                };
            } else {
                const toolMessage: UIToolMessage = {
                    id: baseId,
                    role: 'tool',
                    content: null,
                    createdAt,
                    sessionId,
                    toolName,
                    toolCallId,
                    toolResult: sanitizedFromHistory,
                    toolResultMeta: sanitizedFromHistory.meta,
                    toolResultSuccess: sanitizedFromHistory.meta?.success,
                    ...(requireApproval !== undefined && { requireApproval }),
                    ...(approvalStatus !== undefined && { approvalStatus }),
                };
                uiMessages.push(toolMessage);
            }

            continue;
        }

        if (msg.role === 'user') {
            const userMessage: UIUserMessage = {
                id: baseId,
                role: 'user',
                content: msg.content,
                createdAt,
                sessionId,
            };
            uiMessages.push(userMessage);
        }
    }

    for (const [_callId, messageIndex] of pendingToolCalls) {
        const msg = uiMessages[messageIndex];
        if (msg && msg.role === 'tool' && msg.toolResult === undefined) {
            uiMessages[messageIndex] = {
                ...msg,
                toolResultSuccess: false,
            };
        }
    }

    return uiMessages;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
    const navigate = useNavigate();
    const analytics = useAnalytics();
    const queryClient = useQueryClient();

    const currentSessionId = useCurrentSessionId();
    const isWelcomeState = useIsWelcomeState();

    const [isSwitchingSession, setIsSwitchingSession] = useState(false);
    const [isCreatingSession, setIsCreatingSession] = useState(false);
    const lastSwitchedSessionRef = useRef<string | null>(null);
    const newSessionWithMessageRef = useRef<string | null>(null);
    const currentSessionIdRef = useRef<string | null>(null);

    const sessionAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

    const {
        attachSessionStream: originalAttachSessionStream,
        sendMessage: originalSendMessage,
        reset: originalReset,
        cancel,
    } = useChat(currentSessionIdRef, sessionAbortControllersRef);

    const { data: pendingApprovalsData } = usePendingApprovals(currentSessionId);
    const restoredApprovalsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!pendingApprovalsData?.approvals || pendingApprovalsData.approvals.length === 0) {
            return;
        }

        for (const approval of pendingApprovalsData.approvals) {
            if (restoredApprovalsRef.current.has(approval.approvalId)) {
                continue;
            }

            restoredApprovalsRef.current.add(approval.approvalId);

            const restoredApproval = {
                approvalId: approval.approvalId,
                type: approval.type,
                sessionId: approval.sessionId,
                timeout: approval.timeout,
                timestamp: new Date(approval.timestamp),
                metadata: approval.metadata,
            } as ApprovalRequest;

            eventBus.dispatch({
                name: 'approval:request',
                ...restoredApproval,
            });
        }
    }, [pendingApprovalsData]);

    useEffect(() => {
        restoredApprovalsRef.current.clear();
    }, [currentSessionId]);

    const messages = useSessionMessages(currentSessionId);

    const { mutate: generateTitle } = useMutation({
        mutationFn: async (sessionId: string) => {
            const response = await client.api.sessions[':sessionId']['generate-title'].$post({
                param: { sessionId },
            });
            if (!response.ok) {
                throw new Error('Failed to generate title');
            }
            const data = await response.json();
            return data.title;
        },
        onSuccess: (_title, sessionId) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
        },
    });

    const createAutoSession = useCallback(async (): Promise<string> => {
        const response = await client.api.sessions.$post({
            json: {},
        });

        if (!response.ok) {
            throw new Error('Failed to create session');
        }

        const data = await response.json();

        if (!data.session?.id) {
            throw new Error('Session ID not found in server response');
        }

        const sessionId = data.session.id;

        analytics.trackSessionCreated({
            sessionId,
            trigger: 'first_message',
        });

        return sessionId;
    }, [analytics]);

    const sendMessage = useCallback(
        async (content: string, attachments?: Attachment[]) => {
            let sessionId = currentSessionId;
            let isNewSession = false;

            if (!sessionId && isWelcomeState) {
                if (isCreatingSession) return;
                try {
                    setIsCreatingSession(true);
                    sessionId = await createAutoSession();
                    isNewSession = true;

                    newSessionWithMessageRef.current = sessionId;

                    currentSessionIdRef.current = sessionId;

                    originalSendMessage(content, attachments, sessionId);

                    navigate({ to: `/chat/${sessionId}`, replace: true });

                    setTimeout(() => {
                        if (sessionId) generateTitle(sessionId);
                    }, 0);

                } catch (error) {
                    console.error('Failed to create session:', error);
                    return;
                } finally {
                    setIsCreatingSession(false);
                }
            }

            if (sessionId && !isNewSession) {
                originalSendMessage(content, attachments, sessionId);
            }

            if (sessionId) {
                const hasImage = attachments?.some((a) => a.type === 'image') ?? false;
                const hasFile = attachments?.some((a) => a.type === 'file') ?? false;
                analytics.trackMessageSent({
                    sessionId,
                    provider: 'unknown', // Provider/model tracking moved to component level
                    model: 'unknown',
                    hasImage,
                    hasFile,
                    messageLength: content.length,
                });
            } else {
                console.error('No session available for sending message');
            }
        },
        [
            originalSendMessage,
            currentSessionId,
            isWelcomeState,
            isCreatingSession,
            createAutoSession,
            navigate,
            analytics,
            generateTitle,
        ]
    );

    const ensureSessionEventStream = useCallback(
        async (sessionId?: string) => {
            const targetSessionId = sessionId ?? currentSessionIdRef.current ?? undefined;
            if (!targetSessionId) {
                return;
            }

            const reconcileSessionActivity = async (): Promise<boolean | null> => {
                try {
                    const activity = await fetchSessionActivityState(targetSessionId);
                    const restoredActivity = resolveRestoredSessionActivity(activity);
                    useChatStore
                        .getState()
                        .setProcessing(targetSessionId, restoredActivity.processing);

                    if (restoredActivity.status === 'awaiting_approval') {
                        useAgentStore.getState().setAwaitingApproval(targetSessionId);
                    } else if (restoredActivity.status === 'thinking') {
                        useAgentStore.getState().setThinking(targetSessionId);
                    } else if (useAgentStore.getState().isActiveForSession(targetSessionId)) {
                        useAgentStore.getState().setIdle();
                    }

                    return restoredActivity.processing;
                } catch (error) {
                    console.warn('Failed to reconcile session activity state:', error);
                    return null;
                }
            };

            let attemptsRemaining = 1;
            while (true) {
                try {
                    const result = await originalAttachSessionStream(targetSessionId);
                    if (result === 'attached' || result === 'already-attached') {
                        return;
                    }
                } catch (error) {
                    console.warn('Failed to attach to session event stream:', error);
                }

                const shouldKeepTrying = await reconcileSessionActivity();
                if (shouldKeepTrying !== true || attemptsRemaining === 0) {
                    return;
                }

                attemptsRemaining -= 1;
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        },
        [originalAttachSessionStream]
    );

    const reset = useCallback(() => {
        if (currentSessionId) {
            const messageCount = messages.filter((m) => m.sessionId === currentSessionId).length;
            analytics.trackSessionReset({
                sessionId: currentSessionId,
                messageCount,
            });

            originalReset(currentSessionId);
        }
    }, [originalReset, currentSessionId, analytics, messages]);

    const { data: sessionHistoryData } = useQuery({
        queryKey: queryKeys.sessions.history(currentSessionId || ''),
        queryFn: async () => {
            if (!currentSessionId) {
                return { messages: [], isBusy: false };
            }
            try {
                return await fetchSessionHistory(currentSessionId);
            } catch {
                return { messages: [], isBusy: false };
            }
        },
        enabled: false, // Manual refetch only
        retry: false,
    });

    useEffect(() => {
        if (sessionHistoryData && currentSessionId) {
            const currentMessages = useChatStore.getState().getMessages(currentSessionId);
            const hasSessionMsgs = currentMessages.some((m) => m.sessionId === currentSessionId);
            if (!hasSessionMsgs) {
                useChatStore.getState().setMessages(currentSessionId, sessionHistoryData.messages);
            }
            const currentProcessing = useChatStore
                .getState()
                .getSessionState(currentSessionId).processing;
            useChatStore
                .getState()
                .setProcessing(
                    currentSessionId,
                    mergeSessionProcessingState(sessionHistoryData.isBusy, currentProcessing)
                );
            if (sessionHistoryData.isBusy) {
                if (!pendingApprovalsData?.approvals.length) {
                    useAgentStore.getState().setThinking(currentSessionId);
                }
                void ensureSessionEventStream(currentSessionId);
            }
        }
    }, [sessionHistoryData, currentSessionId, pendingApprovalsData, ensureSessionEventStream]);

    const loadSessionHistory = useCallback(
        async (sessionId: string) => {
            try {
                queryClient.removeQueries({ queryKey: queryKeys.sessions.history(sessionId) });

                let result;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        result = await queryClient.fetchQuery({
                            queryKey: queryKeys.sessions.history(sessionId),
                            queryFn: async () => {
                                return await fetchSessionHistory(sessionId);
                            },
                            retry: false,
                        });
                        break;
                    } catch {
                        if (attempt < 2) {
                            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                            queryClient.removeQueries({ queryKey: queryKeys.sessions.history(sessionId) });
                        } else {
                            result = { messages: [], isBusy: false };
                        }
                    }
                }

                if (!result) {
                    result = { messages: [], isBusy: false };
                }

                const currentMessages = useChatStore.getState().getMessages(sessionId);
                const hasSessionMsgs = currentMessages.some((m) => m.sessionId === sessionId);
                if (!hasSessionMsgs) {
                    useChatStore.getState().initFromHistory(sessionId, result.messages);
                }

                const currentProcessing = useChatStore
                    .getState()
                    .getSessionState(sessionId).processing;
                useChatStore
                    .getState()
                    .setProcessing(
                        sessionId,
                        mergeSessionProcessingState(result.isBusy, currentProcessing)
                    );
                if (result.isBusy) {
                    void ensureSessionEventStream(sessionId);
                }
            } catch (error) {
                console.error('Error loading session history:', error);
                useChatStore.getState().clearMessages(sessionId);
            }
        },
        [queryClient, ensureSessionEventStream]
    );

    useEffect(() => {
        sessionAbortControllersRef.current.forEach((controller, sessionId) => {
            if (!currentSessionId || sessionId !== currentSessionId) {
                controller.abort();
                sessionAbortControllersRef.current.delete(sessionId);
            }
        });
    }, [currentSessionId]);

    useEffect(() => {
        const abortControllers = sessionAbortControllersRef.current;
        return () => {
            abortControllers.forEach((controller) => controller.abort());
            abortControllers.clear();
        };
    }, []);

    const switchSession = useCallback(
        async (sessionId: string) => {
            if (
                sessionId === currentSessionId ||
                sessionId === lastSwitchedSessionRef.current ||
                isSwitchingSession
            ) {
                return;
            }

            setIsSwitchingSession(true);
            try {
                try {
                    analytics.trackSessionSwitched({
                        fromSessionId: currentSessionId,
                        toSessionId: sessionId,
                    });
                } catch (analyticsError) {
                    console.error('Failed to track session switch:', analyticsError);
                }

                const skipHistoryLoad = newSessionWithMessageRef.current === sessionId;
                if (skipHistoryLoad) {
                    newSessionWithMessageRef.current = null;
                }

                currentSessionIdRef.current = sessionId;

                useSessionStore.getState().setCurrentSession(sessionId);

                lastSwitchedSessionRef.current = sessionId;

                if (!skipHistoryLoad) {
                    await loadSessionHistory(sessionId);
                }
            } catch (error) {
                console.error('Error switching session:', error);
                throw error; // Re-throw so UI can handle the error
            } finally {
                setIsSwitchingSession(false);
            }
        },
        [currentSessionId, isSwitchingSession, loadSessionHistory, analytics]
    );

    const returnToWelcome = useCallback(() => {
        currentSessionIdRef.current = null;
        lastSwitchedSessionRef.current = null; // Clear to allow switching to same session again

        useSessionStore.getState().returnToWelcome();
    }, []);

    return (
        <ChatContext.Provider
            value={{
                messages,
                sendMessage,
                reset,
                switchSession,
                loadSessionHistory,
                ensureSessionEventStream,
                returnToWelcome,
                cancel,
            }}
        >
            {children}
        </ChatContext.Provider>
    );
}

export function useChatContext(): ChatContextType {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error('useChatContext must be used within a ChatProvider');
    }
    return context;
}
