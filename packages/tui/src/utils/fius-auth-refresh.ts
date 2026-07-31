import type { TuiAgentBackend } from '../agent-backend.js';

const FIUS_API_KEY_ENV_REF = '$FIUS_API_KEY';

function buildFiusRefreshUpdate(model: string) {
    return {
        provider: 'fius' as const,
        model,
        apiKey: FIUS_API_KEY_ENV_REF,
    };
}

export async function refreshFiusAuthAfterLogin(
    agent: Pick<TuiAgentBackend, 'getCurrentLLMConfig' | 'hasSessionLLMOverride' | 'switchLLM'>,
    sessionId?: string
): Promise<boolean> {
    let refreshed = false;

    const globalConfig = agent.getCurrentLLMConfig();
    if (globalConfig.provider === 'fius') {
        await agent.switchLLM(buildFiusRefreshUpdate(globalConfig.model));
        refreshed = true;
    }

    if (!sessionId) {
        return refreshed;
    }

    if (!agent.hasSessionLLMOverride(sessionId)) {
        return refreshed;
    }

    const sessionConfig = agent.getCurrentLLMConfig(sessionId);
    if (sessionConfig.provider !== 'fius') {
        return refreshed;
    }

    await agent.switchLLM(buildFiusRefreshUpdate(sessionConfig.model), sessionId);
    return true;
}
