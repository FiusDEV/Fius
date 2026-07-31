import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { SkillDocument, SkillSource, SkillSummary } from './types.js';
import {
    loadPersistedSkillConfigs,
    type SkillConfig,
    type SkillsConfig,
} from './skill-persistence.js';

type GlobalSkillEntry = SkillSummary & {
    skillDirectory: string;
    skillFile: string;
    enabled: boolean;
};

const SKILLS_DIR = 'skills';

export class GlobalSkillSource implements SkillSource {
    readonly id = 'global';
    private skills: GlobalSkillEntry[] | undefined;

    private getSkillsDir(): string {
        return path.join(homedir(), '.fius', SKILLS_DIR);
    }

    async list(): Promise<SkillSummary[]> {
        const entries = await this.entries();
        return entries
            .filter((entry) => entry.enabled)
            .map(({ skillDirectory: _skillDirectory, skillFile: _skillFile, enabled: _enabled, ...summary }) => ({
                ...summary,
            }));
    }

    async listAll(): Promise<(SkillSummary & { enabled: boolean })[]> {
        return (await this.entries()).map(
            ({ skillDirectory: _skillDirectory, skillFile: _skillFile, ...summary }) => ({
                ...summary,
            })
        );
    }

    async get(id: string): Promise<SkillDocument | null> {
        const entry = await this.findEntry(id);
        if (!entry) return null;
        const instructions = await fs.readFile(entry.skillFile, 'utf-8');
        return {
            id: entry.id,
            displayName: entry.displayName,
            ...(entry.description !== undefined && { description: entry.description }),
            instructions,
        };
    }

    async readFile(skillId: string, filePath: string): Promise<string> {
        const entry = await this.findEntry(skillId);
        if (!entry || filePath.startsWith('/') || filePath.split('/').includes('..')) {
            throw new Error(`Skill file not found: ${skillId}/${filePath}`);
        }
        return fs.readFile(path.join(entry.skillDirectory, filePath), 'utf-8');
    }

    async invoke(id: string, args?: Record<string, string>): Promise<SkillDocument | null> {
        const doc = await this.get(id);
        if (!doc || !args) return doc;
        return doc;
    }

    async refresh(): Promise<void> {
        this.skills = undefined;
    }

    private async entries(): Promise<GlobalSkillEntry[]> {
        if (this.skills) return this.skills;

        const skillsDir = this.getSkillsDir();
        let configs: SkillsConfig = {};

        try {
            configs = await loadPersistedSkillConfigs();
        } catch {}


        try {
            await fs.access(skillsDir);
        } catch {
            this.skills = [];
            return this.skills;
        }

        const skills: GlobalSkillEntry[] = [];

        try {
            const entries = await fs.readdir(skillsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
                try {
                    await fs.access(skillFile);
                } catch {
                    continue;
                }
                const skillDirectory = path.join(skillsDir, entry.name);
                const id = entry.name;
                const instructions = await fs.readFile(skillFile, 'utf-8');
                const description = frontmatterDescription(instructions);
                const enabled = configs[id]?.enabled ?? true;
                skills.push({
                    id,
                    displayName: firstHeading(instructions) ?? id,
                    ...(description !== undefined && { description }),
                    skillDirectory,
                    skillFile,
                    enabled,
                });
            }
        } catch {
            this.skills = [];
            return this.skills;
        }

        this.skills = skills;
        return this.skills;
    }

    private async findEntry(id: string): Promise<GlobalSkillEntry | null> {
        return (
            (await this.entries()).find((entry) => entry.id === id || entry.displayName === id) ??
            null
        );
    }
}

function firstHeading(markdown: string): string | undefined {
    const heading = markdown
        .split('\n')
        .find((line) => line.startsWith('# ') && line.slice(2).trim().length > 0);
    return heading?.slice(2).trim();
}

function frontmatterDescription(markdown: string): string | undefined {
    if (!markdown.startsWith('---\n')) return undefined;
    const end = markdown.indexOf('\n---', 4);
    if (end < 0) return undefined;

    const line = markdown
        .slice(4, end)
        .split('\n')
        .find((candidate) => candidate.trim().startsWith('description:'));
    return line?.split(':').slice(1).join(':').trim() || undefined;
}
