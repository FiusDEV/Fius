

import React from 'react';
import { Box, Text } from 'ink';
import type { WizardStep } from '../types.js';

interface WizardStepInputProps {
    
    step: WizardStep;
    
    currentInput: string;
    
    error: string | null;
    
    isValidating: boolean;
    
    isSaving: boolean;
    
    additionalContent?: React.ReactNode;
}


export function WizardStepInput({
    step,
    currentInput,
    error,
    isValidating,
    isSaving,
    additionalContent,
}: WizardStepInputProps): React.ReactElement {
    return (
        <>
            {/* Current step prompt */}
            <Box flexDirection="column">
                <Text bold>{step.label}:</Text>
                <Text color="gray">{step.placeholder}</Text>
                {additionalContent}
            </Box>

            {/* Input field */}
            <Box marginTop={1}>
                <Text color="cyan">&gt; </Text>
                <Text>{currentInput}</Text>
                <Text color="cyan">_</Text>
            </Box>

            {/* Error message */}
            {error && (
                <Box marginTop={1}>
                    <Text color="red">{error}</Text>
                </Box>
            )}

            {/* Validating indicator */}
            {isValidating && (
                <Box marginTop={1}>
                    <Text color="yellowBright">Validating model...</Text>
                </Box>
            )}

            {/* Saving indicator */}
            {isSaving && (
                <Box marginTop={1}>
                    <Text color="yellowBright">Saving...</Text>
                </Box>
            )}
        </>
    );
}

export default WizardStepInput;
