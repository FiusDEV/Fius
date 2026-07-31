

import React, {
    useState,
    useEffect,
    forwardRef,
    useRef,
    useImperativeHandle,
    useMemo,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { ListedPlugin } from '@fius/agent-management';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type PluginActionType = 'uninstall' | 'back';

export interface PluginActionResult {
    type: PluginActionType;
    plugin: ListedPlugin;
}

interface PluginActionsProps {
    isVisible: boolean;
    plugin: ListedPlugin | null;
    onAction: (action: PluginActionResult) => void;
    onClose: () => void;
}

export interface PluginActionsHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ActionItem {
    id: string;
    type: PluginActionType;
    label: string;
}

const PluginActions = forwardRef<PluginActionsHandle, PluginActionsProps>(function PluginActions(
    { isVisible, plugin, onAction, onClose },
    ref
) {
    const baseSelectorRef = useRef<BaseSelectorHandle>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);

    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                return baseSelectorRef.current?.handleInput(input, key) ?? false;
            },
        }),
        []
    );

    useEffect(() => {
        if (isVisible) {
            setSelectedIndex(0);
        }
    }, [isVisible, plugin]);

    const items = useMemo<ActionItem[]>(() => {
        if (!plugin) return [];

        return [
            {
                id: 'uninstall',
                type: 'uninstall' as const,
                label: 'Uninstall',
            },
            {
                id: 'back',
                type: 'back' as const,
                label: 'Back to list',
            },
        ];
    }, [plugin]);

    const formatItem = (item: ActionItem, isSelected: boolean) => {
        return (
            <Box>
                <Text color={isSelected ? 'cyan' : 'gray'}>
                    {isSelected ? '▶ ' : '  '}{item.label}
                </Text>
            </Box>
        );
    };

    const handleSelect = (item: ActionItem) => {
        if (!plugin) return;
        onAction({ type: item.type, plugin });
    };

    if (!plugin) return null;

    const version = plugin.version || 'unknown';
    const scopeBadge = plugin.scope ? ` [${plugin.scope}]` : '';

    return (
        <BaseSelector
            ref={baseSelectorRef}
            items={items}
            isVisible={isVisible}
            isLoading={false}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelect={handleSelect}
            onClose={onClose}
            formatItem={formatItem}
            title={`${plugin.name}@${version}${scopeBadge}`}
            borderColor="magenta"
            emptyMessage="No actions available"
        />
    );
});

export default PluginActions;
