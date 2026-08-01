

import React from 'react';
import { Box, Text } from 'ink';
import type { DiffDisplayData, FileDisplayData } from '@fiusdev/core';
import { makeRelativePath } from '../../utils/messageFormatting.js';
import {
    parseUnifiedDiff,
    findLinePairs,
    computeWordDiff,
    getLineNumWidth,
    formatLineNum,
    DiffLine,
    HunkSeparator,
} from './diff-shared.js';

// =============================================================================
// DiffPreview Component
// =============================================================================

interface DiffPreviewProps {
    data: DiffDisplayData;
    header?: string;
    scrollTop?: number;
    maxHeight?: number;
    canScrollUp?: boolean;
    canScrollDown?: boolean;
}

export const DIFF_MAX_HEIGHT = 20;

interface FlatDiffLine {
    type: string;
    lineNum: number;
    content: string;
    wordDiffParts?: any;
    isSeparator?: boolean;
}

export function DiffPreview({ data, header, scrollTop = 0, maxHeight = DIFF_MAX_HEIGHT, canScrollUp, canScrollDown }: DiffPreviewProps) {
    const { unified, filename } = data;
    const hunks = parseUnifiedDiff(unified);

    const flatLines: FlatDiffLine[] = [];

    for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
        const hunk = hunks[hunkIndex]!;
        const linePairs = findLinePairs(hunk.lines);
        const processedIndices = new Set<number>();

        if (hunkIndex > 0) {
            flatLines.push({ type: 'separator', lineNum: 0, content: '', isSeparator: true });
        }

        for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex++) {
            if (processedIndices.has(lineIndex)) continue;
            const line = hunk.lines[lineIndex]!;

            const pair = linePairs.get(lineIndex);
            if (pair) {
                processedIndices.add(lineIndex + 1);
                const { oldParts, newParts } = computeWordDiff(pair.del.content, pair.add.content);
                flatLines.push({ type: 'deletion', lineNum: pair.del.lineNum, content: pair.del.content, wordDiffParts: oldParts });
                flatLines.push({ type: 'addition', lineNum: pair.add.lineNum, content: pair.add.content, wordDiffParts: newParts });
            } else {
                flatLines.push({ type: line.type, lineNum: line.lineNum, content: line.content });
            }
        }
    }

    const maxLineNum = Math.max(1, ...flatLines.filter(l => !l.isSeparator).map(l => l.lineNum));
    const lineNumWidth = getLineNumWidth(maxLineNum);
    const totalLines = flatLines.length;
    const showScrollUp = canScrollUp ?? scrollTop > 0;
    const showScrollDown = canScrollDown ?? scrollTop + maxHeight < totalLines;
    const headerText = header ?? data.title ?? 'Update file';

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box marginBottom={0}>
                <Text color="cyan" bold>{headerText}</Text>
            </Box>

            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                <Box marginBottom={0}>
                    <Text>{makeRelativePath(filename)}</Text>
                </Box>

                {showScrollUp && (
                    <Text color="yellow" italic>  ↑ scroll up ({scrollTop}/{totalLines})</Text>
                )}

                {flatLines.slice(scrollTop, scrollTop + maxHeight).map((line, i) => {
                    if (line.isSeparator) {
                        return <HunkSeparator key={`sep-${i}`} />;
                    }
                    return (
                        <DiffLine
                            key={`l-${scrollTop + i}`}
                            type={line.type as any}
                            lineNum={line.lineNum}
                            lineNumWidth={lineNumWidth}
                            content={line.content}
                            wordDiffParts={line.wordDiffParts}
                        />
                    );
                })}

                {showScrollDown && (
                    <Text color="yellow" italic>  ↓ scroll down ({totalLines - scrollTop - maxHeight} more)</Text>
                )}
            </Box>
        </Box>
    );
}

// =============================================================================
// CreateFilePreview Component
// =============================================================================

interface CreateFilePreviewProps {
    data: FileDisplayData;
    
    header?: string;
}


export function CreateFilePreview({ data, header }: CreateFilePreviewProps) {
    const { path, content, lineCount } = data;
    const headerText = header ?? data.title ?? 'Create file';

    if (!content) {
        return (
            <Box flexDirection="column" marginBottom={1}>
                <Box marginBottom={0}>
                    <Text color="cyan" bold>
                        {headerText}
                    </Text>
                </Box>
                <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                    <Text>{makeRelativePath(path)}</Text>
                    {lineCount && <Text color="gray">{lineCount} lines</Text>}
                </Box>
            </Box>
        );
    }

    const lines = content.split('\n');
    const MAX_VISIBLE_LINES = 20;
    const totalLines = lines.length;
    const isTruncated = totalLines > MAX_VISIBLE_LINES;
    const visibleLines = isTruncated ? lines.slice(0, MAX_VISIBLE_LINES) : lines;

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box marginBottom={0}>
                <Text color="cyan" bold>
                    {headerText}
                </Text>
            </Box>
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                <Box marginBottom={0}>
                    <Text>{makeRelativePath(path)}</Text>
                </Box>
                {visibleLines.map((line, i) => (
                    <Text key={i} wrap="wrap">{line}</Text>
                ))}
                {isTruncated && (
                    <Text color="gray" italic>  ... {totalLines - MAX_VISIBLE_LINES} more lines</Text>
                )}
            </Box>
        </Box>
    );
}
