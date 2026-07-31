import type { AgentCard } from './schemas.js';
import { AgentCardSchema } from './schemas.js';


const DEFAULT_AGENT_DESCRIPTION =
    'Fius is an AI assistant capable of chat and task delegation, accessible via multiple protocols.';


export interface MinimalAgentCardContext {
    defaultName: string;
    defaultVersion: string;
    defaultBaseUrl: string;
}


export function createAgentCard(
    context: MinimalAgentCardContext,
    overrides?: Partial<AgentCard>
): AgentCard {
    const { defaultName, defaultVersion, defaultBaseUrl } = context;

    const effectiveInput: Record<string, any> = { ...(overrides || {}) };

    effectiveInput.name = overrides?.name ?? defaultName;
    effectiveInput.version = overrides?.version ?? defaultVersion;
    effectiveInput.url = overrides?.url ?? `${defaultBaseUrl}/mcp`;
    effectiveInput.description = overrides?.description ?? DEFAULT_AGENT_DESCRIPTION;

    const capsFromInput = effectiveInput.capabilities;
    effectiveInput.capabilities = {
        ...(capsFromInput ?? {}),
        pushNotifications: capsFromInput?.pushNotifications ?? false,
    };

    if (effectiveInput.skills && effectiveInput.skills.length === 0) {
        effectiveInput.skills = undefined;
    }

    return AgentCardSchema.parse(effectiveInput);
}
