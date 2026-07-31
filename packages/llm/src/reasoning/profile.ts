import type { LLMProvider } from '../types.js';

/**
 * Reasoning profiles.
 * All provider-specific logic has been removed.
 * Models are loaded from the Fius platform API.
 */

export type {
    ReasoningParadigm,
    ReasoningProfile,
    ReasoningVariantOption,
} from './profiles/shared.js';

import { nonCapableProfile, type ReasoningProfile } from './profiles/shared.js';

/**
 * Get reasoning profile for a provider/model combination.
 * Returns empty profile - all provider-specific logic is handled by the gateway.
 */
export function getReasoningProfile(
    _provider: LLMProvider,
    _model: string
): ReasoningProfile {
    return nonCapableProfile();
}

/**
 * Check if a model is reasoning capable.
 */
export function isReasoningCapableModel(
    _provider: LLMProvider,
    _model: string
): boolean {
    return false;
}

/**
 * Check if a model supports a specific reasoning variant.
 */
export function supportsReasoningVariant(
    _profile: ReasoningProfile,
    _variant: string
): boolean {
    return false;
}
