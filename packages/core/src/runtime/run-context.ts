import {
    normalizeHostRuntimeContext,
    type HostRuntimeContext,
} from './host-runtime.js';

export interface AgentRunContext {
    sessionId: string;
    hostRuntime?: HostRuntimeContext | undefined;
}

export function createAgentRunContext(options: {
    sessionId: string;
    hostRuntime?: HostRuntimeContext | undefined;
}): AgentRunContext {
    const hostRuntime = normalizeHostRuntimeContext(options.hostRuntime);

    return Object.freeze({
        sessionId: options.sessionId,
        ...(hostRuntime !== undefined ? { hostRuntime } : {}),
    });
}
