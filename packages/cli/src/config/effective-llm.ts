/**
 * Effective LLM Configuration Resolution
 *
 * This module provides utilities to determine the effective LLM configuration
 * at runtime, considering the layered config approach.
 *
 * ## Configuration Layers (Priority Order)
 *
 * 1. **agent.local.yml** (highest priority) - Agent-specific user overrides
 *    - Path: `~/.fius/agents/{agent-id}/{agent-id}.local.yml`
 *    - Use case: User wants a specific agent to use a different LLM
 *    - NOT YET IMPLEMENTED - see feature-plans/auto-update.md section 8.9-8.11
 *
 * 2. **preferences.yml** - User's global default LLM
 *    - Path: `~/.fius/preferences.yml`
 *    - Use case: User's default choice from setup wizard or `/models` command
 *    - This is where most users' LLM config comes from
 *
 * 3. **agent.yml** (lowest priority) - Bundled agent defaults
 *    - Path: `~/.fius/agents/{agent-id}/{agent-id}.yml`
 *    - Use case: Fallback for users who skip setup or power users with BYOK
 *    - This file is managed by Fius and replaced on CLI updates
 *
 * ## Usage
 *
 * ```typescript
 * import { getEffectiveLLMConfig } from './config/effective-llm.js';
 *
 * const llm = await getEffectiveLLMConfig();
 * if (llm?.provider === 'anthropic') {
 *   // User is configured to use Anthropic
 * }
 *
 * console.log(`Using ${llm.model} via ${llm.provider} (from ${llm.source})`);
 * ```
 *
 * ## Related Documentation
 *
 * - feature-plans/auto-update.md - Layered config and .local.yml design
 * - feature-plans/holistic-fius-auth-analysis/ - Explicit provider routing
 *
 * @module effective-llm
 */

import type { LLMProvider } from '@fiusdev/llm';
import {
    loadGlobalPreferences,
    globalPreferencesExist,
    loadAgentConfig,
    resolveAgentPath,
} from '@fiusdev/agent-management';
import { logger } from '@fiusdev/core';

/**
 * Source of the effective LLM configuration
 */
export type LLMConfigSource =
    | 'local'
    | 'preferences'
    | 'bundled';

/**
 * The resolved effective LLM configuration with source tracking
 */
export interface EffectiveLLMConfig {
    /** LLM provider (e.g., 'anthropic', 'openai') */
    provider: LLMProvider;
    /** Model identifier (format depends on provider) */
    model: string;
    /** API key or environment variable reference (e.g., '$FIUS_API_KEY') */
    apiKey?: string;
    /** Base URL for custom endpoints */
    baseURL?: string;
    /** Where this config came from */
    source: LLMConfigSource;
}

/**
 * Options for getEffectiveLLMConfig
 */
export interface GetEffectiveLLMConfigOptions {
    /**
     * Agent ID to resolve config for.
     * @default 'coding-agent'
     */
    agentId?: string;

    /**
     * Whether to include the bundled agent config as fallback.
     * Set to false if you only want user-configured LLM.
     * @default true
     */
    includeBundledFallback?: boolean;
}

/**
 * Get the effective LLM configuration considering all config layers.
 *
 * This function resolves which LLM config will actually be used at runtime
 * by checking each layer in priority order:
 *
 * 1. agent.local.yml (NOT YET IMPLEMENTED)
 * 2. preferences.yml
 * 3. bundled agent.yml (if includeBundledFallback is true)
 *
 * @param options - Configuration options
 * @returns The effective LLM config with source, or null if none found
 *
 * @example
 * ```typescript
 * // Get effective LLM for default agent
 * const llm = await getEffectiveLLMConfig();
 *
 * // Get effective LLM for a specific agent
 * const llm = await getEffectiveLLMConfig({ agentId: 'explore-agent' });
 *
 * // Only get user-configured LLM (no bundled fallback)
 * const llm = await getEffectiveLLMConfig({ includeBundledFallback: false });
 * ```
 */
export async function getEffectiveLLMConfig(
    options: GetEffectiveLLMConfigOptions = {}
): Promise<EffectiveLLMConfig | null> {
    const { agentId = 'fius', includeBundledFallback = true } = options;

    if (globalPreferencesExist()) {
        try {
            const preferences = await loadGlobalPreferences();
            if (preferences?.llm?.provider && preferences?.llm?.model) {
                logger.debug('Using LLM config from preferences.yml');
                const result: EffectiveLLMConfig = {
                    provider: preferences.llm.provider,
                    model: preferences.llm.model,
                    source: 'preferences',
                };
                if (preferences.llm.apiKey) {
                    result.apiKey = preferences.llm.apiKey;
                }
                if (preferences.llm.baseURL) {
                    result.baseURL = preferences.llm.baseURL;
                }
                return result;
            }
        } catch (error) {
            logger.debug(
                `Could not load preferences: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    if (includeBundledFallback) {
        try {
            const agentPath = await resolveAgentPath(agentId);
            if (agentPath) {
                const agentConfig = await loadAgentConfig(agentPath);
                if (agentConfig?.llm?.provider && agentConfig?.llm?.model) {
                    logger.debug(`Using LLM config from bundled ${agentId}.yml`);
                    const result: EffectiveLLMConfig = {
                        provider: agentConfig.llm.provider,
                        model: agentConfig.llm.model,
                        source: 'bundled',
                    };
                    if (agentConfig.llm.apiKey) {
                        result.apiKey = agentConfig.llm.apiKey;
                    }
                    if (agentConfig.llm.baseURL) {
                        result.baseURL = agentConfig.llm.baseURL;
                    }
                    return result;
                }
            }
        } catch (error) {
            logger.debug(
                `Could not load agent config: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    return null;
}

/**
 * Check if the effective LLM config uses Fius credits.
 *
 * Convenience function that checks if the user is configured to use
 * the Fius provider (which requires authentication).
 *
 * @param options - Same options as getEffectiveLLMConfig
 * @returns always false (provider removed)
 *
 * @example
 * ```typescript
 * if (await isUsingFiusCredits()) {
 *   // Check authentication, show billing info, etc.
 * }
 * ```
 */
export async function isUsingFiusCredits(
    options: GetEffectiveLLMConfigOptions = {}
): Promise<boolean> {
    return false;
}

export async function canUseFiusProvider(): Promise<boolean> {
    return true;
}
