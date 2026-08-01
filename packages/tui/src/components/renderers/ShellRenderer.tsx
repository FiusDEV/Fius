

import React from 'react';
import { Box, Text } from 'ink';
import type { ShellDisplayData } from '@fiusdev/core';

interface ShellRendererProps {
    
    data: ShellDisplayData;
    
    maxLines?: number;
}


export function ShellRenderer({ data, maxLines = 5 }: ShellRendererProps) {
    // Prefer stdout; fall back to stderr if stdout is empty/undefined
    const output = data.stdout && data.stdout.length > 0 ? data.stdout : data.stderr || '';

    const outputLines = output.split('\n').filter((line) => line.length > 0);
    const displayLines = outputLines.slice(0, maxLines);
    const truncatedCount = outputLines.length - displayLines.length;

    return (
        <Box flexDirection="column">
            {data.isBackground && <Text color="gray">{'    '}(background)</Text>}

            {outputLines.length === 0 ? (
                <Text color="gray">{'    '}(No output)</Text>
            ) : (
                <>
                    {displayLines.map((line, i) => (
                        <Text key={i} color="gray" wrap="truncate">
                            {'    '}
                            {line}
                        </Text>
                    ))}
                    {truncatedCount > 0 && (
                        <Text color="gray">
                            {'    '}+{truncatedCount} lines
                        </Text>
                    )}
                </>
            )}

            {data.exitCode !== 0 && (
                <Text color="red">
                    {'    '}exit code: {data.exitCode}
                </Text>
            )}
        </Box>
    );
}
