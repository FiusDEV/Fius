

import React from 'react';
import path from 'path';
import { Box, Text } from 'ink';
import type { SearchDisplayData } from '@fius/core';


function toRelativePath(absolutePath: string): string {
    const cwd = process.cwd();
    const relative = path.relative(cwd, absolutePath);
    if (relative === '') return '.';
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        return relative;
    }
    return absolutePath;
}

interface SearchRendererProps {
    
    data: SearchDisplayData;
    
    maxMatches?: number;
}


export function SearchRenderer({ data, maxMatches = 5 }: SearchRendererProps) {
    const { pattern, matches, totalMatches, truncated: dataTruncated } = data;
    const displayMatches = matches.slice(0, maxMatches);
    const truncated = dataTruncated || matches.length > maxMatches;

    return (
        <Box flexDirection="column">
            {/* Summary header */}
            <Text color="gray">
                {'  ⎿ '}
                {totalMatches} match{totalMatches !== 1 ? 'es' : ''} for "{pattern}"
                {truncated && ' (truncated)'}
            </Text>

            {/* Match results - file paths only for clean output */}
            {displayMatches.map((match, i) => (
                <Text key={i} color="gray" wrap="truncate">
                    {'  ⎿ '}
                    {toRelativePath(match.file)}
                    {match.line > 0 && `:${match.line}`}
                </Text>
            ))}

            {matches.length > maxMatches && (
                <Text color="gray">
                    {'  ⎿ '}... {matches.length - maxMatches} more
                </Text>
            )}
        </Box>
    );
}
