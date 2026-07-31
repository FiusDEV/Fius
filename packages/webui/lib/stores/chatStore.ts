/**
 * Chat Store
 *
 * Manages message state per session using Zustand.
 * Each session has isolated message state to support multi-session scenarios.
 */

import { create } from 'zustand';
import type {
    InternalMessage,
    Issue,
    SanitizedToolResult,
    ToolPresentationSnapshotV1,
} from '@fius/core';
import type { LLMProvider } from '@fius/llm';
import type {
    TextPart,
    ImagePart,
    AudioPart,
    FilePart,
    FileData,
    ResourcePart,
    UIResourcePart,
} from '@/types';

export type UIMessageRole = 'user' | 'assistant' | 'tool';

/**
 * Tool result type for UI messages
 * Broader than SanitizedToolResult to handle legacy formats and edge cases
 */
export type ToolResult =
    | SanitizedToolResult
    | { error: string | Record<string, unknown> }
    | string
    | Record<string, unknown>;

/**
 * Sub-agent progress data for spawn_agent tool calls
 */
export interface SubAgentProgress {
    /** Short task description */
    task: string;
    /** Agent ID (e.g., 'explore-agent') */
    agentId: string;
    /** Number of tools called by the sub-agent */
    toolsCalled: number;
    /** Current tool being executed */
    currentTool: string;
    /** Current tool arguments (optional) */
    currentArgs?: Record<string, unknown>;
}

/**
 * Message in the chat UI
 * Extends core InternalMessage with UI-specific fields
 * Note: Excludes 'system' role as system messages are not displayed in UI
 */
export interface Message extends Omit<InternalMessage, 'content' | 'role'> {
    id: string;
    role: UIMessageRole;
    createdAt: number;
    content:
        | string
        | null
        | Array<TextPart | ImagePart | AudioPart | FilePart | ResourcePart | UIResourcePart>;

    imageData?: { image: string; mimeType: string };
    fileData?: FileData;

    toolName?: string;
    presentationSnapshot?: ToolPresentationSnapshotV1;
    toolArgs?: Record<string, unknown>;
    toolCallId?: string;
    toolResult?: ToolResult;
    toolResultMeta?: SanitizedToolResult['meta'];
    toolResultSuccess?: boolean;
    subAgentProgress?: SubAgentProgress;

    requireApproval?: boolean;
    approvalStatus?: 'pending' | 'approved' | 'rejected';

    tokenUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        totalTokens?: number;
    };
    reasoning?: string;
    model?: string;
    displayName?: string;
    provider?: LLMProvider;

    sessionId?: string;
}

/**
 * Error state for a session
 */
export interface ErrorMessage {
    id: string;
    message: string;
    timestamp: number;
    context?: string;
    recoverable?: boolean;
    sessionId?: string;
    anchorMessageId?: string;
    detailedIssues?: Issue[];
}

/**
 * State for a single session
 */
export interface SessionChatState {
    messages: Message[];
    streamingMessage: Message | null;
    processing: boolean;
    error: ErrorMessage | null;
    loadingHistory: boolean;
}

/**
 * Default state for a new session
 */
const defaultSessionState: SessionChatState = {
    messages: [],
    streamingMessage: null,
    processing: false,
    error: null,
    loadingHistory: false,
};

interface ChatStore {
    sessions: Map<string, SessionChatState>;

    addMessage: (sessionId: string, message: Message) => void;

    updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;

    removeMessage: (sessionId: string, messageId: string) => void;

    clearMessages: (sessionId: string) => void;

    setMessages: (sessionId: string, messages: Message[]) => void;

    initFromHistory: (sessionId: string, messages: Message[]) => void;

    setStreamingMessage: (sessionId: string, message: Message | null) => void;

    /**
     * Append content to the streaming message
     */
    appendToStreamingMessage: (
        sessionId: string,
        content: string,
        chunkType?: 'text' | 'reasoning'
    ) => void;

    /**
     * Finalize streaming message (move to messages array)
     */
    finalizeStreamingMessage: (sessionId: string, updates?: Partial<Message>) => void;

    setProcessing: (sessionId: string, processing: boolean) => void;

    setError: (sessionId: string, error: ErrorMessage | null) => void;

    setLoadingHistory: (sessionId: string, loading: boolean) => void;

    initSession: (sessionId: string) => void;

    removeSession: (sessionId: string) => void;

    getSessionState: (sessionId: string) => SessionChatState;

    getMessages: (sessionId: string) => Message[];

    getMessage: (sessionId: string, messageId: string) => Message | undefined;

    getMessageByToolCallId: (sessionId: string, toolCallId: string) => Message | undefined;
}

