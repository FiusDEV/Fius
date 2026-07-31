import type { LLMProvider, LLMPricingStatus, ReasoningVariant, TokenUsage } from '@fius/llm';
import type { TokenUsageCostBreakdown } from '@fius/llm';
import type { AgentRuntimeSettings } from '../agent/runtime-config.js';
import type { ApprovalRequest, ApprovalResponse } from '../approval/types.js';
import type { SanitizedToolResult } from '../context/types.js';
import type { CodexRateLimitSnapshot } from '../llm/providers/codex-app-server.js';
import type { WorkspaceContext } from '../workspace/types.js';
import type { ToolPresentationSnapshotV1 } from '../tools/types.js';
import type { ToolCallMetadata } from '../tools/tool-call-metadata.js';
import type { HostRuntimeContext } from '../runtime/index.js';
import type { LLMProviderErrorDetails } from '../llm/executor/provider-error.js';


export type LLMFinishReason =
    | 'stop'
    | 'tool-calls'
    | 'length'
    | 'content-filter'
    | 'error'
    | 'other'
    | 'unknown'
    | 'cancelled'
    | 'max-steps';


export const AGENT_EVENT_NAMES = [
    'session:reset',
    'session:created',
    'session:title-updated',
    'session:override-set',
    'session:override-cleared',
    'workspace:changed',
    'mcp:server-connected',
    'mcp:server-added',
    'mcp:server-removed',
    'mcp:server-restarted',
    'mcp:server-updated',
    'mcp:resource-updated',
    'mcp:prompts-list-changed',
    'mcp:tools-list-changed',
    'tools:available-updated',
    'llm:switched',
    'state:changed',
    'state:exported',
    'state:reset',
    'resource:cache-invalidated',
    'approval:request',
    'approval:response',
    'run:invoke',
    'agent:stopped',
    'tool:background',
    'tool:background-completed',
] as const;

export const FORWARDED_SESSION_EVENT_NAMES = [
    'llm:thinking',
    'llm:chunk',
    'llm:response',
    'interaction:blocked',
    'llm:rate-limit-status',
    'llm:tool-call',
    'llm:tool-call-partial',
    'llm:tool-result',
    'llm:retrying',
    'llm:error',
    'llm:unsupported-input',
    'tool:running',
    'context:compacting',
    'context:compacted',
    'context:pruned',
    'message:queued',
    'message:dequeued',
    'message:removed',
    'run:complete',
] as const;

export const SESSION_ONLY_EVENT_NAMES = ['llm:switched'] as const;


export const SESSION_EVENT_NAMES = [
    ...FORWARDED_SESSION_EVENT_NAMES,
    ...SESSION_ONLY_EVENT_NAMES,
] as const;


export const EVENT_NAMES = [...AGENT_EVENT_NAMES, ...SESSION_EVENT_NAMES] as const;




export const STREAMING_EVENTS = [
    'llm:thinking',
    'llm:chunk',
    'llm:response',
    'interaction:blocked',
    'llm:tool-call',
    'llm:tool-call-partial',
    'llm:tool-result',
    'llm:retrying',
    'llm:error',
    'llm:unsupported-input',
    'tool:running',
    'context:compacting',
    'context:compacted',
    'context:pruned',
    'message:queued',
    'message:dequeued',
    'run:complete',
    'session:title-updated',
    'approval:request',
    'approval:response',
    'service:event',
] as const;


export const INTEGRATION_EVENTS = [
    ...STREAMING_EVENTS,
    'session:created',
    'session:reset',
    'mcp:server-connected',
    'mcp:server-restarted',
    'mcp:tools-list-changed',
    'mcp:prompts-list-changed',
    'tools:available-updated',
    'llm:switched',
    'state:changed',
] as const;



export type StreamingEventName = (typeof STREAMING_EVENTS)[number];
export type IntegrationEventName = (typeof INTEGRATION_EVENTS)[number];
export type InternalEventName = Exclude<AgentEventName, IntegrationEventName>;


export type AgentEventByName<T extends AgentEventName> = {
    name: T;
} & AgentEventMap[T];


export type StreamingEvent = {
    [K in StreamingEventName]: { name: K } & AgentEventMap[K];
}[StreamingEventName];


