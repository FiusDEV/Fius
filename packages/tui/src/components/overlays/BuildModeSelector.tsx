

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

interface BuildModeSelectorProps {
    isVisible: boolean;
    currentMode: 'build' | 'plan';
    onSelect: (mode: 'build' | 'plan') => void;
    onClose: () => void;
}

export interface BuildModeSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ModeOption {
    id: 'build' | 'plan';
    label: string;
    description: string;
    icon: string;
}

const BuildModeSelector = forwardRef<BuildModeSelectorHandle, BuildModeSelectorProps>(
    function BuildModeSelector({ isVisible, currentMode, onSelect, onClose }, ref) {
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

        const [options, setOptions] = useState<ModeOption[]>([]);
        const [selectedIndex, setSelectedIndex] = useState(0);

        useEffect(() => {
            if (!isVisible) return;

            const optionList: ModeOption[] = [
                {
                    id: 'build',
                    label: 'Build',
                    description: 'Think and implement immediately',
                    icon: '▶',
                },
                {
                    id: 'plan',
                    label: 'Plan',
                    description: 'Think and plan only, no file changes',
                    icon: '◇',
                },
            ];

            setOptions(optionList);
            const idx = optionList.findIndex((o) => o.id === currentMode);
            setSelectedIndex(idx >= 0 ? idx : 0);
        }, [isVisible, currentMode]);

        const formatItem = (option: ModeOption, isSelected: boolean) => (
            <>
                <Text>{option.icon} </Text>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {option.label}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'}> - {option.description}</Text>
                {option.id === currentMode && (
                    <Text color="green"> (active)</Text>
                )}
            </>
        );

        const handleSelect = (option: ModeOption) => {
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
                title="Mode"
                borderColor="cyan"
                emptyMessage="No options available"
            />
        );
    }
);

export default BuildModeSelector;
