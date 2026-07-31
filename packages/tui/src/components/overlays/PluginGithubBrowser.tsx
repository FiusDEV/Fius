

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
    fetchGitHubPlugins,
    type GitHubPlugin,
} from '../../utils/github-plugin-fetcher.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';

export interface PluginGithubBrowserHandle {
    handleInput: (input: string, key: Key) => boolean;
}

export interface PluginGithubBrowserResult {
    id: string;
    displayName: string;
    sourceUrl: string;
    category: string;
}

interface PluginGithubBrowserProps {
    isVisible: boolean;
    onSelect: (result: PluginGithubBrowserResult) => void;
    onClose: () => void;
}

function formatLineToWidth(text: string, width: number): string {
    if (text.length > width) return text.slice(0, width - 1) + '…';
    return text.padEnd(width);
}

function matchesSearch(query: string, plugin: GitHubPlugin): boolean {
    if (!query.trim()) return true;
    const q = query.toLowerCase().replace(/[\s-]+/g, '');
    const name = plugin.displayName.toLowerCase().replace(/[\s-]+/g, '');
    const desc = plugin.description.toLowerCase();
    const author = plugin.author.toLowerCase();
    const category = plugin.category.toLowerCase();
    return name.includes(q) || desc.includes(q) || author.includes(q) || category.includes(q);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const PluginGithubBrowser = forwardRef<PluginGithubBrowserHandle, PluginGithubBrowserProps>(
    function PluginGithubBrowser({ isVisible, onSelect, onClose }, ref) {
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

        const [plugins, setPlugins] = useState<GitHubPlugin[]>([]);
        const [isLoading, setIsLoading] = useState(true);
        const [searchQuery, setSearchQuery] = useState('');
        const selectedIndexRef = useRef(0);
        const [selection, setSelection] = useState({ index: 0, offset: 0 });
        const scrollOffsetRef = useRef(0);

        // Detail view state
        const [detailPlugin, setDetailPlugin] = useState<GitHubPlugin | null>(null);
        const [isInstalling, setIsInstalling] = useState(false);

        const contentWidth = useMemo(() => Math.max(10, overlayWidth - 39), [overlayWidth]);

        // Fetch plugins on mount
        useEffect(() => {
            if (!isVisible) return;
            let cancelled = false;

            setIsLoading(true);
            void fetchGitHubPlugins().then((data) => {
                if (!cancelled) {
                    setPlugins(data);
                    setIsLoading(false);
                }
            });

            return () => {
                cancelled = true;
            };
        }, [isVisible]);

        const filteredPlugins = useMemo(() => {
            const q = searchQuery.trim();
            if (!q) return plugins;
            return plugins.filter((p) => matchesSearch(q, p));
        }, [plugins, searchQuery]);

        const ensureVisible = useCallback(
            (targetIndex: number) => {
                const maxOffset = Math.max(0, filteredPlugins.length - listViewportItems);
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
            [filteredPlugins.length, listViewportItems],
        );

        const moveUp = useCallback(() => {
            const next = (selectedIndexRef.current - 1 + filteredPlugins.length) % filteredPlugins.length;
            selectedIndexRef.current = next;
            ensureVisible(next);
        }, [filteredPlugins.length, ensureVisible]);

        const moveDown = useCallback(() => {
            const next = (selectedIndexRef.current + 1) % filteredPlugins.length;
            selectedIndexRef.current = next;
            ensureVisible(next);
        }, [filteredPlugins.length, ensureVisible]);

        const enterDetail = useCallback((plugin: GitHubPlugin) => {
            setDetailPlugin(plugin);
            setSearchQuery('');
        }, []);

        const exitDetail = useCallback(() => {
            setDetailPlugin(null);
            setIsInstalling(false);
        }, []);

        const selectCurrent = useCallback(() => {
            if (detailPlugin) {
                if (!isInstalling) {
                    onSelect({
                        id: detailPlugin.id,
                        displayName: detailPlugin.displayName,
                        sourceUrl: detailPlugin.sourceUrl,
                        category: detailPlugin.category,
                    });
                }
                return;
            }
            // In list view — enter detail
            const plugin = filteredPlugins[selectedIndexRef.current];
            if (plugin) {
                enterDetail(plugin);
            }
        }, [detailPlugin, isInstalling, filteredPlugins, onSelect, enterDetail]);

        // Keyboard handling
        useImperativeHandle(
            ref,
            () => ({
                handleInput(input: string, key: Key): boolean {
                    if (!isVisible) return false;

                    // Detail view
                    if (detailPlugin) {
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
                isVisible, isLoading, filteredPlugins, searchQuery,
                detailPlugin, isInstalling,
                onClose, moveUp, moveDown, selectCurrent, ensureVisible, exitDetail,
            ],
        );

        if (!isVisible) return null;

        // Detail view
        if (detailPlugin) {
            return renderDetailView(detailPlugin, overlayWidth, isInstalling);
        }

        // List view
        const visibleItems = filteredPlugins.slice(selection.offset, selection.offset + listViewportItems);
        const blankLine = ' '.repeat(overlayWidth);

        return (
            <Box flexDirection="column" width={overlayWidth}>
                {/* Header */}
                <Box paddingX={0} paddingY={0} width={overlayWidth}>
                    <Text color="cyan" bold>
                        {'  GitHub Plugins'}
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

                {/* Plugin list */}
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
                                              ? formatLineToWidth('  Fetching plugins from GitHub...', overlayWidth)
                                              : blankLine}
                                      </Text>
                                  </Box>
                              ))
                            : filteredPlugins.length === 0
                              ? Array.from({ length: listViewportItems }, (_, index) => (
                                    <Box
                                        key={`gh-empty-${index}`}
                                        paddingX={0}
                                        paddingY={0}
                                        width={overlayWidth}
                                    >
                                        <Text>
                                            {index === 0
                                                ? formatLineToWidth('  No plugins found', overlayWidth)
                                                : blankLine}
                                        </Text>
                                    </Box>
                                ))
                              : Array.from({ length: listViewportItems }, (_, rowIndex) => {
                                    const plugin = visibleItems[rowIndex];
                                    if (!plugin) {
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
                                            key={`gh-${plugin.id}-${rowIndex}`}
                                            paddingX={0}
                                            paddingY={0}
                                            width={overlayWidth}
                                        >
                                            <Text color={isSelected ? 'white' : 'gray'}>
                                                {isSelected ? '▸ ' : '  '}
                                            </Text>
                                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                                {plugin.displayName.length > 22
                                                    ? plugin.displayName.slice(0, 21) + '…'
                                                    : plugin.displayName.padEnd(22)}
                                            </Text>
                                            <Text color="yellow"> {plugin.category.padEnd(12)}</Text>
                                            <Text>  </Text>
                                            <Text color={isSelected ? 'white' : 'gray'}>
                                                {plugin.description.length > contentWidth
                                                    ? plugin.description.slice(0, contentWidth - 1) + '…'
                                                    : plugin.description}
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
    plugin: GitHubPlugin,
    width: number,
    isInstalling: boolean,
) {
    const contentWidth = width - 4;

    return (
        <Box flexDirection="column" width={width}>
            {/* Header */}
            <Box paddingX={0} paddingY={0} width={width}>
                <Text color="cyan" bold>
                    {'  '}{plugin.displayName}
                </Text>
                <Text color="gray"> by {plugin.author}</Text>
            </Box>

            {/* Category & source type */}
            <Box paddingX={0} paddingY={0} width={width}>
                <Text color="yellow">  {plugin.category}</Text>
                <Text color="gray">  •  {plugin.sourceType}</Text>
                {plugin.skills.length > 0 && (
                    <Text color="gray">  •  {plugin.skills.length} skills</Text>
                )}
            </Box>

            {/* Description */}
            <Box paddingX={0} paddingY={0} marginTop={1} width={width}>
                <Text color="white">
                    {'  '}{plugin.description.length > contentWidth
                        ? plugin.description.slice(0, contentWidth - 1) + '…'
                        : plugin.description}
                </Text>
            </Box>

            {/* Homepage */}
            {plugin.homepage && (
                <Box paddingX={0} paddingY={0} marginTop={1} width={width}>
                    <Text color="gray">  Homepage: </Text>
                    <Text color="blue">{plugin.homepage}</Text>
                </Box>
            )}

            {/* Source */}
            {plugin.sourceUrl && (
                <Box paddingX={0} paddingY={0} marginTop={0} width={width}>
                    <Text color="gray">  Source: </Text>
                    <Text color="blue">{plugin.sourceUrl}</Text>
                </Box>
            )}

            {/* Actions */}
            <Box paddingX={0} paddingY={0} marginTop={1} width={width}>
                {isInstalling ? (
                    <Text color="yellow">  Installing...</Text>
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

export default PluginGithubBrowser;
