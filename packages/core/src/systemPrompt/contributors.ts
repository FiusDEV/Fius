import { SystemPromptContributor, DynamicContributorContext } from './types.js';
import { readFile, stat } from 'fs/promises';
import { resolve, extname } from 'path';
import type { Logger } from '../logger/v2/types.js';
import { SystemPromptError } from './errors.js';
import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import type { MemoryManager } from '../memory/index.js';
import type { SkillManager } from '../skills/index.js';

export class StaticContributor implements SystemPromptContributor {
    constructor(
        public id: string,
        public priority: number,
        private content: string
    ) {}

    async getContent(_context: DynamicContributorContext): Promise<string> {
        return this.content;
    }
}

export class DynamicContributor implements SystemPromptContributor {
    constructor(
        public id: string,
        public priority: number,
        private promptGenerator: (context: DynamicContributorContext) => Promise<string>
    ) {}

    async getContent(context: DynamicContributorContext): Promise<string> {
        return this.promptGenerator(context);
    }
}

export interface FileContributorOptions {
    includeFilenames?: boolean | undefined;
    separator?: string | undefined;
    errorHandling?: 'skip' | 'error' | undefined;
    maxFileSize?: number | undefined;
    includeMetadata?: boolean | undefined;
    cache?: boolean | undefined;
}

export class FileContributor implements SystemPromptContributor {
    private cache: Map<string, string> = new Map();
    private logger: Logger;

    constructor(
        public id: string,
        public priority: number,
        private files: string[],
        private options: FileContributorOptions = {},
        logger: Logger
    ) {
        this.logger = logger;
        this.logger.debug(`[FileContributor] Created "${id}" with files: ${JSON.stringify(files)}`);
    }

    async getContent(_context: DynamicContributorContext): Promise<string> {
        const {
            includeFilenames = true,
            separator = '\n\n---\n\n',
            errorHandling = 'skip',
            maxFileSize = 100000,
            includeMetadata = false,
            cache = true,
        } = this.options;

        if (cache) {
            const cacheKey = JSON.stringify({ files: this.files, options: this.options });
            const cached = this.cache.get(cacheKey);
            if (cached) {
                this.logger.debug(`[FileContributor] Using cached content for "${this.id}"`);
                return cached;
            }
        }

        const fileParts: string[] = [];

        for (const filePath of this.files) {
            try {
                const resolvedPath = resolve(filePath);
                this.logger.debug(
                    `[FileContributor] Resolving path: ${filePath} → ${resolvedPath}`
                );

                const ext = extname(resolvedPath).toLowerCase();
                if (ext !== '.md' && ext !== '.txt') {
                    if (errorHandling === 'error') {
                        throw SystemPromptError.invalidFileType(filePath, ['.md', '.txt']);
                    }
                    continue;
                }

                const stats = await stat(resolvedPath);
                if (stats.size > maxFileSize) {
                    if (errorHandling === 'error') {
                        throw SystemPromptError.fileTooLarge(filePath, stats.size, maxFileSize);
                    }
                    continue;
                }

                const content = await readFile(resolvedPath, { encoding: 'utf-8' });

                let filePart = '';

                if (includeFilenames) {
                    filePart += `## ${filePath}\n\n`;
                }

                if (includeMetadata) {
                    filePart += `*File size: ${stats.size} bytes, Modified: ${stats.mtime.toISOString()}*\n\n`;
                }

                filePart += content;

                fileParts.push(filePart);
            } catch (error: unknown) {
                if (errorHandling === 'error') {
                    if (error instanceof FiusRuntimeError) {
                        throw error;
                    }
                    const reason = error instanceof Error ? error.message : String(error);
                    throw SystemPromptError.fileReadFailed(filePath, reason);
                }
            }
        }

        if (fileParts.length === 0) {
            return '<fileContext>No files could be loaded</fileContext>';
        }

        const combinedContent = fileParts.join(separator);
        const result = `<fileContext>\n${combinedContent}\n</fileContext>`;

        if (cache) {
            const cacheKey = JSON.stringify({ files: this.files, options: this.options });
            this.cache.set(cacheKey, result);
            this.logger.debug(`[FileContributor] Cached content for "${this.id}"`);
        }

        return result;
    }
}

export interface MemoryContributorOptions {
    
    includeTimestamps?: boolean | undefined;
    
    includeTags?: boolean | undefined;
    
    limit?: number | undefined;
    
    pinnedOnly?: boolean | undefined;
}


export class MemoryContributor implements SystemPromptContributor {
    private logger: Logger;

    constructor(
        public id: string,
        public priority: number,
        private memoryManager: MemoryManager,
        private options: MemoryContributorOptions = {},
        logger: Logger
    ) {
        this.logger = logger;
        this.logger.debug(
            `[MemoryContributor] Created "${id}" with options: ${JSON.stringify(options)}`
        );
    }

    async getContent(_context: DynamicContributorContext): Promise<string> {
        const {
            includeTimestamps = false,
            includeTags = true,
            limit,
            pinnedOnly = false,
        } = this.options;

        try {
            const memories = await this.memoryManager.list({
                ...(limit !== undefined && { limit }),
                ...(pinnedOnly && { pinned: true }),
            });

            if (memories.length === 0) {
                return '';
            }

            const formattedMemories = memories.map((memory) => {
                let formatted = `- ${memory.content}`;

                if (includeTags && memory.tags && memory.tags.length > 0) {
                    formatted += ` [Tags: ${memory.tags.join(', ')}]`;
                }

                if (includeTimestamps) {
                    const date = new Date(memory.updatedAt).toLocaleDateString();
                    formatted += ` (Updated: ${date})`;
                }

                return formatted;
            });

            const header = '## User Memories';
            const memoryList = formattedMemories.join('\n');
            const result = `${header}\n${memoryList}`;

            this.logger.debug(
                `[MemoryContributor] Loaded ${memories.length} memories into system prompt`
            );
            return result;
        } catch (error) {
            this.logger.error(
                `[MemoryContributor] Failed to load memories: ${error instanceof Error ? error.message : String(error)}`
            );
            return '';
        }
    }
}


export class SkillsContributor implements SystemPromptContributor {
    private logger: Logger;

    constructor(
        public id: string,
        public priority: number,
        private skillManager: SkillManager,
        logger: Logger
    ) {
        this.logger = logger;
        this.logger.debug(`[SkillsContributor] Created "${id}"`);
    }

    async getContent(_context: DynamicContributorContext): Promise<string> {
        try {
            const skills = await this.skillManager.list();
            if (skills.length === 0) {
                return '';
            }

            const skillsList = skills
                .map((skill) => {
                    const desc = skill.description ? ` - ${skill.description}` : '';
                    return `- ${skill.displayName}${desc}`;
                })
                .join('\n');

            const result = `## Available Skills

Use \`invoke_skill\` when one of these skills is relevant:

${skillsList}`;

            this.logger.debug(
                `[SkillsContributor] Listed ${skills.length} skills in system prompt`
            );
            return result;
        } catch (error) {
            this.logger.error(
                `[SkillsContributor] Failed to list skills: ${error instanceof Error ? error.message : String(error)}`
            );
            return '';
        }
    }
}
