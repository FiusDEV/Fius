

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
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import { GlobalSkillSource, type SkillSummary } from '@fiusdev/core';

export type SkillSelectorAction =
    | { type: 'select-skill'; skill: SkillSummary & { enabled: boolean } }
    | { type: 'close' };

interface SkillsSelectorProps {
    isVisible: boolean;
    onAction: (action: SkillSelectorAction) => void;
    onClose: () => void;
}

export interface SkillsSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ListItem {
    id: string;
    skill?: SkillSummary & { enabled: boolean };
    isEmpty?: boolean;
}


function getStatusIcon(enabled: boolean): string {
    return enabled ? '\u25CF' : '\u25CB';
}


function getStatusText(enabled: boolean): string {
    return enabled ? 'enabled' : 'disabled';
}


const SkillsSelector = forwardRef<SkillsSelectorHandle, SkillsSelectorProps>(
    function SkillsSelector({ isVisible, onAction, onClose }, ref) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [skills, setSkills] = useState<(SkillSummary & { enabled: boolean })[]>([]);
        const [isLoading, setIsLoading] = useState(true);

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

        // Load skills when becoming visible
        useEffect(() => {
            if (isVisible) {
                setIsLoading(true);
                setSelectedIndex(0);

                const loadSkills = async () => {
                    try {
                        const globalSource = new GlobalSkillSource();
                        const allSkills = await globalSource.listAll();
                        setSkills(allSkills);
                    } catch {
                        setSkills([]);
                    }
                    setIsLoading(false);
                };

                loadSkills();
            }
        }, [isVisible]);

        // Build list items
        const items = useMemo<ListItem[]>(() => {
            if (skills.length === 0) {
                return [{ id: '__empty__', isEmpty: true }];
            }

            return skills.map((skill) => ({
                id: skill.id,
                skill,
            }));
        }, [skills]);

        // Format item for display - same style as McpServerList
        const formatItem = (item: ListItem, isSelected: boolean) => {
            if (item.isEmpty) {
                return (
                    <Box>
                        <Text color="gray">No skills installed. Use add_skill tool to install.</Text>
                    </Box>
                );
            }

            const skill = item.skill!;
            const statusIcon = getStatusIcon(skill.enabled);
            const statusText = getStatusText(skill.enabled);

            return (
                <Box>
                    <Text>{statusIcon} </Text>
                    <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                        {skill.id}
                    </Text>
                    <Text color="gray"> (skill) </Text>
                    <Text
                        color={skill.enabled ? 'green' : 'gray'}
                    >
                        [{statusText}]
                    </Text>
                </Box>
            );
        };

        // Handle selection
        const handleSelect = (item: ListItem) => {
            if (item.skill) {
                onAction({ type: 'select-skill', skill: item.skill });
            }
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={items}
                isVisible={isVisible}
                isLoading={isLoading}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title="Skills"
                borderColor="cyan"
                emptyMessage="No skills installed"
            />
        );
    }
);

export default SkillsSelector;
