/**
 * Agent Store
 *
 * Manages the agent's status and connection state.
 * This is global state (not per-session) as there's one agent connection.
 */

import { create } from 'zustand';

/**
 * Agent's current activity status
 */
export type AgentStatus =
    | 'idle'
    | 'thinking'
    | 'executing_tool'
    | 'awaiting_approval';

/**
 * Connection status to the backend
 */
export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

/**
 * Agent state
 */
export interface AgentState {
    /**
     * Current agent activity status
     */
    status: AgentStatus;

    /**
     * Connection status to the backend
     */
    connectionStatus: ConnectionStatus;

    /**
     * Timestamp of last heartbeat (for connection health monitoring)
     */
    lastHeartbeat: number | null;

    /**
     * Currently active session for the agent (for status context)
     */
    activeSessionId: string | null;

    /**
     * Name of the tool currently being executed (if any)
     */
    currentToolName: string | null;

    /**
     * Error message if connection failed
     */
    connectionError: string | null;

    /**
     * Number of reconnection attempts
     */
    reconnectAttempts: number;
}

interface AgentStore extends AgentState {
    setStatus: (status: AgentStatus, sessionId?: string) => void;

    setThinking: (sessionId: string) => void;

    setExecutingTool: (sessionId: string, toolName: string) => void;

    setAwaitingApproval: (sessionId: string) => void;

    setIdle: () => void;

    setConnectionStatus: (status: ConnectionStatus) => void;

    setConnected: () => void;

    setDisconnected: (error?: string) => void;

    setReconnecting: () => void;

    updateHeartbeat: () => void;

    incrementReconnectAttempts: () => void;

    resetReconnectAttempts: () => void;

    isBusy: () => boolean;

    isConnected: () => boolean;

    isActiveForSession: (sessionId: string) => boolean;

    getHeartbeatAge: () => number | null;
}

const defaultState: AgentState = {
    status: 'idle',
    connectionStatus: 'disconnected',
    lastHeartbeat: null,
    activeSessionId: null,
    currentToolName: null,
    connectionError: null,
    reconnectAttempts: 0,
};

export const useAgentStore = create<AgentStore>()((set, get) => ({
    ...defaultState,

    setStatus: (status, sessionId) => {
        set({
            status,
            activeSessionId: sessionId ?? (status === 'idle' ? null : get().activeSessionId),
            currentToolName: status === 'executing_tool' ? get().currentToolName : null,
        });
    },

    setThinking: (sessionId) => {
        set({
            status: 'thinking',
            activeSessionId: sessionId,
            currentToolName: null,
        });
    },

    setExecutingTool: (sessionId, toolName) => {
        set({
            status: 'executing_tool',
            activeSessionId: sessionId,
            currentToolName: toolName,
        });
    },

    setAwaitingApproval: (sessionId) => {
        set({
            status: 'awaiting_approval',
            activeSessionId: sessionId,
            currentToolName: null,
        });
    },

    setIdle: () => {
        set({
            status: 'idle',
            activeSessionId: null,
            currentToolName: null,
        });
    },

    setConnectionStatus: (status) => {
        set({ connectionStatus: status });
    },

    setConnected: () => {
        set({
            connectionStatus: 'connected',
            connectionError: null,
            reconnectAttempts: 0,
            lastHeartbeat: Date.now(),
        });
    },

    setDisconnected: (error) => {
        set({
            connectionStatus: 'disconnected',
            connectionError: error ?? null,
        });
    },

    setReconnecting: () => {
        set({
            connectionStatus: 'reconnecting',
        });
    },

    updateHeartbeat: () => {
        set({ lastHeartbeat: Date.now() });
    },

    incrementReconnectAttempts: () => {
        set((state) => ({
            reconnectAttempts: state.reconnectAttempts + 1,
        }));
    },

    resetReconnectAttempts: () => {
        set({ reconnectAttempts: 0 });
    },

    isBusy: () => {
        return get().status !== 'idle';
    },

    isConnected: () => {
        return get().connectionStatus === 'connected';
    },

    isActiveForSession: (sessionId) => {
        const state = get();
        return state.status !== 'idle' && state.activeSessionId === sessionId;
    },

    getHeartbeatAge: () => {
        const { lastHeartbeat } = get();
        if (lastHeartbeat === null) return null;
        return Date.now() - lastHeartbeat;
    },
}));
