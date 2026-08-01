

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';

interface CustomPluginInstallPromptProps {
    isVisible: boolean;
    onComplete: (pluginName: string) => void;
    onClose: () => void;
}

export interface CustomPluginInstallPromptHandle {
    handleInput: (input: string, key: Key) => boolean;
}

const CustomPluginInstallPrompt = forwardRef<CustomPluginInstallPromptHandle, CustomPluginInstallPromptProps>(
    function CustomPluginInstallPrompt({ isVisible, onComplete, onClose }, ref) {
        const [input, setInput] = useState('');
        const [error, setError] = useState<string | null>(null);
        const [isInstalling, setIsInstalling] = useState(false);

        useEffect(() => {
            if (isVisible) {
                setInput('');
                setError(null);
                setIsInstalling(false);
            }
        }, [isVisible]);

        const handleInstall = useCallback(async () => {
            const sourcePath = input.trim();
            if (!sourcePath) {
                setError('Please enter a plugin path');
                return;
            }

            setError(null);
            setIsInstalling(true);

            try {
                const { installPluginFromPath } = await import('@fiusdev/agent-management');
                const result = await installPluginFromPath(sourcePath, { scope: 'user' });
                onComplete(result.pluginName);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setIsInstalling(false);
            }
        }, [input, onComplete]);

        useImperativeHandle(
            ref,
            () => ({
                handleInput(inputStr: string, key: Key): boolean {
                    if (!isVisible) return false;

                    if (key.escape) {
                        onClose();
                        return true;
                    }
                    if (key.return) {
                        handleInstall();
                        return true;
                    }
                    if (key.backspace || key.delete) {
                        setInput((prev) => prev.slice(0, -1));
                        return true;
                    }
                    if (inputStr && inputStr.length === 1 && inputStr.charCodeAt(0) >= 32) {
                        setInput((prev) => prev + inputStr);
                        return true;
                    }
                    return false;
                },
            }),
            [isVisible, handleInstall, onClose]
        );

        if (!isVisible) return null;

        return (
            <Box flexDirection="column">
                <Box>
                    <Text color="cyan" bold>Install custom plugin</Text>
                </Box>
                <Box marginTop={1}>
                    <Text color="gray">Enter plugin directory path:</Text>
                </Box>
                <Box marginTop={1}>
                    <Text color="white">{'> '}</Text>
                    <Text color={input ? 'white' : 'gray'}>{input || 'path/to/plugin'}</Text>
                    <Text color="gray">{'_'}</Text>
                </Box>
                {error && (
                    <Box marginTop={1}>
                        <Text color="red">✗ {error}</Text>
                    </Box>
                )}
                {isInstalling && (
                    <Box marginTop={1}>
                        <Text color="yellow">Installing...</Text>
                    </Box>
                )}
                <Box marginTop={1}>
                    <Text color="gray">
                        <Text color="white">Enter</Text> install{'  '}
                        <Text color="white">Esc</Text> cancel
                    </Text>
                </Box>
            </Box>
        );
    }
);

export default CustomPluginInstallPrompt;