export type IntegrationEvent =
    | StreamingEvent
    | ({ name: 'session:created' } & AgentEventMap['session:created'])
    | ({ name: 'session:reset' } & AgentEventMap['session:reset'])
    | ({ name: 'mcp:server-connected' } & AgentEventMap['mcp:server-connected'])
    | ({ name: 'mcp:server-restarted' } & AgentEventMap['mcp:server-restarted'])
    | ({ name: 'mcp:tools-list-changed' } & AgentEventMap['mcp:tools-list-changed'])
    | ({ name: 'mcp:prompts-list-changed' } & AgentEventMap['mcp:prompts-list-changed'])
    | ({ name: 'tools:available-updated' } & AgentEventMap['tools:available-updated'])
    | ({ name: 'llm:switched' } & AgentEventMap['llm:switched'])
    | ({ name: 'state:changed' } & AgentEventMap['state:changed']);


export type HostRuntimeEventContext = {
    hostRuntime?: HostRuntimeContext | undefined;
};

export type EventArgs<TEvent> = [TEvent] extends [void] ? [] : [TEvent];
export type EventListener<TEvent> = (...args: EventArgs<TEvent>) => void;

type WithHostRuntime<TEventMap extends object> = {
    [K in keyof TEventMap]: TEventMap[K] extends void
        ? void
        : TEventMap[K] extends infer TEvent
          ? TEvent extends object
              ? TEvent & HostRuntimeEventContext
              : TEvent
          : never;
};

interface AgentOwnEventMapBase {
    
    'session:reset': {
        sessionId: string;
    };

    
    'session:created': {
        sessionId: string | null;
        switchTo: boolean;
    };

    
    'session:title-updated': {
        sessionId: string;
        title: string;
    };

    
    'session:override-set': {
        sessionId: string;
        override: any;
    };

    
    'session:override-cleared': {
        sessionId: string;
    };

    
    'workspace:changed': {
        workspace: WorkspaceContext | null;
    };

    'mcp:server-connected': {
        name: string;
        success: boolean;
        error?: string;
    };

    
    'mcp:server-added': {
        serverName: string;
        config: any;
    };

    
    'mcp:server-removed': {
        serverName: string;
    };

    
    'mcp:server-restarted': {
        serverName: string;
    };

    
    'mcp:server-updated': {
        serverName: string;
        config: any;
    };

    
    'mcp:resource-updated': {
        serverName: string;
        resourceUri: string;
    };

    
    'mcp:prompts-list-changed': {
        serverName: string;
        prompts: string[];
    };

    
    'mcp:tools-list-changed': {
        serverName: string;
        tools: string[];
    };

    'tools:available-updated': {
        tools: string[];
        source: 'mcp' | 'builtin';
    };

    
    'tools:enabled-updated': {
        scope: 'global' | 'session';
        sessionId?: string;
        disabledTools: string[];
    };

    
    'run:invoke': {
        
        sessionId: string;
        
        content: import('../context/types.js').ContentPart[];
        
        source: 'scheduler' | 'a2a' | 'api' | 'external';
        
        metadata?: Record<string, unknown>;
    };

    
    'llm:switched': {
        newConfig: any;
        historyRetained?: boolean;
        sessionIds: string[];
    };

    
    'context:cleared': {
        sessionId: string;
    };

    
    'state:changed': {
        field: string;
        oldValue: any;
        newValue: any;
        sessionId?: string;
    };

    
    'state:exported': {
        config: AgentRuntimeSettings;
    };

    
    'state:reset': {
        toConfig: any;
    };

    'resource:cache-invalidated': {
        resourceUri?: string;
        serverName: string;
        action: 'updated' | 'server_connected' | 'server_removed' | 'blob_stored';
    };

    'approval:request': ApprovalRequest;

    
    'approval:response': ApprovalResponse;

    
    'service:event': {
        
        service: string;
        
        event: string;
        
        toolCallId?: string;
        
        sessionId: string;
        
        data: Record<string, unknown>;
    };

    
    'tool:background': {
        toolName: string;
        toolCallId: string;
        sessionId: string;
        description?: string;
        promise: Promise<unknown>;
        timeoutMs?: number;
        notifyOnComplete?: boolean;
    };

    
    'tool:background-completed': {
        toolCallId: string;
        sessionId: string;
    };

    
    'agent:stopped': void;
}

