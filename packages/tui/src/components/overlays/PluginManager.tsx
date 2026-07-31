

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type PluginAction = 'list' | 'github' | 'add-custom' | 'back';

interface PluginManagerProps {
    isVisible: boolean;
    onAction: (action: PluginAction) => void;
    onClose: () => void;
}

export interface PluginManagerHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface PluginOption {
    action: PluginAction;
    label: string;
    hint: string;
    icon: string;
}

const PLUGIN_OPTIONS: PluginOption[] = [
    {
        action: 'list',
        label: 'Installed Plugins',
        hint: 'View, manage, uninstall',
        icon: '',
    },
    {
        action: 'github',
        label: 'GitHub Plugins',
        hint: 'Browse from official repo',
        icon: '',
    },
    {
        action: 'add-custom',
        label: 'Add custom plugin',
        hint: 'Install from path',
        icon: '',
    },
    {
        action: 'back',
        label: 'Back',
        hint: '',
        icon: '',
    },
];


const PluginManager = forwardRef<PluginManagerHandle, PluginManagerProps>(function PluginManager(
    { isVisible, onAction, onClose },
    ref
) {
    const baseSelectorRef = useRef<BaseSelectorHandle>(null);

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

    const [selectedIndex, setSelectedIndex] = useState(0);

    // Reset selection when becoming visible
    useEffect(() => {
        if (isVisible) {
            setSelectedIndex(0);
        }
    }, [isVisible]);

    // Format option for display - clean single line
    const formatItem = (option: PluginOption, isSelected: boolean) => {
        const isBack = option.action === 'back';

        return (
            <Box>
                <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
                <Text color={isBack ? 'gray' : isSelected ? 'cyan' : 'white'} bold={isSelected}>
                    {option.label}
                </Text>
                {option.hint && (
                    <Text color="gray" dimColor>
                        {' '}
                        — {option.hint}
                    </Text>
                )}
            </Box>
        );
    };

    // Handle selection
    const handleSelect = (option: PluginOption) => {
        if (option.action === 'back') {
            onClose();
        } else {
            onAction(option.action);
        }
    };

    return (
        <BaseSelector
            ref={baseSelectorRef}
            items={PLUGIN_OPTIONS}
            isVisible={isVisible}
            isLoading={false}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelect={handleSelect}
            onClose={onClose}
            formatItem={formatItem}
            title="Plugins"
            borderColor="magenta"
            emptyMessage="No options available"
        />
    );
});

export default PluginManager;
