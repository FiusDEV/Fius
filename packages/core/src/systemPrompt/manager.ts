import type { ValidatedSystemPromptConfig, ValidatedContributorConfig } from './schemas.js';
import { StaticContributor, FileContributor, MemoryContributor } from './contributors.js';
import { getPromptGenerator } from './registry.js';
import type { MemoryManager, ValidatedMemoriesConfig } from '../memory/index.js';

import type { SystemPromptContributor, DynamicContributorContext } from './types.js';
import { DynamicContributor } from './contributors.js';
import type { Logger } from '../logger/v2/types.js';
import { FiusLogComponent } from '../logger/v2/types.js';
import { SystemPromptError } from './errors.js';


export class SystemPromptManager {
    private contributors: SystemPromptContributor[];
    private memoryManager: MemoryManager;
    private logger: Logger;

    constructor(
        config: ValidatedSystemPromptConfig,
        memoryManager: MemoryManager,
        memoriesConfig: ValidatedMemoriesConfig | undefined,
        logger: Logger
    ) {
        this.memoryManager = memoryManager;
        this.logger = logger.createChild(FiusLogComponent.SYSTEM_PROMPT);

        const enabledContributors = config.contributors.filter((c) => c.enabled !== false);

        const contributors: SystemPromptContributor[] = enabledContributors.map((config) =>
            this.createContributor(config)
        );

        if (memoriesConfig?.enabled) {
            this.logger.debug(
                `[SystemPromptManager] Creating MemoryContributor with options: ${JSON.stringify(memoriesConfig)}`
            );
            contributors.push(
                new MemoryContributor(
                    'memories',
                    memoriesConfig.priority,
                    this.memoryManager,
                    {
                        includeTimestamps: memoriesConfig.includeTimestamps,
                        includeTags: memoriesConfig.includeTags,
                        limit: memoriesConfig.limit,
                        pinnedOnly: memoriesConfig.pinnedOnly,
                    },
                    this.logger
                )
            );
        }

        this.contributors = contributors.sort((a, b) => a.priority - b.priority);
    }

    private createContributor(config: ValidatedContributorConfig): SystemPromptContributor {
        switch (config.type) {
            case 'static':
                return new StaticContributor(config.id, config.priority, config.content);

            case 'dynamic': {
                const promptGenerator = getPromptGenerator(config.source);
                if (!promptGenerator) {
                    throw SystemPromptError.unknownContributorSource(config.source);
                }
                return new DynamicContributor(config.id, config.priority, promptGenerator);
            }

            case 'file': {
                this.logger.debug(
                    `[SystemPromptManager] Creating FileContributor "${config.id}" with files: ${JSON.stringify(config.files)}`
                );
                return new FileContributor(
                    config.id,
                    config.priority,
                    config.files,
                    config.options,
                    this.logger
                );
            }

            default: {
                const _exhaustive: never = config;
                throw SystemPromptError.invalidContributorConfig(_exhaustive);
            }
        }
    }

    
    async build(ctx: DynamicContributorContext): Promise<string> {
        const sessionContributors =
            ctx.session?.systemPromptContributors?.map(
                (contributor) =>
                    new StaticContributor(contributor.id, contributor.priority, contributor.content)
            ) ?? [];
        const contributors = [...this.contributors, ...sessionContributors].sort(
            (a, b) => a.priority - b.priority
        );
        const parts = await Promise.all(
            contributors.map(async (contributor) => {
                const content = await contributor.getContent(ctx);
                this.logger.debug(
                    `[SystemPrompt] Contributor "${contributor.id}" provided content: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`
                );
                return content;
            })
        );
        return parts.join('\n');
    }

    
    getContributors(): SystemPromptContributor[] {
        return this.contributors;
    }

    
    addContributor(contributor: SystemPromptContributor): void {
        this.contributors.push(contributor);
        this.contributors.sort((a, b) => a.priority - b.priority);
        this.logger.debug(
            `Added contributor: ${contributor.id} (priority: ${contributor.priority})`
        );
    }

    
    removeContributor(id: string): boolean {
        const index = this.contributors.findIndex((c) => c.id === id);
        if (index === -1) return false;
        this.contributors.splice(index, 1);
        this.logger.debug(`Removed contributor: ${id}`);
        return true;
    }
}