export type ToolBackgroundEvent = AgentEventMap['tool:background'];


interface SessionEventMapBase {
    
    'llm:thinking': {};

    
    'llm:chunk': {
        chunkType: 'text' | 'reasoning';
        content: string;
        isComplete?: boolean;
    };

    
    'llm:response': {
        content: string;
        reasoning?: string;
        provider: LLMProvider;
        model: string;
        displayName?: string;
        
        reasoningVariant?: ReasoningVariant;
        
        reasoningBudgetTokens?: number;
        tokenUsage: TokenUsage;
        
        messageId?: string;
        
        usageScopeId?: string;
        
        estimatedCost?: number;
        
        costBreakdown?: TokenUsageCostBreakdown;
        
        pricingStatus?: LLMPricingStatus;
        
        estimatedInputTokens?: number;
        
        finishReason: LLMFinishReason;
    };

    
    'interaction:blocked': {
        content: string;
        provider: LLMProvider;
        model: string;
        displayName?: string;
        
        messageId: string;
    };

    
    'llm:rate-limit-status': {
        provider?: LLMProvider;
        model?: string;
        snapshot: CodexRateLimitSnapshot;
    };

    
    'llm:tool-call': {
        toolName: string;
        
        presentationSnapshot?: ToolPresentationSnapshotV1;
        args: Record<string, any>;
        
        meta?: ToolCallMetadata;
        
        callDescription?: string;
        callId: string;
    };

    
    'llm:tool-call-partial': {
        toolName: string;
        args: Record<string, any>;
        
        callDescription?: string;
        callId: string;
        isComplete?: boolean;
    };

    
    'llm:tool-result': {
        toolName: string;
        
        presentationSnapshot?: ToolPresentationSnapshotV1;
        
        meta?: ToolCallMetadata;
        callId: string;
        success: boolean;
        
        sanitized?: SanitizedToolResult;
        rawResult?: unknown;
        
        error?: string;
        
        requireApproval?: boolean;
        
        approvalStatus?: 'approved' | 'rejected';
    };

    
    'tool:running': {
        toolName: string;
        toolCallId: string;
    };

    
    'llm:error': {
        error: Error;
        context?: string;
        recoverable?: boolean;
        
        details?: LLMProviderErrorDetails;
        
        toolCallId?: string;
    };

    
    'llm:retrying': {
        error: Error;
        context: string;
        attempt: number;
        maxRetries: number;
        provider: LLMProvider;
        model: string;
    };

    
    'llm:switched': {
        newConfig: any;
        historyRetained?: boolean;
    };

    
    'llm:unsupported-input': {
        errors: string[];
        provider: LLMProvider;
        model?: string;
        fileType?: string;
        details?: any;
    };

    
    'context:compacting': {
        
        estimatedTokens: number;
    };

    
    'context:compacted': {
        
        originalTokens: number;
        
        compactedTokens: number;
        originalMessages: number;
        compactedMessages: number;
        strategy: string;
        reason: 'overflow' | 'manual';
    };

    
    'context:pruned': {
        prunedCount: number;
        savedTokens: number;
    };

    
    'message:queued': {
        position: number;
        id: string;
        queue: 'steer' | 'follow-up';
    };

    
    'message:dequeued': {
        count: number;
        ids: string[];
        queue: 'steer' | 'follow-up';
        coalesced: boolean;
        
        content: import('../context/types.js').ContentPart[];
        
        messages: import('../session/types.js').QueuedMessage[];
    };

    
    'message:removed': {
        id: string;
        queue: 'steer' | 'follow-up';
    };

    
    'run:complete': {
        
        finishReason: LLMFinishReason;
        
        stepCount: number;
        
        durationMs: number;
        
        error?: Error;
    };
}

export type ForwardedSessionEventName = (typeof FORWARDED_SESSION_EVENT_NAMES)[number];

type ForwardedSessionEventMapBase = {
    [K in ForwardedSessionEventName]: SessionEventMapBase[K] extends void
        ? { sessionId: string }
        : SessionEventMapBase[K] & { sessionId: string };
};

type AgentEventMapBase = AgentOwnEventMapBase & ForwardedSessionEventMapBase;

