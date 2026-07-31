

import { Box, Text } from 'ink';
import { useElapsedTime } from '../hooks/useElapsedTime.js';
import { useTokenCounter } from '../hooks/useTokenCounter.js';
import { useAnimationTick } from '../hooks/useAnimationTick.js';
import { BRAILLE_SPINNER_FRAMES } from '../constants/spinnerFrames.js';
import type { TuiAgentBackend } from '../agent-backend.js';

function StatusSpinner({ enabled, color }: { enabled: boolean; color: string }) {
    const tick = useAnimationTick({ enabled, intervalMs: 80 });
    const frame = BRAILLE_SPINNER_FRAMES[tick % BRAILLE_SPINNER_FRAMES.length];
    return <Text color={color}>{frame}</Text>;
}

interface StatusBarProps {
    agent: TuiAgentBackend;
    isProcessing: boolean;
    isThinking: boolean;
    isCompacting: boolean;
    approvalQueueCount: number;
    copyModeEnabled?: boolean;
    isAwaitingApproval?: boolean;
    todoExpanded?: boolean;
    hasTodos?: boolean;
    autoApproveEdits?: boolean;
    backgroundTasksRunning?: number;
}

export function StatusBar({
    agent,
    isProcessing,
    isThinking,
    isCompacting,
    approvalQueueCount,
    copyModeEnabled = false,
    isAwaitingApproval = false,
    todoExpanded = true,
    hasTodos = false,
    autoApproveEdits = false,
    backgroundTasksRunning = 0,
}: StatusBarProps) {
    const animationsActive = isProcessing && !isAwaitingApproval && !copyModeEnabled;

    const { formatted: elapsedTime, elapsedMs } = useElapsedTime({
        isActive: animationsActive,
        intervalMs: 1000,
    });
    const { formatted: tokenCount } = useTokenCounter({ agent, isActive: animationsActive });
    const showTime = elapsedMs >= 30000;

    if (copyModeEnabled) {
        return (
            <Box paddingX={1} marginBottom={0}>
                <Text color="yellowBright" bold>
                    ☰ Copy Mode - Select text with mouse. Press any key to exit.
                </Text>
            </Box>
        );
    }

    if (!isProcessing) return null;
    if (isAwaitingApproval) return null;

    const spinnerColor = isCompacting ? 'yellow' : 'green';
    const metaParts: string[] = [];
    if (isCompacting) metaParts.push('Compacting…');
    if (showTime) metaParts.push(`(${elapsedTime})`);
    if (tokenCount) metaParts.push(tokenCount);
    if (backgroundTasksRunning > 0) {
        metaParts.push(`${backgroundTasksRunning} bg task${backgroundTasksRunning > 1 ? 's' : ''}`);
    }
    if (hasTodos) {
        metaParts.push(todoExpanded ? 'ctrl+t to hide todos' : 'ctrl+t to show todos');
    }
    if (backgroundTasksRunning > 0) metaParts.push('ctrl+b to view bg tasks');
    const metaContent = metaParts.join(' • ');

    return (
        <Box paddingX={1} marginTop={1} flexDirection="row" alignItems="center">
            <StatusSpinner enabled={true} color={spinnerColor} />
            <Text color="gray"> {metaContent ? metaContent + ' • ' : ''}Esc to cancel</Text>
            {approvalQueueCount > 0 && (
                <Text color="yellowBright"> • {approvalQueueCount} queued</Text>
            )}
        </Box>
    );
}
