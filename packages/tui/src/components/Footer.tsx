

import { useEffect, useState } from 'react';
import path from 'node:path';
import { Box, Text } from 'ink';
import { getModelDisplayName, getReasoningProfile } from '@fius/llm';
import { parseCodexBaseURL, type CodexRateLimitSnapshot } from '@fius/core';
import { getLLMProviderDisplayName } from '../utils/llm-provider-display.js';
import {
    getChatGPTRateLimitHint,
    shouldShowChatGPTRateLimitHint,
} from '../utils/chatgpt-rate-limit.js';
import { supportsContextStats, type TuiAgentBackend } from '../agent-backend.js';

interface FooterProps {
    agent: TuiAgentBackend;
    sessionId: string | null;
    modelName: string;
    cwd?: string;
    branchName?: string;
    autoApproveEdits?: boolean;
    bypassPermissions?: boolean;
    isShellMode?: boolean;
    chatgptRateLimitStatus?: CodexRateLimitSnapshot | null;
}


export function Footer({
    agent,
    sessionId,
    modelName,
    cwd,
    branchName,
    autoApproveEdits,
    bypassPermissions,
    isShellMode,
    chatgptRateLimitStatus,
}: FooterProps) {
    const displayPath = cwd ? path.basename(cwd) || cwd : '';
    const displayModelName = getModelDisplayName(modelName);
    const [contextLeft, setContextLeft] = useState<{
        percentLeft: number;
    } | null>(null);
    const [, setLlmTick] = useState(0);

    // Provider is session-scoped because /model can switch LLM per session.
    const llmConfig = agent.getCurrentLLMConfig();
    const provider = llmConfig?.provider ?? null;
    const providerLabel = provider ? getLLMProviderDisplayName(provider, llmConfig?.baseURL) : null;
    const reasoningProfile =
        provider && llmConfig?.model ? getReasoningProfile(provider, llmConfig.model) : null;
    const reasoningVariant =
        llmConfig?.reasoning?.variant ?? reasoningProfile?.defaultVariant ?? undefined;
    const showReasoningVariant =
        reasoningProfile?.capable === true && typeof reasoningVariant === 'string';
    const isChatGPTLogin =
        provider === 'openai-compatible' &&
        parseCodexBaseURL(llmConfig?.baseURL)?.authMode === 'chatgpt';
    const showChatGPTRateLimitHint =
        isChatGPTLogin && shouldShowChatGPTRateLimitHint(chatgptRateLimitStatus);
    const chatGPTRateLimitHint =
        showChatGPTRateLimitHint && chatgptRateLimitStatus
            ? getChatGPTRateLimitHint(chatgptRateLimitStatus)
            : null;
    const chatGPTRateLimitColor = chatgptRateLimitStatus?.exceeded
        ? 'redBright'
        : (chatgptRateLimitStatus?.usedPercent ?? 0) >= 90
          ? 'yellowBright'
          : 'yellow';

    useEffect(() => {
        if (!supportsContextStats(agent)) {
            setContextLeft(null);
            return;
        }

        if (!sessionId) {
            setContextLeft(null);
            return;
        }

        let cancelled = false;
        let refreshId = 0;

        const refreshContext = async () => {
            const requestId = ++refreshId;
            try {
                const stats = await agent.getContextStats(sessionId);
                if (cancelled || requestId !== refreshId) return;
                const percentLeft = Math.max(0, Math.min(100, 100 - stats.usagePercent));
                setContextLeft({
                    percentLeft,
                });
            } catch {
                if (!cancelled) {
                    setContextLeft(null);
                }
            }
        };

        refreshContext();

        const controller = new AbortController();
        const { signal } = controller;
        const sessionEvents = [
            'llm:response',
            'llm:switched',
            'context:compacted',
            'context:pruned',
            'context:cleared',
            'message:dequeued',
            'session:reset',
        ] as const;

        const handleEvent = (payload: { sessionId?: string }) => {
            // Most session events include sessionId.
            if (payload.sessionId && payload.sessionId !== sessionId) return;
            refreshContext();
        };

        const handleLlmSwitched = (payload: { sessionIds?: string[] }) => {
            // llm:switched includes sessionIds[].
            if (payload.sessionIds && !payload.sessionIds.includes(sessionId)) return;
            refreshContext();
            // Force a re-render so the footer always reflects current LLM config
            // (e.g. reasoning variant toggled via Tab).
            setLlmTick((prev) => prev + 1);
        };

        for (const eventName of sessionEvents) {
            if (eventName === 'llm:switched') {
                agent.on(eventName, handleLlmSwitched, { signal });
            } else {
                agent.on(eventName, handleEvent, { signal });
            }
        }

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [agent, sessionId]);

    // Shell mode changes the path color to yellow as indicator
    const pathColor = isShellMode ? 'yellow' : 'blue';

    return (
        <Box flexDirection="column" paddingX={1}>
            {chatGPTRateLimitHint && (
                <Box>
                    <Text color={chatGPTRateLimitColor}>{chatGPTRateLimitHint}</Text>
                </Box>
            )}
        </Box>
    );
}
