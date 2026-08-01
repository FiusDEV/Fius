

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { SessionMetadata } from '@fiusdev/core';
import { logger } from '@fiusdev/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import type { TuiAgentBackend } from '../../agent-backend.js';

interface SessionSelectorProps {
    isVisible: boolean;
    onSelectSession: (sessionId: string) => void;
    onDeleteSession: (sessionId: string) => void;
    onClose: () => void;
    agent: TuiAgentBackend;
    currentSessionId?: string | undefined;
}

export interface SessionSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface SessionOption {
    id: string;
    metadata: SessionMetadata | undefined;
    isCurrent: boolean;
}

const SessionSelector = forwardRef<SessionSelectorHandle, SessionSelectorProps>(
    function SessionSelector(
        { isVisible, onSelectSession, onDeleteSession, onClose, agent, currentSessionId },
        ref
    ) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);
        const [sessions, setSessions] = useState<SessionOption[]>([]);
        const [isLoading, setIsLoading] = useState(false);
        const [selectedIndex, setSelectedIndex] = useState(0);

        const sessionsRef = useRef(sessions);
        sessionsRef.current = sessions;
        const selectedIndexRef = useRef(selectedIndex);
        selectedIndexRef.current = selectedIndex;
        const onDeleteRef = useRef(onDeleteSession);
        onDeleteRef.current = onDeleteSession;

        // Fetch sessions helper
        const fetchSessions = async () => {
            try {
                const sessionIds = await agent.listSessions();
                const sessionList: SessionOption[] = await Promise.all(
                    sessionIds.map(async (id) => {
                        try {
                            const metadata = await agent.getSessionMetadata(id);
                            return { id, metadata, isCurrent: id === currentSessionId };
                        } catch {
                            return { id, metadata: undefined, isCurrent: id === currentSessionId };
                        }
                    })
                );
                sessionList.sort((a, b) => {
                    if (a.isCurrent) return -1;
                    if (b.isCurrent) return 1;
                    const aTime = a.metadata?.lastActivity || 0;
                    const bTime = b.metadata?.lastActivity || 0;
                    return bTime - aTime;
                });
                return sessionList;
            } catch (error) {
                logger.error(
                    `Failed to fetch sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    { error }
                );
                return [];
            }
        };

        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (input === 'x' || input === 'X') {
                        const currentSessions = sessionsRef.current;
                        const currentIdx = selectedIndexRef.current;
                        const item = currentSessions[currentIdx];
                        if (item && !item.isCurrent) {
                            // Remove from local state immediately for instant UI update
                            setSessions((prev) => prev.filter((s) => s.id !== item.id));
                            setSelectedIndex((prev) => Math.min(prev, Math.max(0, sessionsRef.current.length - 2)));
                            onDeleteRef.current(item.id);
                            return true;
                        }
                    }
                    return baseSelectorRef.current?.handleInput(input, key) ?? false;
                },
            }),
            []
        );

        useEffect(() => {
            if (!isVisible) return;

            let cancelled = false;
            setIsLoading(true);

            void fetchSessions().then((sessionList) => {
                if (!cancelled) {
                    setSessions(sessionList);
                    setIsLoading(false);
                    setSelectedIndex(0);
                }
            });

            return () => { cancelled = true; };
        }, [isVisible, agent, currentSessionId]);

        const formatSession = (session: SessionOption): string => {
            const parts: string[] = [];
            if (session.metadata?.title) {
                parts.push(session.metadata.title);
            } else {
                parts.push('New Session');
            }
            if (session.metadata?.parentSessionId) {
                parts.push(`forked from ${session.metadata.parentSessionId.slice(0, 8)}`);
            }
            parts.push(session.id.slice(0, 8));
            if (session.metadata?.lastActivity) {
                const now = Date.now();
                const diff = now - session.metadata.lastActivity;
                const minutes = Math.floor(diff / 60000);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);
                if (days > 0) parts.push(`${days}d ago`);
                else if (hours > 0) parts.push(`${hours}h ago`);
                else if (minutes > 0) parts.push(`${minutes}m ago`);
                else parts.push('just now');
            }
            return parts.join(' • ');
        };

        const formatItem = (session: SessionOption, isSelected: boolean) => (
            <>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {formatSession(session)}
                </Text>
                {session.isCurrent && (
                    <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                        {' '} ← Current
                    </Text>
                )}
            </>
        );

        const handleSelect = (session: SessionOption) => {
            onSelectSession(session.id);
        };

        const title = `Select Session (${sessions.length})`;

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={sessions}
                isVisible={isVisible}
                isLoading={isLoading}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title={title}
                borderColor="cyan"
                loadingMessage="Loading sessions..."
                emptyMessage="No sessions found"
                instructionsOverride="↑↓ navigate • Enter select • X delete • Esc close"
            />
        );
    }
);

export default SessionSelector;
