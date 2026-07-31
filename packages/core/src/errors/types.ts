import type { AgentErrorCode } from '../agent/error-codes.js';
import type { ContextErrorCode } from '../context/error-codes.js';
import type { LLMErrorCode } from '../llm/error-codes.js';
import type { MCPErrorCode } from '../mcp/error-codes.js';
import type { SessionErrorCode } from '../session/error-codes.js';
import type { StorageErrorCode } from '../storage/error-codes.js';
import type { SystemPromptErrorCode } from '../systemPrompt/error-codes.js';
import type { ToolErrorCode } from '../tools/error-codes.js';
import type { ResourceErrorCode } from '../resources/error-codes.js';
import type { PromptErrorCode } from '../prompts/error-codes.js';
import type { ApprovalErrorCode } from '../approval/error-codes.js';
import type { MemoryErrorCode } from '../memory/error-codes.js';
import type { HookErrorCode } from '../hooks/error-codes.js';


export enum ErrorScope {
    LLM = 'llm',
    AGENT = 'agent',
    CONFIG = 'config',
    CONTEXT = 'context',
    SESSION = 'session',
    MCP = 'mcp',
    TOOLS = 'tools',
    STORAGE = 'storage',
    LOGGER = 'logger',
    SYSTEM_PROMPT = 'system_prompt',
    RESOURCE = 'resource',
    PROMPT = 'prompt',
    MEMORY = 'memory',
    HOOK = 'hook',
}


export enum ErrorType {
    USER = 'user',
    PAYMENT_REQUIRED = 'payment_required',
    FORBIDDEN = 'forbidden',
    NOT_FOUND = 'not_found',
    TIMEOUT = 'timeout',
    CONFLICT = 'conflict',
    RATE_LIMIT = 'rate_limit',
    SYSTEM = 'system',
    THIRD_PARTY = 'third_party',
    UNKNOWN = 'unknown',
}

export type ErrorRetryDisposition = 'retryable' | 'non_retryable' | 'unknown';


export type FiusErrorCode =
    | LLMErrorCode
    | AgentErrorCode
    | ContextErrorCode
    | SessionErrorCode
    | MCPErrorCode
    | ToolErrorCode
    | StorageErrorCode
    | SystemPromptErrorCode
    | ResourceErrorCode
    | PromptErrorCode
    | ApprovalErrorCode
    | MemoryErrorCode
    | HookErrorCode;


export type Severity = 'error' | 'warning';


export interface Issue<C = unknown> {
    code: FiusErrorCode | string;
    message: string;
    scope: ErrorScope | string;
    type: ErrorType;
    severity: Severity;
    path?: Array<string | number>;
    context?: C;
}
