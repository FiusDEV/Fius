/**
 * Agent Runtime Module
 *
 * Provides infrastructure for spawning and managing agents.
 * General-purpose runtime that can be used for:
 * - Dashboard managing multiple independent agents
 * - Agent task delegation (parent spawns sub-agents)
 * - Test harnesses managing multiple agents
 */

export { AgentRuntime } from './AgentRuntime.js';
export type { AgentRuntimeOptions } from './AgentRuntime.js';

export { AgentPool } from './AgentPool.js';

export { createDelegatingApprovalHandler } from './approval-delegation.js';

export type {
    SpawnConfig,
    AgentStatus,
    AgentHandle,
    TaskResult,
    AgentRuntimeConfig,
    AgentFilter,
} from './types.js';

export {
    AgentRuntimeConfigSchema,
    SpawnConfigSchema,
    AgentStatusSchema,
    AgentFilterSchema,
    DEFAULT_MAX_AGENTS,
    DEFAULT_TASK_TIMEOUT,
} from './schemas.js';
export type {
    ValidatedAgentRuntimeConfig,
    ValidatedSpawnConfig,
    ValidatedAgentFilter,
} from './schemas.js';

export { RuntimeError } from './errors.js';
export { RuntimeErrorCode } from './error-codes.js';