export type AgentEventMap = WithHostRuntime<AgentEventMapBase>;
export type SessionEventMap = WithHostRuntime<SessionEventMapBase>;

export type AgentEventName = keyof AgentEventMap;
export type SessionEventName = keyof SessionEventMap;
export type EventName = keyof AgentEventMap;


type _AgentEventNamesInMap = (typeof AGENT_EVENT_NAMES)[number] extends keyof AgentEventMap
    ? true
    : never;
type _SessionEventNamesInMap = (typeof SESSION_EVENT_NAMES)[number] extends SessionEventName
    ? true
    : never;
type _EventNamesInMap = (typeof EVENT_NAMES)[number] extends EventName ? true : never;

const _checkAgentEventNames: _AgentEventNamesInMap = true;
const _checkSessionEventNames: _SessionEventNamesInMap = true;
const _checkEventNames: _EventNamesInMap = true;

void _checkAgentEventNames;
void _checkSessionEventNames;
void _checkEventNames;


export const AgentEventNames: readonly AgentEventName[] = Object.freeze([...AGENT_EVENT_NAMES]);
export const SessionEventNames: readonly SessionEventName[] = Object.freeze([
    ...SESSION_EVENT_NAMES,
]);
export const EventNames: readonly EventName[] = Object.freeze([...EVENT_NAMES]);


export class BaseTypedEventEmitter<TEventMap extends Record<string, any>> {
    private _listeners: Partial<{
        [K in keyof TEventMap]: Set<EventListener<TEventMap[K]>>;
    }> = {};
    private _abortListeners = new WeakMap<AbortSignal, Set<() => void>>();

    private getOrCreateListeners<K extends keyof TEventMap>(
        event: K
    ): Set<EventListener<TEventMap[K]>> {
        let listeners = this._listeners[event];
        if (listeners === undefined) {
            listeners = new Set<EventListener<TEventMap[K]>>();
            this._listeners[event] = listeners;
        }
        return listeners;
    }

    private registerAbortCleanup(signal: AbortSignal, cleanup: () => void): void {
        let cleanups = this._abortListeners.get(signal);
        if (cleanups === undefined) {
            cleanups = new Set();
            this._abortListeners.set(signal, cleanups);
        }
        cleanups.add(cleanup);
        signal.addEventListener('abort', cleanup, { once: true });
    }

    private unregisterAbortCleanup(signal: AbortSignal, cleanup: () => void): void {
        const cleanups = this._abortListeners.get(signal);
        if (cleanups === undefined) {
            return;
        }

        cleanups.delete(cleanup);
        signal.removeEventListener('abort', cleanup);
        if (cleanups.size === 0) {
            this._abortListeners.delete(signal);
        }
    }

    
    emit<K extends keyof TEventMap>(event: K, ...args: EventArgs<TEventMap[K]>): boolean {
        const listeners = this._listeners[event];
        if (listeners === undefined || listeners.size === 0) {
            return false;
        }

        for (const listener of [...listeners]) {
            listener(...args);
        }

        return true;
    }

    
    on<K extends keyof TEventMap>(
        event: K,
        listener: EventListener<TEventMap[K]>,
        options?: { signal?: AbortSignal }
    ): this {
        if (options?.signal?.aborted) {
            return this;
        }

        const listeners = this.getOrCreateListeners(event);
        listeners.add(listener);

        if (options?.signal) {
            const signal = options.signal;
            const cleanup = () => {
                this.off(event, listener);
                this.unregisterAbortCleanup(signal, cleanup);
            };

            this.registerAbortCleanup(signal, cleanup);
        }

        return this;
    }

    
    once<K extends keyof TEventMap>(
        event: K,
        listener: EventListener<TEventMap[K]>,
        options?: { signal?: AbortSignal }
    ): this {
        if (options?.signal?.aborted) {
            return this;
        }

        let cleanupAbortListener: (() => void) | undefined;
        const onceWrapper: EventListener<TEventMap[K]> = (...args) => {
            this.off(event, onceWrapper);
            if (cleanupAbortListener !== undefined && options?.signal) {
                this.unregisterAbortCleanup(options.signal, cleanupAbortListener);
                cleanupAbortListener = undefined;
            }
            listener(...args);
        };

        this.getOrCreateListeners(event).add(onceWrapper);

        if (options?.signal) {
            const signal = options.signal;
            const abortCleanup = () => {
                this.off(event, onceWrapper);
                this.unregisterAbortCleanup(signal, abortCleanup);
            };
            cleanupAbortListener = abortCleanup;

            this.registerAbortCleanup(signal, abortCleanup);
        }

        return this;
    }

    
    off<K extends keyof TEventMap>(event: K, listener: EventListener<TEventMap[K]>): this {
        const listeners = this._listeners[event];
        if (listeners === undefined) {
            return this;
        }

        listeners.delete(listener);
        if (listeners.size === 0) {
            delete this._listeners[event];
        }
        return this;
    }

    
    setMaxListeners(count: number): this {
        void count;
        return this;
    }
}


