import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { Logger } from '../logger/v2/types.js';
import type { SessionManager } from '../session/index.js';
import type { MCPManager } from '../mcp/manager.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { AgentEventBus } from '../events/index.js';
import type { FiusStores } from '../storage/index.js';
import type { HostRuntimeContext } from '../runtime/index.js';

export type ExtensionPoint =
    | 'beforeLLMRequest'
    | 'beforeToolCall'
    | 'afterToolResult'
    | 'beforeResponse';

export interface HookResult {
    ok: boolean;
    modify?: Record<string, unknown>;
    cancel?: boolean;
    message?: string;
    notices?: HookNotice[];
}

export interface HookNotice {
    kind: 'allow' | 'block' | 'warn' | 'info';
    code?: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface HookExecutionContext {
    sessionId?: string | undefined;
    userId?: string | undefined;
    tenantId?: string | undefined;
    hostRuntime?: HostRuntimeContext | undefined;
    llmConfig: ValidatedLLMConfig;
    logger: Logger;
    abortSignal?: AbortSignal | undefined;
    agent: {
        readonly sessionManager: SessionManager;
        readonly mcpManager: MCPManager;
        readonly toolManager: ToolManager;
        readonly stateManager: AgentStateManager;
        readonly agentEventBus: AgentEventBus;
        readonly stores: FiusStores;
    };
}

export interface BeforeLLMRequestPayload {
    text: string;
    imageData?: { image: string; mimeType: string };
    fileData?: { data: string; mimeType: string; filename?: string };
    sessionId?: string;
}

export interface BeforeToolCallPayload {
    toolName: string;
    args: Record<string, unknown>;
    sessionId?: string;
    callId?: string;
}

export interface AfterToolResultPayload {
    toolName: string;
    result: unknown;
    success: boolean;
    sessionId?: string;
    callId?: string;
}

export interface BeforeResponsePayload {
    content: string;
    reasoning?: string;
    provider: string;
    model?: string;
    tokenUsage?: { input: number; output: number };
    sessionId?: string;
}

export type Hook = {
    initialize?(config: Record<string, unknown>): Promise<void>;
    beforeLLMRequest?(
        payload: BeforeLLMRequestPayload,
        context: HookExecutionContext
    ): Promise<HookResult>;
    beforeToolCall?(
        payload: BeforeToolCallPayload,
        context: HookExecutionContext
    ): Promise<HookResult>;
    afterToolResult?(
        payload: AfterToolResultPayload,
        context: HookExecutionContext
    ): Promise<HookResult>;
    beforeResponse?(
        payload: BeforeResponsePayload,
        context: HookExecutionContext
    ): Promise<HookResult>;
    cleanup?(): Promise<void>;
};
