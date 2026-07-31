

import React, {
    useState,
    useEffect,
    useCallback,
    useMemo,
    forwardRef,
    useRef,
    useImperativeHandle,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import {
    fetchGitHubMcpServers,
    type GitHubMcpServer,
} from '../../utils/github-mcp-fetcher.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';

export interface McpGithubBrowserHandle {
    handleInput: (input: string, key: Key) => boolean;
}

export interface McpGithubBrowserResult {
    id: string;
    displayName: string;
    repoUrl: string;
}

interface McpGithubBrowserProps {
    isVisible: boolean;
    onSelect: (result: McpGithubBrowserResult) => void;
    onClose: () => void;
}

function formatStars(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function formatLineToWidth(text: string, width: number): string {
    if (text.length > width) return text.slice(0, width - 1) + '…';
    return text.padEnd(width);
}

function matchesSearch(query: string, server: GitHubMcpServer): boolean {
    if (!query.trim()) return true;
    const q = query.toLowerCase().replace(/[\s-]+/g, '');
    const name = server.displayName.toLowerCase().replace(/[\s-]+/g, '');
    const desc = server.description.toLowerCase();
    const lang = (server.language || '').toLowerCase();
    const topics = server.topics.join(' ').toLowerCase();
    return name.includes(q) || desc.includes(q) || lang.includes(q) || topics.includes(q);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const McpGithubBrowser = forwardRef<McpGithubBrowserHandle, McpGithubBrowserProps>(
    function McpGithubBrowser({ isVisible, onSelect, onClose }, ref) {
        const { rows: terminalRows, columns: terminalColumns } = useTerminalSize();
        const overlayWidth = useMemo(() => Math.max(30, terminalColumns - 4), [terminalColumns]);
        const listViewportItems = useMemo(
            () =>
                Math.min(
                    30,
                    Math.max(5, terminalRows - 8),
                ),
            [terminalRows],
        );

        const [servers, setServers] = useState<GitHubMcpServer[]>([]);
        const [isLoading, setIsLoading] = useState(true);
        const [searchQuery, setSearchQuery] = useState('');
        const selectedIndexRef = useRef(0);
        const [selection, setSelection] = useState({ index: 0, offset: 0 });
        const scrollOffsetRef = useRef(0);

        // Detail view state
        const [detailServer, setDetailServer] = useState<GitHubMcpServer | null>(null);
        const [isInstalling, setIsInstalling] = useState(false);

        const contentWidth = useMemo(() => Math.max(10, overlayWidth - 36), [overlayWidth]);

        // Fetch servers on mount
        useEffect(() => {
            if (!isVisible) return;
            let cancelled = false;

            setIsLoading(true);
            void fetchGitHubMcpServers().then((data) => {
                if (!cancelled) {
                    setServers(data);
                    setIsLoading(false);
                }
            });

            return () => {
                cancelled = true;
            };
        }, [isVisible]);

        const filteredServers = useMemo(() => {
            const q = searchQuery.trim();
            if (!q) return servers;
            return servers.filter((s) => matchesSearch(q, s));
        }, [servers, searchQuery]);

        const ensureVisible = useCallback(
            (targetIndex: number) => {
                const maxOffset = Math.max(0, filteredServers.length - listViewportItems);
                let newOffset = scrollOffsetRef.current;
                if (targetIndex < newOffset) {
                    newOffset = targetIndex;
                } else if (targetIndex >= newOffset + listViewportItems) {
                    newOffset = targetIndex - listViewportItems + 1;
                }
                newOffset = Math.min(maxOffset, Math.max(0, newOffset));
                scrollOffsetRef.current = newOffset;
                setSelection({ index: targetIndex, offset: newOffset });
            },
            [filteredServers.length, listViewportItems],
        );

        const moveUp = useCallback(() => {
            const next = (selectedIndexRef.current - 1 + filteredServers.length) % filteredServers.length;
            selectedIndexRef.current = next;
            ensureVisible(next);
        }, [filteredServers.length, ensureVisible]);

        const moveDown = useCallback(() => {
            const next = (selectedIndexRef.current + 1) % filteredServers.length;
            selectedIndexRef.current = next;
            ensureVisible(next);
        }, [filteredServers.length, ensureVisible]);

        const enterDetail = useCallback((server: GitHubMcpServer) => {
            setDetailServer(server);
            setSearchQuery('');
        }, []);

        const exitDetail = useCallback(() => {
            setDetailServer(null);
            setIsInstalling(false);
        }, []);

        const selectCurrent = useCallback(() => {
            if (detailServer) {
                if (!isInstalling) {
                    onSelect({
                        id: detailServer.id,
                        displayName: detailServer.displayName,
                        repoUrl: detailServer.repoUrl,
                    });
                }
                return;
            }
            // In list view — enter detail
            const server = filteredServers[selectedIndexRef.current];
            if (server) {
                enterDetail(server);
            }
        }, [detailServer, isInstalling, filteredServers, onSelect, enterDetail]);

        // Keyboard handling
        useImperativeHandle(
            ref,
            () => ({
                handleInput(input: string, key: Key): boolean {
                    if (!isVisible) return false;

                    // Detail view
                    if (detailServer) {
                        if (key.escape) { exitDetail(); return true; }
                        if (key.return) { selectCurrent(); return true; }
                        if ((key.backspace || key.delete) && searchQuery.length === 0) {
                            exitDetail();
                            return true;
                        }
                        return false;
                    }

                    // List view
                    if (isLoading) {
                        if (key.escape) onClose();
                        return true;
                    }
                    if (key.escape) { onClose(); return true; }
                    if (key.backspace || key.delete) {
                        if (searchQuery.length > 0) {
                            setSearchQuery((prev) => prev.slice(0, -1));
                            return true;
                        }
                        return false;
                    }
                    if (key.upArrow) { moveUp(); return true; }
                    if (key.downArrow) { moveDown(); return true; }
                    if (key.return) { selectCurrent(); return true; }
                    if (input && !key.return && !key.upArrow && !key.downArrow) {
                        if (input.length === 1 && input.charCodeAt(0) >= 32) {
                            setSearchQuery((prev) => prev + input);
                            selectedIndexRef.current = 0;
                            ensureVisible(0);
                            return true;
                        }
                    }
                    return false;
                },
            }),
            [
                isVisible, isLoading, filteredServers, searchQuery,
                detailServer, isInstalling,
                onClose, moveUp, moveDown, selectCurrent, ensureVisible, exitDetail,
            ],
        );

        if (!isVisible) return null;

        // Detail view
        if (detailServer) {
            return renderDetailView(detailServer, overlayWidth, isInstalling);
        }

        // List view
        const visibleItems = filteredServers.slice(selection.offset, selection.offset + listViewportItems);
        const blankLine = ' '.repeat(overlayWidth);

        return (
            <Box flexDirection="column" width={overlayWidth}>
                {/* Header */}
                <Box paddingX={0} paddingY={0} width={overlayWidth}>
                    <Text color="cyan" bold>
                        {'  GitHub MCP Servers'}
                    </Text>
                </Box>

                {/* Search */}
                <Box paddingX={0} paddingY={0} width={overlayWidth}>
                    <Text color={searchQuery ? 'white' : 'gray'}>
                        {formatLineToWidth(
                            `  Search: ${searchQuery || 'Type to filter...'}`,
                            overlayWidth,
                        )}
                    </Text>
                </Box>

                {/* Server list */}
                <Box flexDirection="column" marginTop={1} width={overlayWidth}>
                    <Box flexDirection="column" height={listViewportItems} width={overlayWidth}>
                        {isLoading
                            ? Array.from({ length: listViewportItems }, (_, index) => (
                                  <Box
                                      key={`gh-empty-${index}`}
                                      paddingX={0}
                                      paddingY={0}
                                      width={overlayWidth}
                                  >
                                      <Text>
                                          {index === 0
                                              ? formatLineToWidth('  Fetching servers from GitHub...', overlayWidth)
                                              : blankLine}
                                      </Text>
                                  </Box>
                              ))
                            : filteredServers.length === 0
                              ? Array.from({ length: listViewportItems }, (_, index) => (
                                    <Box
                                        key={`gh-empty-${index}`}
                                        paddingX={0}
                                        paddingY={0}
                                        width={overlayWidth}
                                    >
                                        <Text>
                                            {index === 0
                                                ? formatLineToWidth('  No servers found', overlayWidth)
                                                : blankLine}
                                        </Text>
                                    </Box>
                                ))
                              : Array.from({ length: listViewportItems }, (_, rowIndex) => {
                                    const server = visibleItems[rowIndex];
                                    if (!server) {
                                        return (
                                            <Box
                                                key={`gh-empty-${rowIndex}`}
                                                paddingX={0}
                                                paddingY={0}
                                                width={overlayWidth}
                                            >
                                                <Text>{blankLine}</Text>
                                            </Box>
                                        );
                                    }

                                    const actualIndex = selection.offset + rowIndex;
                                    const isSelected = actualIndex === selection.index;

                                    return (
                                        <Box
                                            key={`gh-${server.id}-${rowIndex}`}
                                            paddingX={0}
                                            paddingY={0}
                                            width={overlayWidth}
                                        >
                                            <Text color={isSelected ? 'white' : 'gray'}>
                                                {isSelected ? '▸ ' : '  '}
                                            </Text>
                                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                                {server.displayName.length > 22
                                                    ? server.displayName.slice(0, 21) + '…'
                                                    : server.displayName.padEnd(22)}
                                            </Text>
                                            <Text color="yellow"> {formatStars(server.stars).padStart(6)} ★</Text>
                                            <Text>  </Text>
                                            <Text color={isSelected ? 'white' : 'gray'}>
                                                {server.description.length > contentWidth
                                                    ? server.description.slice(0, contentWidth - 1) + '…'
                                                    : server.description}
                                            </Text>
                                        </Box>
                                    );
                                })}
                    </Box>
                </Box>

                {/* Footer */}
                <Box paddingX={0} paddingY={0} marginTop={1} width={overlayWidth}>
                    <Text color="gray">
                        {'  '}
                        <Text color="white">UP/DN</Text> navigate{'  '}
                        <Text color="white">Enter</Text> details{'  '}
                        <Text color="white">Esc</Text> close{'  '}
                        <Text color="white">Type</Text> search
                    </Text>
                </Box>
            </Box>
        );
    }
);

/* ------------------------------------------------------------------ */
/*  Detail View                                                        */
/* ------------------------------------------------------------------ */

function renderDetailView(
    server: GitHubMcpServer,
    width: number,
    isInstalling: boolean,
) {
    const contentWidth = width - 4;

    return (
        <Box flexDirection="column" width={width}>
            {/* Header */}
            <Box paddingX={0} paddingY={0} width={width}>
                <Text color="cyan" bold>
                    {'  '}{server.displayName}
                </Text>
                <Text color="gray"> by {server.name.split('/')[0]}</Text>
            </Box>

            {/* Stars & language */}
            <Box paddingX={0} paddingY={0} width={width}>
                <Text color="yellow">  ★ {formatStars(server.stars)}</Text>
                {server.language && (
                    <Text color="gray">  •  {server.language}</Text>
                )}
                {server.license && (
                    <Text color="gray">  •  {server.license}</Text>
                )}
            </Box>

            {/* Description */}
            <Box paddingX={0} paddingY={0} marginTop={1} width={width}>
                <Text color="white">
                    {'  '}{server.description.length > contentWidth
                        ? server.description.slice(0, contentWidth - 1) + '…'
                        : server.description}
                </Text>
            </Box>

            {/* Topics */}
            {server.topics.length > 0 && (
                <Box paddingX={0} paddingY={0} marginTop={1} width={width}>
                    <Text color="gray">
                        {'  '}{server.topics.slice(0, 5).join(' • ')}
                    </Text>
                </Box>
            )}

            {/* GitHub link */}
            <Box paddingX={0} paddingY={0} marginTop={1} width={width}>
                <Text color="gray">  Repo: </Text>
                <Text color="blue">{server.repoUrl}</Text>
            </Box>

            {/* Actions */}
            <Box paddingX={0} paddingY={0} marginTop={1} width={width}>
                {isInstalling ? (
                    <Text color="yellow">  ⟳ Installing...</Text>
                ) : (
                    <Text color="gray">
                        {'  '}
                        <Text color="green" bold>Enter</Text> install{'  '}
                        <Text color="white">Esc</Text> back
                    </Text>
                )}
            </Box>
        </Box>
    );
}

export default McpGithubBrowser;
