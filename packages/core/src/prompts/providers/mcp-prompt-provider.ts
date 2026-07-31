import type { MCPManager } from '../../mcp/manager.js';
import type { PromptProvider, PromptInfo, PromptDefinition, PromptListResult } from '../types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../../logger/v2/types.js';


export class MCPPromptProvider implements PromptProvider {
    private mcpManager: MCPManager;
    private logger: Logger;

    constructor(mcpManager: MCPManager, logger: Logger) {
        this.mcpManager = mcpManager;
        this.logger = logger;
    }

    
    getSource(): string {
        return 'mcp';
    }

    
    invalidateCache(): void {
        this.logger.debug('MCPPromptProvider cache invalidation (handled by MCPManager)');
    }

    
    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        const cachedPrompts = this.mcpManager.getAllPromptMetadata();

        const prompts: PromptInfo[] = cachedPrompts.map(
            ({ promptName, serverName, definition }) => {
                const promptInfo: PromptInfo = {
                    name: promptName,
                    displayName: promptName,
                    title:
                        definition.title || definition.description || `MCP prompt: ${promptName}`,
                    description: definition.description || `MCP prompt: ${promptName}`,
                    ...(definition.arguments && { arguments: definition.arguments }),
                    source: 'mcp',
                    metadata: {
                        serverName,
                        originalName: promptName,
                        ...definition,
                    },
                };
                return promptInfo;
            }
        );

        this.logger.debug(`📝 Listed ${prompts.length} MCP prompts from cache`);

        return {
            prompts,
        };
    }

    
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        this.logger.debug(`📝 Reading MCP prompt: ${name}`);
        return await this.mcpManager.getPrompt(name, args);
    }

    
    async getPromptDefinition(name: string): Promise<PromptDefinition | null> {
        try {
            const definition = this.mcpManager.getPromptMetadata(name);
            if (!definition) {
                return null;
            }

            return {
                name: definition.name,
                ...(definition.title && { title: definition.title }),
                ...(definition.description && { description: definition.description }),
                ...(definition.arguments && { arguments: definition.arguments }),
            };
        } catch (error) {
            this.logger.debug(
                `Failed to get prompt definition for '${name}': ${error instanceof Error ? error.message : String(error)}`
            );
            return null;
        }
    }
}
