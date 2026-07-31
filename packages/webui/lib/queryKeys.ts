/**
 * Centralized query key factory for TanStack Query
 *
 * Benefits:
 * - Single source of truth for all query keys
 * - TypeScript autocomplete support
 * - Hierarchical invalidation (e.g., invalidate all agent queries)
 * - Prevents typos and inconsistencies
 *
 * Usage:
 * - useQuery({ queryKey: queryKeys.agents.all, ... })
 * - queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
 */

import type { ServerRegistryFilter } from '@fius/registry';

export const queryKeys = {
    agents: {
        all: ['agents'] as const,
        path: ['agentPath'] as const,
    },

    agent: {
        config: ['agent', 'config'] as const,
    },

    llm: {
        current: (sessionId: string | null | undefined) =>
            ['llm', 'current', sessionId ?? null] as const,
        catalog: ['llm', 'catalog'] as const,
        customModels: ['llm', 'customModels'] as const,
        modelPickerState: ['llm', 'modelPickerState'] as const,
    },

    sessions: {
        all: ['sessions'] as const,
        detail: (sessionId: string) => ['sessions', 'detail', sessionId] as const,
        history: (sessionId: string) => ['sessions', 'history', sessionId] as const,
    },

    search: {
        messages: (query: string, sessionId?: string, limit?: number) =>
            ['search', 'messages', query, sessionId, limit] as const,
        sessions: (query: string) => ['search', 'sessions', query] as const,
    },

    greeting: (sessionId: string | null | undefined) =>
        ['greeting', sessionId ?? 'default'] as const,

    memories: {
        all: ['memories'] as const,
    },

    resources: {
        all: ['resources'] as const,
    },

    serverRegistry: (filter: ServerRegistryFilter) => ['serverRegistry', filter] as const,

    prompts: {
        all: ['prompts'] as const,
    },

    servers: {
        all: ['servers'] as const,
        detail: (serverId: string) => ['servers', 'detail', serverId] as const,
        tools: (serverId: string) => ['servers', 'tools', serverId] as const,
    },

    tools: {
        all: ['tools'] as const,
    },

    followUp: {
        list: (sessionId: string) => ['follow-up', sessionId] as const,
    },

    approvals: {
        pending: (sessionId: string) => ['approvals', 'pending', sessionId] as const,
    },

    discovery: {
        all: ['discovery'] as const,
    },

    models: {
        local: ['models', 'local'] as const,
        ollama: (baseURL?: string) => ['models', 'ollama', baseURL ?? 'default'] as const,
        validateLocal: ['models', 'validateLocal'] as const,
    },

    fiusAuth: {
        status: ['fiusAuth', 'status'] as const,
    },
} as const;
