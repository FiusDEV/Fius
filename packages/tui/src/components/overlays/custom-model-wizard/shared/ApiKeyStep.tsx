

import React from 'react';
import { Box, Text } from 'ink';
import { getProviderKeyStatus } from '@fiusdev/agent-management';
import type { LLMProvider } from '@fiusdev/llm';
import type { CustomModelProvider } from '@fiusdev/agent-management';

interface ApiKeyStepProps {
    
    provider: CustomModelProvider;
}


export function ApiKeyStep({ provider }: ApiKeyStepProps): React.ReactElement {
    const keyStatus = getProviderKeyStatus(provider as LLMProvider);

    if (keyStatus.hasApiKey) {
        return <Text color="green">✓ {keyStatus.envVar} already set, press Enter to skip</Text>;
    }

    return <Text color="yellowBright">No {keyStatus.envVar} configured</Text>;
}


export function getProviderEnvVar(provider: CustomModelProvider): string {
    const keyStatus = getProviderKeyStatus(provider as LLMProvider);
    return keyStatus.envVar;
}


export function hasApiKeyConfigured(provider: CustomModelProvider): boolean {
    const keyStatus = getProviderKeyStatus(provider as LLMProvider);
    return keyStatus.hasApiKey;
}

export default ApiKeyStep;
