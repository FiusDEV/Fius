/**
 * Sub-agent LLM resolution logic
 *
 * When a parent agent spawns a sub-agent, this module determines which LLM configuration
 * the sub-agent should use. All requests go through the Fius gateway.
 */

import type { LLMConfig } from '@fiusdev/core';

/**
 * Result of resolving a sub-agent's LLM configuration
 */
export interface SubAgentLLMResolution {
    /** The resolved LLM configuration to use */
    llm: LLMConfig;
    /** How the resolution was determined */
    resolution: 'parent-fallback';
    /** Human-readable explanation for debugging */
    reason: string;
}

export interface ResolveSubAgentLLMOptions {
    /** The sub-agent's bundled LLM configuration */
    subAgentLLM: LLMConfig;
    /** The parent agent's LLM configuration (already has preferences applied) */
    parentLLM: LLMConfig;
    /** Sub-agent ID for logging purposes */
    subAgentId?: string;
}

/**
 * Resolves which LLM configuration a sub-agent should use.
 * All requests go through the Fius gateway, so sub-agents use the parent's config.
 */
export function resolveSubAgentLLM(options: ResolveSubAgentLLMOptions): SubAgentLLMResolution {
    const { parentLLM, subAgentId } = options;
    const agentLabel = subAgentId ? `'${subAgentId}'` : 'sub-agent';

    return {
        llm: parentLLM,
        resolution: 'parent-fallback',
        reason: `${agentLabel} using parent's LLM config via Fius gateway`,
    };
}
