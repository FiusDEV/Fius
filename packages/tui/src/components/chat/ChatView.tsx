

import React from 'react';
import { Box } from 'ink';
import { Header } from './Header.js';
import { MessageList } from './MessageList.js';
import type { Message, StartupInfo } from '../../state/types.js';

interface ChatViewProps {
    messages: Message[];
    modelName: string;
    sessionId?: string | undefined;
    hasActiveSession: boolean;
    startupInfo: StartupInfo;
    buildMode?: 'build' | 'plan';
}


export function ChatView({
    messages,
    modelName,
    sessionId,
    hasActiveSession,
    startupInfo,
    buildMode,
}: ChatViewProps) {
    return (
        <Box flexDirection="column" flexGrow={1}>
            <Header
                modelName={modelName}
                sessionId={sessionId}
                hasActiveSession={hasActiveSession}
                startupInfo={startupInfo}
                buildMode={buildMode}
            />
            <MessageList messages={messages} />
        </Box>
    );
}
