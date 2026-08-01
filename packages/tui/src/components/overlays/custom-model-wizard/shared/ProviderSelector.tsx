

import React from 'react';
import { Box, Text } from 'ink';
import type { CustomModelProvider } from '@fiusdev/agent-management';
import { getProviderLabel, getAvailableProviders } from '../provider-config.js';

interface ProviderSelectorProps {
    
    selectedIndex: number;
    
    isEditing: boolean;
}


export function ProviderSelector({
    selectedIndex,
    isEditing,
}: ProviderSelectorProps): React.ReactElement {
    const providers = getAvailableProviders();

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="green"
            paddingX={1}
            marginTop={1}
        >
            <Box marginBottom={1}>
                <Text bold color="green">
                    {isEditing ? 'Edit Custom Model' : 'Add Custom Model'}
                </Text>
            </Box>

            <Text bold>Select Provider:</Text>

            <Box flexDirection="column" marginTop={1}>
                {providers.map((provider, index) => (
                    <Box key={provider}>
                        <Text
                            color={index === selectedIndex ? 'cyan' : 'gray'}
                            bold={index === selectedIndex}
                        >
                            {index === selectedIndex ? '❯ ' : '  '}
                            {getProviderLabel(provider)}
                        </Text>
                    </Box>
                ))}
            </Box>

            <Box marginTop={1}>
                <Text color="gray">↑↓ navigate • Enter select • Esc cancel</Text>
            </Box>
        </Box>
    );
}

export default ProviderSelector;
