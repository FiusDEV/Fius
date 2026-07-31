/**
 * Store Exports
 *
 * Central export point for all Zustand stores.
 * Import stores from here rather than individual files.
 */

export { useChatStore, generateMessageId } from './chatStore.js';
export type { Message, ErrorMessage, SessionChatState } from './chatStore.js';

export { useSessionStore } from './sessionStore.js';
export type { SessionState } from './sessionStore.js';

export { useAgentStore } from './agentStore.js';
export type { AgentStatus, ConnectionStatus, AgentState } from './agentStore.js';

export { useNotificationStore } from './notificationStore.js';
export type { Toast, ToastIntent } from './notificationStore.js';

export { useEventLogStore } from './eventLogStore.js';
export type { ActivityEvent, EventCategory } from './eventLogStore.js';

export { useApprovalStore } from './approvalStore.js';
export type { PendingApproval } from './approvalStore.js';

export { usePreferenceStore } from './preferenceStore.js';
export type { PreferenceState } from './preferenceStore.js';

export { useTodoStore } from './todoStore.js';
export type { Todo, TodoStatus } from './todoStore.js';

export {
    EMPTY_MESSAGES,
    useCurrentSessionId,
    useIsWelcomeState,
    useIsSessionOperationPending,
    useIsReplayingHistory,
    useSessionMessages,
    useStreamingMessage,
    useAllMessages,
    useSessionProcessing,
    useSessionError,
    useSessionLoadingHistory,
    useCurrentToolName,
    useAgentStatus,
    useConnectionStatus,
    useIsAgentBusy,
    useIsAgentConnected,
    useAgentActiveSession,
    useSessionChatState,
    useAgentState,
} from './selectors.js';