/**
 * Get or create session state
 */
function getOrCreateSession(
    sessions: Map<string, SessionChatState>,
    sessionId: string
): SessionChatState {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    return { ...defaultSessionState };
}

/**
 * Generate unique message ID
 */
export function generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const useChatStore = create<ChatStore>()((set, get) => ({
    sessions: new Map(),

    addMessage: (sessionId, message) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                messages: [...sessionState.messages, message],
            });

            return { sessions: newSessions };
        });
    },

    updateMessage: (sessionId, messageId, updates) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = newSessions.get(sessionId);
            if (!sessionState) return state;

            const messageIndex = sessionState.messages.findIndex((m) => m.id === messageId);
            if (messageIndex === -1) return state;

            const newMessages = [...sessionState.messages];
            newMessages[messageIndex] = { ...newMessages[messageIndex], ...updates };

            newSessions.set(sessionId, {
                ...sessionState,
                messages: newMessages,
            });

            return { sessions: newSessions };
        });
    },

    removeMessage: (sessionId, messageId) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = newSessions.get(sessionId);
            if (!sessionState) return state;

            newSessions.set(sessionId, {
                ...sessionState,
                messages: sessionState.messages.filter((m) => m.id !== messageId),
            });

            return { sessions: newSessions };
        });
    },

    clearMessages: (sessionId) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = newSessions.get(sessionId);
            if (!sessionState) return state;

            newSessions.set(sessionId, {
                ...sessionState,
                messages: [],
                streamingMessage: null,
            });

            return { sessions: newSessions };
        });
    },

    setMessages: (sessionId, messages) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                messages,
            });

            return { sessions: newSessions };
        });
    },

    initFromHistory: (sessionId, messages) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                messages,
                processing: false,
                error: null,
                streamingMessage: null,
            });

            return { sessions: newSessions };
        });
    },

    setStreamingMessage: (sessionId, message) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                streamingMessage: message,
            });

            return { sessions: newSessions };
        });
    },

    appendToStreamingMessage: (sessionId, content, chunkType = 'text') => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);
            if (!sessionState.streamingMessage) return state;

            const currentMessage = sessionState.streamingMessage;
            let updatedMessage: Message;

            if (chunkType === 'reasoning') {
                updatedMessage = {
                    ...currentMessage,
                    reasoning: (currentMessage.reasoning || '') + content,
                };
            } else {
                const currentContent =
                    typeof currentMessage.content === 'string' ? currentMessage.content : '';
                updatedMessage = {
                    ...currentMessage,
                    content: currentContent + content,
                };
            }

            newSessions.set(sessionId, {
                ...sessionState,
                streamingMessage: updatedMessage,
            });

            return { sessions: newSessions };
        });
    },

    finalizeStreamingMessage: (sessionId, updates = {}) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);
            if (!sessionState.streamingMessage) return state;

            const finalizedMessage: Message = {
                ...sessionState.streamingMessage,
                ...updates,
            };

            const existingMessages = sessionState.messages ?? [];

            newSessions.set(sessionId, {
                ...sessionState,
                messages: [...existingMessages, finalizedMessage],
                streamingMessage: null,
            });

            return { sessions: newSessions };
        });
    },

    setProcessing: (sessionId, processing) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                processing,
            });

            return { sessions: newSessions };
        });
    },

    setError: (sessionId, error) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                error,
            });

            return { sessions: newSessions };
        });
    },

    setLoadingHistory: (sessionId, loading) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            const sessionState = getOrCreateSession(newSessions, sessionId);

            newSessions.set(sessionId, {
                ...sessionState,
                loadingHistory: loading,
            });

            return { sessions: newSessions };
        });
    },

    initSession: (sessionId) => {
        set((state) => {
            if (state.sessions.has(sessionId)) return state;

            const newSessions = new Map(state.sessions);
            newSessions.set(sessionId, { ...defaultSessionState });

            return { sessions: newSessions };
        });
    },

    removeSession: (sessionId) => {
        set((state) => {
            const newSessions = new Map(state.sessions);
            newSessions.delete(sessionId);
            return { sessions: newSessions };
        });
    },

    getSessionState: (sessionId) => {
        const state = get().sessions.get(sessionId);
        return state ?? { ...defaultSessionState };
    },

    getMessages: (sessionId) => {
        return get().getSessionState(sessionId).messages;
    },

    getMessage: (sessionId, messageId) => {
        return get()
            .getMessages(sessionId)
            .find((m) => m.id === messageId);
    },

    getMessageByToolCallId: (sessionId, toolCallId) => {
        return get()
            .getMessages(sessionId)
            .find((m) => m.toolCallId === toolCallId);
    },
}));
