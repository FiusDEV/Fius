

import React from 'react';
import { Box, Text } from 'ink';

interface HistorySearchBarProps {
    
    query: string;
    
    hasMatch: boolean;
}


export function HistorySearchBar({ query, hasMatch }: HistorySearchBarProps) {
    return (
        <Box flexDirection="column" paddingX={1}>
            {/* Hints on separate line above */}
            <Text color="gray">Ctrl+R: older, Ctrl+E: newer, Enter: accept, Esc: cancel</Text>
            {/* Search query line */}
            <Box>
                <Text color="green">search history: </Text>
                <Text color="cyan">{query}</Text>
                <Text color="gray">_</Text>
                {query && !hasMatch && <Text color="red"> (no match)</Text>}
            </Box>
        </Box>
    );
}
