

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type McpAddChoiceType = 'registry' | 'custom' | 'back';

interface McpAddChoiceProps {
    isVisible: boolean;
    onSelect: (choice: McpAddChoiceType) => void;
    onClose: () => void;
}

export interface McpAddChoiceHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ChoiceItem {
    id: string;
    type: McpAddChoiceType;
    label: string;
    description: string;
    icon: string;
}

const CHOICES: ChoiceItem[] = [
    {
        id: 'registry',
        type: 'registry',
        label: 'GitHub Servers',
        description: 'Browse 150+ MCP servers from github.com/mcp',
        icon: '■',
    },
    {
        id: 'custom',
        type: 'custom',
        label: 'Add custom server',
        description: 'Configure your own MCP server',
        icon: '◇',
    },
    {
        id: 'back',
        type: 'back',
        label: 'Back',
        description: 'Return to server list',
        icon: '←',
    },
];


const McpAddChoice = forwardRef<McpAddChoiceHandle, McpAddChoiceProps>(function McpAddChoice(
    { isVisible, onSelect, onClose },
    ref
) {
    const baseSelectorRef = useRef<BaseSelectorHandle>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Forward handleInput to BaseSelector
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                return baseSelectorRef.current?.handleInput(input, key) ?? false;
            },
        }),
        []
    );

    // Reset selection when becoming visible
    useEffect(() => {
        if (isVisible) {
            setSelectedIndex(0);
        }
    }, [isVisible]);

    // Format item for display
    const formatItem = (item: ChoiceItem, isSelected: boolean) => (
        <Box>
            <Text>{item.icon} </Text>
            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                {item.label}
            </Text>
            <Text color={isSelected ? 'white' : 'gray'}> - {item.description}</Text>
        </Box>
    );

    // Handle selection
    const handleSelect = (item: ChoiceItem) => {
        onSelect(item.type);
    };

    return (
        <BaseSelector
            ref={baseSelectorRef}
            items={CHOICES}
            isVisible={isVisible}
            isLoading={false}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelect={handleSelect}
            onClose={onClose}
            formatItem={formatItem}
            title="Add MCP Server"
            borderColor="green"
            emptyMessage="No options available"
        />
    );
});

export default McpAddChoice;
