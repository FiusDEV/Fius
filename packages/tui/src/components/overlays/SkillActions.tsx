

import React, { useState, forwardRef, useRef, useImperativeHandle, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import type { SkillSummary } from '@fius/core';
import {
    GlobalSkillSource,
    enablePersistedSkill,
    disablePersistedSkill,
    removePersistedSkill,
} from '@fius/core';

export type SkillAction = 'toggle' | 'remove' | 'read' | 'close';

export type SkillActionResult =
    | { type: 'toggled'; skillId: string; enabled: boolean }
    | { type: 'removed'; skillId: string }
    | { type: 'read'; skillId: string; displayName: string; instructions: string }
    | { type: 'close' };

interface SkillActionsProps {
    isVisible: boolean;
    skill: (SkillSummary & { enabled: boolean }) | null;
    onResult: (result: SkillActionResult) => void;
    onClose: () => void;
}

export interface SkillActionsHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ActionOption {
    action: SkillAction;
    label: string;
    description: string;
}


const SkillActions = forwardRef<SkillActionsHandle, SkillActionsProps>(
    function SkillActions({ isVisible, skill, onResult, onClose }, ref) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [isProcessing, setIsProcessing] = useState(false);

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
                setIsProcessing(false);
            }
        }, [isVisible]);

        if (!skill) return null;

        const toggleLabel = skill.enabled ? 'Disable' : 'Enable';
        const toggleDesc = skill.enabled
            ? 'Disable this skill (will not be loaded)'
            : 'Enable this skill (will be loaded on next session)';

        const options: ActionOption[] = [
            {
                action: 'toggle',
                label: toggleLabel,
                description: toggleDesc,
            },
            {
                action: 'remove',
                label: 'Remove',
                description: 'Delete this skill permanently',
            },
            {
                action: 'read',
                label: 'Read',
                description: 'View skill instructions',
            },
        ];

        // Format option for display - matches /tools pattern
        const formatItem = (option: ActionOption, isSelected: boolean) => (
            <Box>
                <Text color={isSelected ? 'cyan' : 'gray'}>
                    {isSelected ? '▶ ' : '  '}{option.label}
                </Text>
                <Text color="gray"> - {option.description}</Text>
            </Box>
        );

        // Handle selection
        const handleSelect = async (option: ActionOption) => {
            if (isProcessing) return;
            setIsProcessing(true);

            try {
                if (option.action === 'toggle') {
                    const newEnabled = !skill.enabled;
                    if (newEnabled) {
                        await enablePersistedSkill(skill.id);
                    } else {
                        await disablePersistedSkill(skill.id);
                    }
                    onResult({ type: 'toggled', skillId: skill.id, enabled: newEnabled });
                } else if (option.action === 'remove') {
                    await removePersistedSkill(skill.id);
                    onResult({ type: 'removed', skillId: skill.id });
                } else if (option.action === 'read') {
                    const source = new GlobalSkillSource();
                    const doc = await source.get(skill.id);
                    if (doc) {
                        onResult({ type: 'read', skillId: doc.id, displayName: doc.displayName, instructions: doc.instructions });
                    } else {
                        onResult({ type: 'close' });
                    }
                }
            } catch (error) {
                onResult({ type: 'close' });
            } finally {
                setIsProcessing(false);
            }
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={options}
                isVisible={isVisible}
                isLoading={isProcessing}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title={`Skill: ${skill.displayName || skill.id}`}
                borderColor="cyan"
                emptyMessage="No actions available"
            />
        );
    }
);

export default SkillActions;