export class AgentEventBus extends BaseTypedEventEmitter<AgentEventMap> {}


export class SessionEventBus extends BaseTypedEventEmitter<SessionEventMap> {}


export class TypedEventEmitter extends AgentEventBus {}


export const eventBus = new TypedEventEmitter().setMaxListeners(200);

function withForwardedSessionContext<TPayload extends HostRuntimeEventContext>(
    payload: TPayload,
    sessionId: string,
    hostRuntime?: HostRuntimeContext
): TPayload & { sessionId: string } {
    if (payload.hostRuntime !== undefined || hostRuntime === undefined) {
        return {
            ...payload,
            sessionId,
        };
    }

    return {
        ...payload,
        sessionId,
        hostRuntime,
    };
}

type ForwardSessionEventsOptions = {
    sessionEventBus: SessionEventBus;
    agentEventBus: AgentEventBus;
    sessionId: string;
    hostRuntime?: HostRuntimeContext;
};

export function forwardSessionEventsToAgentBus({
    sessionEventBus,
    agentEventBus,
    sessionId,
    hostRuntime,
}: ForwardSessionEventsOptions): () => void {
    const cleanups: Array<() => void> = [];

    const on = <K extends ForwardedSessionEventName>(
        event: K,
        listener: EventListener<SessionEventMap[K]>
    ) => {
        sessionEventBus.on(event, listener);
        cleanups.push(() => {
            sessionEventBus.off(event, listener);
        });
    };

    on('llm:thinking', (payload) => {
        agentEventBus.emit(
            'llm:thinking',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('llm:chunk', (payload) => {
        agentEventBus.emit(
            'llm:chunk',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('llm:response', (payload) => {
        agentEventBus.emit(
            'llm:response',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('interaction:blocked', (payload) => {
        agentEventBus.emit(
            'interaction:blocked',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('llm:rate-limit-status', (payload) => {
        agentEventBus.emit(
            'llm:rate-limit-status',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('llm:tool-call', (payload) => {
        agentEventBus.emit(
            'llm:tool-call',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('llm:tool-call-partial', (payload) => {
        agentEventBus.emit(
            'llm:tool-call-partial',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('llm:tool-result', (payload) => {
        agentEventBus.emit(
            'llm:tool-result',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('llm:retrying', (payload) => {
        agentEventBus.emit(
            'llm:retrying',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('llm:error', (payload) => {
        agentEventBus.emit(
            'llm:error',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('llm:unsupported-input', (payload) => {
        agentEventBus.emit(
            'llm:unsupported-input',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('tool:running', (payload) => {
        agentEventBus.emit(
            'tool:running',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('context:compacting', (payload) => {
        agentEventBus.emit(
            'context:compacting',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('context:compacted', (payload) => {
        agentEventBus.emit(
            'context:compacted',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('context:pruned', (payload) => {
        agentEventBus.emit(
            'context:pruned',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('message:queued', (payload) => {
        agentEventBus.emit(
            'message:queued',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('message:dequeued', (payload) => {
        agentEventBus.emit(
            'message:dequeued',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('message:removed', (payload) => {
        agentEventBus.emit(
            'message:removed',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });
    on('run:complete', (payload) => {
        agentEventBus.emit(
            'run:complete',
            withForwardedSessionContext(payload, sessionId, hostRuntime)
        );
    });

    return () => {
        for (const cleanup of cleanups) {
            cleanup();
        }
    };
}
