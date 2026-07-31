

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

interface AccessModeSelectorProps {
    isVisible: boolean;
    bypassPermissions: boolean;
    onSelect: (mode: 'full' | 'confirm') => void;
    onClose: () => void;
}

export interface AccessModeSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface AccessOption {
    id: 'full' | 'confirm';
    label: string;
    description: string;
    icon: string;
    isCurrent: boolean;
}

const AccessModeSelector = forwardRef<AccessModeSelectorHandle, AccessModeSelectorProps>(
    function AccessModeSelector({ isVisible, bypassPermissions, onSelect, onClose }, ref) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);

        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    return baseSelectorRef.current?.handleInput(input, key) ?? false;
                },
            }),
            []
        );

        const [options, setOptions] = useState<AccessOption[]>([]);
        const [selectedIndex, setSelectedIndex] = useState(0);

        useEffect(() => {
            if (!isVisible) return;

            const optionList: AccessOption[] = [
                {
                    id: 'confirm',
                    label: 'Confirm Actions',
                    description: 'AI asks permission before file/network changes',
                    icon: '◈',
                    isCurrent: !bypassPermissions,
                },
                {
                    id: 'full',
                    label: 'Full Access',
                    description: 'AI performs all actions without asking',
                    icon: '▣',
                    isCurrent: bypassPermissions,
                },
            ];

            setOptions(optionList);
            setSelectedIndex(bypassPermissions ? 1 : 0);
        }, [isVisible, bypassPermissions]);

        const formatItem = (option: AccessOption, isSelected: boolean) => (
            <>
                <Text>{option.icon} </Text>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {option.label}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'}> - {option.description}</Text>
                {option.isCurrent && (
                    <Text color="green" bold>
                        {' '}
                        ✓
                    </Text>
                )}
            </>
        );

        const handleSelect = (option: AccessOption) => {
            onSelect(option.id);
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={options}
                isVisible={isVisible}
                isLoading={false}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title="Access Mode"
                borderColor="cyan"
                emptyMessage="No options available"
            />
        );
    }
);

export default AccessModeSelector;
