

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

interface BuildModeSelectorProps {
    isVisible: boolean;
    onSelect: (mode: 'build') => void;
    onClose: () => void;
}

export interface BuildModeSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ModeOption {
    id: 'build';
    label: string;
    description: string;
    icon: string;
}

const BuildModeSelector = forwardRef<BuildModeSelectorHandle, BuildModeSelectorProps>(
    function BuildModeSelector({ isVisible, onSelect, onClose }, ref) {
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
            ];

            setOptions(optionList);
            setSelectedIndex(0);
        }, [isVisible]);

        const formatItem = (option: ModeOption, isSelected: boolean) => (
            <>
                <Text>{option.icon} </Text>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {option.label}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'}> - {option.description}</Text>
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
                title="Build Mode"
                borderColor="cyan"
                emptyMessage="No options available"
            />
        );
    }
);

export default BuildModeSelector;
