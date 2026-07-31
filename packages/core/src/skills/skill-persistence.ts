

import { promises as fs } from 'fs';
import * as path from 'path';
import { homedir } from 'os';

const SKILLS_DIR = 'skills';
const SKILLS_FILE = 'skills.json';

export interface SkillConfig {
    enabled: boolean;
    addedAt?: string | undefined;
}

export type SkillsConfig = Record<string, SkillConfig>;

function getSkillsConfigPath(): string {
    return path.join(homedir(), '.fius', SKILLS_DIR, SKILLS_FILE);
}


export async function loadPersistedSkillConfigs(): Promise<SkillsConfig> {
    const filePath = getSkillsConfigPath();
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
        return {};
    } catch {
        return {};
    }
}


export async function savePersistedSkillConfigs(configs: SkillsConfig): Promise<void> {
    const filePath = getSkillsConfigPath();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(configs, null, 2), 'utf-8');
}


export async function addPersistedSkill(skillId: string): Promise<void> {
    const configs = await loadPersistedSkillConfigs();
    if (!configs[skillId]) {
        configs[skillId] = {
            enabled: true,
            addedAt: new Date().toISOString(),
        };
    }
    await savePersistedSkillConfigs(configs);
}


export async function removePersistedSkill(skillId: string): Promise<void> {
    const configs = await loadPersistedSkillConfigs();
    delete configs[skillId];
    await savePersistedSkillConfigs(configs);
}


export async function enablePersistedSkill(skillId: string): Promise<void> {
    const configs = await loadPersistedSkillConfigs();
    configs[skillId] = { ...configs[skillId], enabled: true };
    await savePersistedSkillConfigs(configs);
}


export async function disablePersistedSkill(skillId: string): Promise<void> {
    const configs = await loadPersistedSkillConfigs();
    configs[skillId] = { ...configs[skillId], enabled: false };
    await savePersistedSkillConfigs(configs);
}


export async function isSkillEnabled(skillId: string): Promise<boolean> {
    const configs = await loadPersistedSkillConfigs();
    return configs[skillId]?.enabled ?? true;
}
