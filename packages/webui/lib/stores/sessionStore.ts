/**
 * Session Store
 *
 * Manages the current session state and navigation state.
 * Separate from chatStore which handles per-session message state.
 */

import { create } from 'zustand';

/**
 * Session navigation and UI state
 */
export interface SessionState {
    /**
     * Currently active session ID (null = welcome state)
     */
    currentSessionId: string | null;

    /**
     * Whether we're showing the welcome/landing screen
     */
    isWelcomeState: boolean;

    /**
     * Session is being created (new session in progress)
     */
    isCreatingSession: boolean;

    /**
     * Session switch in progress
     */
    isSwitchingSession: boolean;

    /**
     * History replay in progress (suppress notifications during this)
     */
    isReplayingHistory: boolean;

    /**
     * Loading history for a session
     */
    isLoadingHistory: boolean;
}

interface SessionStore extends SessionState {
    setCurrentSession: (sessionId: string | null) => void;

    setWelcomeState: (isWelcome: boolean) => void;

    setCreatingSession: (isCreating: boolean) => void;

    setSwitchingSession: (isSwitching: boolean) => void;

    setReplayingHistory: (isReplaying: boolean) => void;

    setLoadingHistory: (isLoading: boolean) => void;

    returnToWelcome: () => void;

    beginSessionCreation: () => void;

    completeSessionCreation: (newSessionId: string) => void;

    cancelSessionCreation: () => void;

    isSessionOperationPending: () => boolean;

    shouldSuppressNotifications: () => boolean;
}

const defaultState: SessionState = {
    currentSessionId: null,
    isWelcomeState: true,
    isCreatingSession: false,
    isSwitchingSession: false,
    isReplayingHistory: false,
    isLoadingHistory: false,
};

export const useSessionStore = create<SessionStore>()((set, get) => ({
    ...defaultState,

    setCurrentSession: (sessionId) => {
        set({
            currentSessionId: sessionId,
            isWelcomeState: sessionId === null,
        });
    },

    setWelcomeState: (isWelcome) => {
        set({
            isWelcomeState: isWelcome,
            ...(isWelcome ? { currentSessionId: null } : {}),
        });
    },

    setCreatingSession: (isCreating) => {
        set({ isCreatingSession: isCreating });
    },

    setSwitchingSession: (isSwitching) => {
        set({ isSwitchingSession: isSwitching });
    },

    setReplayingHistory: (isReplaying) => {
        set({ isReplayingHistory: isReplaying });
    },

    setLoadingHistory: (isLoading) => {
        set({ isLoadingHistory: isLoading });
    },

    returnToWelcome: () => {
        set({
            currentSessionId: null,
            isWelcomeState: true,
            isCreatingSession: false,
            isSwitchingSession: false,
            isReplayingHistory: false,
            isLoadingHistory: false,
        });
    },

    beginSessionCreation: () => {
        set({
            isCreatingSession: true,
            isWelcomeState: false,
        });
    },

    completeSessionCreation: (newSessionId) => {
        set({
            currentSessionId: newSessionId,
            isCreatingSession: false,
            isWelcomeState: false,
        });
    },

    cancelSessionCreation: () => {
        set({
            isCreatingSession: false,
            isWelcomeState: get().currentSessionId === null,
        });
    },

    isSessionOperationPending: () => {
        const state = get();
        return state.isCreatingSession || state.isSwitchingSession || state.isLoadingHistory;
    },

    shouldSuppressNotifications: () => {
        const state = get();
        return state.isReplayingHistory || state.isSwitchingSession || state.isLoadingHistory;
    },
}));
