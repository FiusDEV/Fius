import { FiusMcpClient } from './mcp-client.js';
import type { ValidatedServersConfig, ValidatedMcpServerConfig } from './schemas.js';
import type { Logger } from '../logger/v2/types.js';
import { FiusLogComponent } from '../logger/v2/types.js';
import type {
    GetPromptResult,
    ReadResourceResult,
    Prompt,
} from '@modelcontextprotocol/sdk/types.js';
import type {
    McpClient,
    MCPResolvedResource,
    MCPResourceSummary,
    McpAuthProviderFactory,
} from './types.js';
import type { ToolSet } from '../tools/types.js';
import { MCPError } from './errors.js';
import { eventBus, type AgentEventBus } from '../events/index.js';
import type { PromptDefinition } from '../prompts/types.js';
import type { JSONSchema7 } from 'json-schema';
import type { ApprovalManager } from '../approval/manager.js';
import type { AgentRunContext } from '../runtime/run-context.js';


type ResourceCacheEntry = {
    serverName: string;
    client: McpClient;
    summary: MCPResourceSummary;
};

type PromptCacheEntry = {
    serverName: string;
    client: McpClient;
    definition: PromptDefinition;
};

type ToolCacheEntry = {
    serverName: string;
    client: McpClient;
    definition: {
        name?: string;
        description?: string;
        parameters: JSONSchema7;
    };
};

export class MCPManager {
    private clients: Map<string, McpClient> = new Map();
    private connectionErrors: { [key: string]: { message: string; code?: string } } = {};
    private configCache: Map<string, ValidatedMcpServerConfig> = new Map();
    private toolCache: Map<string, ToolCacheEntry> = new Map();
    private toolConflicts: Set<string> = new Set();
    private promptCache: Map<string, PromptCacheEntry> = new Map();
    private resourceCache: Map<string, ResourceCacheEntry> = new Map();
    private sanitizedNameToServerMap: Map<string, string> = new Map();
    private approvalManager: ApprovalManager | null = null;
    private authProviderFactory: McpAuthProviderFactory | null = null;
    private logger: Logger;
    private eventBus: AgentEventBus;

    private static readonly SERVER_DELIMITER = '--';

    constructor(logger: Logger, eventBusOverride?: AgentEventBus) {
        this.logger = logger.createChild(FiusLogComponent.MCP);
        this.eventBus = eventBusOverride ?? eventBus;
    }

    setAuthProviderFactory(factory: McpAuthProviderFactory | null): void {
        this.authProviderFactory = factory;
        for (const [_name, client] of this.clients.entries()) {
            if (client instanceof FiusMcpClient) {
                client.setAuthProviderFactory(factory);
            }
        }
    }

    
    setApprovalManager(approvalManager: ApprovalManager): void {
        this.approvalManager = approvalManager;
        for (const [_name, client] of this.clients.entries()) {
            if (client instanceof FiusMcpClient) {
                client.setApprovalManager(approvalManager);
            }
        }
    }

    private buildQualifiedResourceKey(serverName: string, resourceUri: string): string {
        return `mcp:${serverName}:${resourceUri}`;
    }

    private parseQualifiedResourceKey(key: string): { serverName: string; resourceUri: string } {
        if (!key.startsWith('mcp:')) {
            throw MCPError.resourceNotFound(key);
        }
        const [, serverName, ...rest] = key.split(':');
        if (!serverName || rest.length === 0) {
            throw MCPError.resourceNotFound(key);
        }
        return { serverName, resourceUri: rest.join(':') };
    }

    private removeServerResources(serverName: string): void {
        for (const [key, entry] of Array.from(this.resourceCache.entries())) {
            if (entry.serverName === serverName) {
                this.resourceCache.delete(key);
            }
        }
    }

    private getResourceCacheEntry(resourceKey: string): ResourceCacheEntry | undefined {
        if (this.resourceCache.has(resourceKey)) {
            return this.resourceCache.get(resourceKey);
        }

        try {
            const { serverName, resourceUri } = this.parseQualifiedResourceKey(resourceKey);
            const canonicalKey = this.buildQualifiedResourceKey(serverName, resourceUri);
            return this.resourceCache.get(canonicalKey);
        } catch {
            return undefined;
        }
    }

    
    registerClient(name: string, client: McpClient): void {
        if (this.clients.has(name)) {
            this.logger.warn(`Client '${name}' already registered. Overwriting.`);
        }

        this.clearClientCache(name);

        const sanitizedName = this.sanitizeServerName(name);
        const existingServerWithSameSanitizedName =
            this.sanitizedNameToServerMap.get(sanitizedName);
        if (existingServerWithSameSanitizedName && existingServerWithSameSanitizedName !== name) {
            throw MCPError.duplicateName(name, existingServerWithSameSanitizedName);
        }

        this.clients.set(name, client);
        this.sanitizedNameToServerMap.set(sanitizedName, name);
        this.setupClientNotifications(name, client);

        this.logger.info(`Registered client: ${name}`);
        delete this.connectionErrors[name];
    }

    
    private clearClientCache(clientName: string): void {
        const client = this.clients.get(clientName);
        if (!client) return;

        const sanitizedName = this.sanitizeServerName(clientName);
        if (this.sanitizedNameToServerMap.get(sanitizedName) === clientName) {
            this.sanitizedNameToServerMap.delete(sanitizedName);
        }

        const removedToolBaseNames = new Set<string>();

        for (const [toolKey, entry] of Array.from(this.toolCache.entries())) {
            if (entry.serverName === clientName) {
                const delimiterIndex = toolKey.lastIndexOf(MCPManager.SERVER_DELIMITER);
                const baseName =
                    delimiterIndex === -1
                        ? toolKey
                        : toolKey.substring(delimiterIndex + MCPManager.SERVER_DELIMITER.length);

                removedToolBaseNames.add(baseName);
                this.toolCache.delete(toolKey);
            }
        }

        for (const baseName of removedToolBaseNames) {
            const remainingTools = Array.from(this.toolCache.entries()).filter(([key, _]) => {
                const delimiterIndex = key.lastIndexOf(MCPManager.SERVER_DELIMITER);
                const bn =
                    delimiterIndex === -1
                        ? key
                        : key.substring(delimiterIndex + MCPManager.SERVER_DELIMITER.length);
                return bn === baseName;
            });

            if (remainingTools.length === 0) {
                this.toolConflicts.delete(baseName);
            } else if (remainingTools.length === 1 && this.toolConflicts.has(baseName)) {
                const singleTool = remainingTools[0];
                if (singleTool) {
                    const [qualifiedKey, entry] = singleTool;
                    this.toolCache.delete(qualifiedKey);
                    this.toolCache.set(baseName, entry);
                    this.toolConflicts.delete(baseName);
                    this.logger.debug(
                        `Restored tool '${baseName}' to simple name (conflict resolved)`
                    );
                }
            }
        }

        for (const [promptName, entry] of Array.from(this.promptCache.entries())) {
            if (entry.serverName === clientName) {
                this.promptCache.delete(promptName);
            }
        }

        for (const [key, entry] of Array.from(this.resourceCache.entries())) {
            if (entry.client === client || entry.serverName === clientName) {
                this.resourceCache.delete(key);
            }
        }

        this.logger.debug(`Cleared cache for client: ${clientName}`);
    }

    
    private sanitizeServerName(serverName: string): string {
        return serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    
    private async updateClientCache(clientName: string, client: McpClient): Promise<void> {
        try {
            const tools = await client.getTools();
            this.logger.debug(
                `🔧 Discovered ${Object.keys(tools).length} tools from server '${clientName}': [${Object.keys(tools).join(', ')}]`
            );

            for (const toolName in tools) {
                const toolDef = tools[toolName];
                if (!toolDef) continue;

                const existingEntry = this.toolCache.get(toolName);
                if (existingEntry && existingEntry.serverName !== clientName) {
                    this.toolConflicts.add(toolName);
                    this.toolCache.delete(toolName);

                    const existingSanitized = this.sanitizeServerName(existingEntry.serverName);
                    const existingQualified = `${existingSanitized}${MCPManager.SERVER_DELIMITER}${toolName}`;
                    this.toolCache.set(existingQualified, existingEntry);

                    const newSanitized = this.sanitizeServerName(clientName);
                    const newQualified = `${newSanitized}${MCPManager.SERVER_DELIMITER}${toolName}`;
                    this.toolCache.set(newQualified, {
                        serverName: clientName,
                        client,
                        definition: toolDef,
                    });

                    this.logger.warn(
                        `⚠️  Tool conflict detected for '${toolName}' - using server prefixes: ${existingQualified}, ${newQualified}`
                    );
                } else if (this.toolConflicts.has(toolName)) {
                    const sanitizedName = this.sanitizeServerName(clientName);
                    const qualifiedName = `${sanitizedName}${MCPManager.SERVER_DELIMITER}${toolName}`;
                    this.toolCache.set(qualifiedName, {
                        serverName: clientName,
                        client,
                        definition: toolDef,
                    });
                    this.logger.debug(`✅ Tool '${qualifiedName}' cached (known conflict)`);
                } else {
                    this.toolCache.set(toolName, {
                        serverName: clientName,
                        client,
                        definition: toolDef,
                    });
                    this.logger.debug(`✅ Tool '${toolName}' mapped to ${clientName}`);
                }
            }
            this.logger.debug(
                `✅ Successfully cached ${Object.keys(tools).length} tools for client: ${clientName}`
            );
        } catch (error) {
            this.logger.error(
                `❌ Error retrieving tools for client ${clientName}: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
        }

        try {
            const prompts: Prompt[] = await client.listPrompts();

            for (const prompt of prompts) {
                const definition: PromptDefinition = {
                    name: prompt.name,
                    ...(prompt.title && { title: prompt.title }),
                    ...(prompt.description && { description: prompt.description }),
                    ...(prompt.arguments && { arguments: prompt.arguments }),
                };

                this.promptCache.set(prompt.name, {
                    serverName: clientName,
                    client,
                    definition,
                });
            }

            this.logger.debug(`Cached ${prompts.length} prompts for client: ${clientName}`);
        } catch (error) {
            this.logger.debug(`Skipping prompts for client ${clientName}: ${error}`);
        }

        try {
            this.removeServerResources(clientName);
            const resources = await client.listResources();
            resources.forEach((summary) => {
                const key = this.buildQualifiedResourceKey(clientName, summary.uri);
                this.resourceCache.set(key, {
                    serverName: clientName,
                    client,
                    summary,
                });
            });
            this.logger.debug(`Cached resources for client: ${clientName}`);
        } catch (error) {
            this.logger.debug(`Skipping resources for client ${clientName}: ${error}`);
        }
    }

    
    async getAllTools(): Promise<ToolSet> {
        const allTools: ToolSet = {};

        for (const [toolKey, entry] of this.toolCache.entries()) {
            const toolDef = entry.definition;

            if (toolKey.includes(MCPManager.SERVER_DELIMITER)) {
                allTools[toolKey] = {
                    ...toolDef,
                    description: toolDef.description
                        ? `${toolDef.description} (via ${entry.serverName})`
                        : `Tool from ${entry.serverName}`,
                };
            } else {
                allTools[toolKey] = toolDef;
            }
        }

        const serverNames = Array.from(
            new Set(Array.from(this.toolCache.values()).map((e) => e.serverName))
        );

        this.logger.debug(
            `🔧 MCP tools from cache: ${Object.keys(allTools).length} total tools, ${this.toolConflicts.size} conflicts, connected servers: ${serverNames.join(', ')}`
        );

        Object.keys(allTools).forEach((toolName) => {
            if (toolName.includes(MCPManager.SERVER_DELIMITER)) {
                this.logger.debug(`  - ${toolName} (qualified)`);
            } else {
                this.logger.debug(`  - ${toolName}`);
            }
        });

        this.logger.silly(`MCP tools: ${JSON.stringify(allTools, null, 2)}`);
        return allTools;
    }

    
    getAllToolsWithServerInfo(): Map<string, ToolCacheEntry> {
        return new Map(this.toolCache);
    }

    
    private parseQualifiedToolName(
        toolName: string
    ): { serverName: string; toolName: string } | null {
        const delimiterIndex = toolName.lastIndexOf(MCPManager.SERVER_DELIMITER);
        if (delimiterIndex === -1) {
            return null;
        }

        const serverPrefix = toolName.substring(0, delimiterIndex);
        const actualToolName = toolName.substring(
            delimiterIndex + MCPManager.SERVER_DELIMITER.length
        );

        const originalServerName = this.sanitizedNameToServerMap.get(serverPrefix);

        if (originalServerName && this.toolCache.has(toolName)) {
            return { serverName: originalServerName, toolName: actualToolName };
        }

        return null;
    }

    
    getToolClient(toolName: string): McpClient | undefined {
        return this.toolCache.get(toolName)?.client;
    }

    
    async executeTool(
        toolName: string,
        args: any,
        sessionId?: string,
        runContext?: AgentRunContext
    ): Promise<any> {
        const client = this.getToolClient(toolName);
        if (!client) {
            this.logger.error(`❌ No MCP tool found: ${toolName}`);
            this.logger.debug(
                `Available MCP tools: ${Array.from(this.toolCache.keys()).join(', ')}`
            );
            this.logger.debug(`Conflicted tools: ${Array.from(this.toolConflicts).join(', ')}`);
            throw MCPError.toolNotFound(toolName);
        }

        const parsed = this.parseQualifiedToolName(toolName);
        const actualToolName = parsed ? parsed.toolName : toolName;
        const serverName = parsed ? parsed.serverName : 'direct';

        this.logger.debug(
            `▶️  Executing MCP tool '${actualToolName}' on server '${serverName}'...`
        );

        try {
            const invocation =
                sessionId !== undefined || runContext !== undefined
                    ? {
                          ...(sessionId !== undefined ? { sessionId } : {}),
                          ...(runContext !== undefined ? { runContext } : {}),
                      }
                    : undefined;
            const result = await client.callTool(actualToolName, args, invocation);
            return result;
        } catch (error) {
            this.logger.error(
                `❌ MCP tool execution failed: '${actualToolName}' - ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    
    async listAllPrompts(): Promise<string[]> {
        return Array.from(this.promptCache.keys());
    }

    
    getPromptClient(promptName: string): McpClient | undefined {
        return this.promptCache.get(promptName)?.client;
    }

    
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        const client = this.getPromptClient(name);
        if (!client) {
            throw MCPError.promptNotFound(name);
        }
        return await client.getPrompt(name, args);
    }

    
    getPromptMetadata(promptName: string): PromptDefinition | undefined {
        const entry = this.promptCache.get(promptName);
        return entry?.definition;
    }

    
    getAllPromptMetadata(): Array<{
        promptName: string;
        serverName: string;
        definition: PromptDefinition;
    }> {
        return Array.from(this.promptCache.entries()).map(([promptName, entry]) => ({
            promptName,
            serverName: entry.serverName,
            definition: entry.definition,
        }));
    }

    
    async listAllResources(): Promise<MCPResolvedResource[]> {
        return Array.from(this.resourceCache.entries()).map(([key, { serverName, summary }]) => ({
            key,
            serverName,
            summary,
        }));
    }

    
    hasResource(resourceKey: string): boolean {
        return this.getResourceCacheEntry(resourceKey) !== undefined;
    }

    
    getResource(resourceKey: string): MCPResolvedResource | undefined {
        const entry = this.getResourceCacheEntry(resourceKey);
        if (!entry) return undefined;
        return {
            key: resourceKey,
            serverName: entry.serverName,
            summary: entry.summary,
        };
    }

    
    async readResource(resourceKey: string): Promise<ReadResourceResult> {
        const entry = this.getResourceCacheEntry(resourceKey);
        if (!entry) {
            throw MCPError.resourceNotFound(resourceKey);
        }
        return await entry.client.readResource(entry.summary.uri);
    }

    
    async initializeFromConfig(serverConfigs: ValidatedServersConfig): Promise<void> {
        if (Object.keys(serverConfigs).length === 0) {
            this.logger.debug('No MCP servers configured - running without external tools');
            return;
        }

        const successfulConnections: string[] = [];
        const connectionPromises: Promise<void>[] = [];
        const strictServers: string[] = [];
        const lenientServers: string[] = [];

        for (const [name, config] of Object.entries(serverConfigs)) {
            if (config.enabled === false) {
                this.logger.info(`Skipping disabled server '${name}'`);
                continue;
            }

            const effectiveMode = config.connectionMode || 'lenient';
            if (effectiveMode === 'strict') {
                strictServers.push(name);
            } else {
                lenientServers.push(name);
            }

            const connectPromise = this.connectServer(name, config)
                .then(() => {
                    successfulConnections.push(name);
                })
                .catch((error) => {
                    if (!this.connectionErrors[name]) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        const errorCode =
                            error && typeof error === 'object' && 'code' in error
                                ? String((error as { code?: unknown }).code)
                                : undefined;
                        this.connectionErrors[name] = {
                            message: errorMessage,
                            ...(errorCode ? { code: errorCode } : {}),
                        };
                    }
                    this.logger.debug(
                        `Handled connection error for '${name}' during initialization: ${error instanceof Error ? error.message : String(error)}`
                    );
                });
            connectionPromises.push(connectPromise);
        }

        await Promise.all(connectionPromises);

        const failedStrictServers = strictServers.filter(
            (name) => !successfulConnections.includes(name)
        );
        if (failedStrictServers.length > 0) {
            const strictErrors = failedStrictServers
                .map(
                    (name) => `${name}: ${this.connectionErrors[name]?.message ?? 'Unknown error'}`
                )
                .join('; ');
            throw MCPError.connectionFailed('strict servers', strictErrors);
        }

    }

    
    async connectServer(name: string, config: ValidatedMcpServerConfig): Promise<void> {
        if (this.clients.has(name)) {
            this.logger.warn(`Client '${name}' is already connected or registered.`);
            return;
        }

        const client = new FiusMcpClient(this.logger);
        client.setAuthProviderFactory(this.authProviderFactory);
        try {
            this.logger.info(`Attempting to connect to new server '${name}'...`);
            await client.connect(config, name);

            if (this.approvalManager) {
                client.setApprovalManager(this.approvalManager);
            }

            this.registerClient(name, client);
            await this.updateClientCache(name, client);

            this.configCache.set(name, config);

            this.logger.info(`Successfully connected and cached new server '${name}'`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorCode =
                error && typeof error === 'object' && 'code' in error
                    ? String((error as { code?: unknown }).code)
                    : undefined;
            this.connectionErrors[name] = {
                message: errorMsg,
                ...(errorCode ? { code: errorCode } : {}),
            };
            this.logger.error(`Failed to connect to new server '${name}': ${errorMsg}`);
            this.clients.delete(name);
            throw MCPError.connectionFailed(name, errorMsg);
        }
    }

    
    getClients(): Map<string, McpClient> {
        return this.clients;
    }

    
    getFailedConnections(): { [key: string]: { message: string; code?: string } } {
        return this.connectionErrors;
    }

    getFailedConnectionError(name: string): string | undefined {
        return this.connectionErrors[name]?.message;
    }

    getFailedConnectionErrorCode(name: string): string | undefined {
        return this.connectionErrors[name]?.code;
    }

    getAuthProvider(name: string) {
        const client = this.clients.get(name);
        if (client instanceof FiusMcpClient) {
            return client.getCurrentAuthProvider();
        }
        return null;
    }

    getServerConfig(name: string): ValidatedMcpServerConfig | undefined {
        return this.configCache.get(name);
    }

    
    async refresh(): Promise<void> {
        this.logger.debug('Refreshing all MCPManager caches...');
        const refreshPromises: Promise<void>[] = [];

        for (const [clientName, client] of this.clients.entries()) {
            refreshPromises.push(this.updateClientCache(clientName, client));
        }

        await Promise.all(refreshPromises);
        this.logger.debug(
            `✅ MCPManager cache refresh complete for ${this.clients.size} client(s)`
        );
    }

    
    async removeClient(name: string): Promise<void> {
        const client = this.clients.get(name);
        if (client) {
            try {
                await client.disconnect();
                this.logger.info(`Successfully disconnected client: ${name}`);
            } catch (error) {
                this.logger.error(
                    `Error disconnecting client '${name}': ${error instanceof Error ? error.message : String(error)}`
                );
            }
            this.clearClientCache(name);
            this.clients.delete(name);
            this.configCache.delete(name);
            this.logger.info(`Removed client from manager: ${name}`);
        }
        if (this.connectionErrors[name]) {
            delete this.connectionErrors[name];
            this.logger.info(`Cleared connection error for removed client: ${name}`);
        }
    }

    
    async restartServer(name: string): Promise<void> {
        const config = this.configCache.get(name);
        if (!config) {
            throw MCPError.serverNotFound(
                name,
                'Server config not found - cannot restart dynamically added servers without stored config'
            );
        }

        const client = this.clients.get(name);

        this.logger.info(`Restarting MCP server '${name}'...`);

        if (client) {
            try {
                await client.disconnect();
                this.logger.info(`Disconnected server '${name}' for restart`);
            } catch (error) {
                this.logger.warn(
                    `Error disconnecting server '${name}' during restart (continuing): ${error instanceof Error ? error.message : String(error)}`
                );
            }
        } else {
            this.logger.info(
                `No active client found for '${name}' during restart; attempting fresh connection`
            );
        }

        this.clearClientCache(name);
        this.clients.delete(name);
        delete this.connectionErrors[name];

        try {
            const newClient = new FiusMcpClient(this.logger);
            newClient.setAuthProviderFactory(this.authProviderFactory);
            await newClient.connect(config, name);

            if (this.approvalManager) {
                newClient.setApprovalManager(this.approvalManager);
            }

            this.registerClient(name, newClient);
            await this.updateClientCache(name, newClient);

            this.logger.info(`Successfully restarted server '${name}'`);

            this.eventBus.emit('mcp:server-restarted', { serverName: name });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorCode =
                error && typeof error === 'object' && 'code' in error
                    ? String((error as { code?: unknown }).code)
                    : undefined;
            this.connectionErrors[name] = {
                message: errorMsg,
                ...(errorCode ? { code: errorCode } : {}),
            };
            this.logger.error(`Failed to restart server '${name}': ${errorMsg}`);
            throw MCPError.connectionFailed(name, errorMsg);
        }
    }

    
    async disconnectAll(): Promise<void> {
        const disconnectPromises: Promise<void>[] = [];
        for (const [name, client] of Array.from(this.clients.entries())) {
            disconnectPromises.push(
                client
                    .disconnect()
                    .then(() => this.logger.debug(`Disconnected client: ${name}`))
                    .catch((error) =>
                        this.logger.error(`Failed to disconnect client '${name}': ${error}`)
                    )
            );
        }
        await Promise.all(disconnectPromises);

        this.clients.clear();
        this.connectionErrors = {};
        this.configCache.clear();
        this.toolCache.clear();
        this.toolConflicts.clear();
        this.promptCache.clear();
        this.resourceCache.clear();
        this.sanitizedNameToServerMap.clear();
        this.logger.debug('Disconnected all clients and cleared caches.');
    }

    
    private setupClientNotifications(clientName: string, client: McpClient): void {
        try {
            client.on('resourceUpdated', async (params: { uri: string }) => {
                this.logger.debug(
                    `Received resource update notification from ${clientName}: ${params.uri}`
                );
                await this.handleResourceUpdated(clientName, params);
            });

            client.on('promptsListChanged', async () => {
                this.logger.debug(`Received prompts list change notification from ${clientName}`);
                await this.handlePromptsListChanged(clientName, client);
            });

            client.on('toolsListChanged', async () => {
                this.logger.debug(`Received tools list change notification from ${clientName}`);
                await this.handleToolsListChanged(clientName, client);
            });

            this.logger.debug(`Set up notification listeners for client: ${clientName}`);
        } catch (error) {
            this.logger.warn(`Failed to set up notification listeners for ${clientName}: ${error}`);
        }
    }

    
    private async handleResourceUpdated(
        serverName: string,
        params: { uri: string }
    ): Promise<void> {
        try {
            const client = this.clients.get(serverName);
            if (client) {
                const key = this.buildQualifiedResourceKey(serverName, params.uri);

                try {
                    const resources = await client.listResources();
                    const updatedResource = resources.find((r) => r.uri === params.uri);

                    if (updatedResource) {
                        this.resourceCache.set(key, {
                            serverName,
                            client,
                            summary: updatedResource,
                        });
                        this.logger.debug(`Updated resource cache for: ${params.uri}`);
                    }
                } catch (error) {
                    this.logger.warn(`Failed to refresh resource ${params.uri}: ${error}`);
                }
            }

            this.eventBus.emit('mcp:resource-updated', {
                serverName,
                resourceUri: params.uri,
            });
        } catch (error) {
            this.logger.error(`Error handling resource update: ${error}`);
        }
    }

    
    private async handlePromptsListChanged(serverName: string, client: McpClient): Promise<void> {
        try {
            const existingPrompts = Array.from(this.promptCache.entries())
                .filter(([_, entry]) => entry.client === client)
                .map(([promptName]) => promptName);

            existingPrompts.forEach((promptName) => {
                this.promptCache.delete(promptName);
            });

            try {
                const newPrompts: Prompt[] = await client.listPrompts();

                for (const prompt of newPrompts) {
                    const definition: PromptDefinition = {
                        name: prompt.name,
                        ...(prompt.title && { title: prompt.title }),
                        ...(prompt.description && { description: prompt.description }),
                        ...(prompt.arguments && { arguments: prompt.arguments }),
                    };

                    this.promptCache.set(prompt.name, {
                        serverName,
                        client,
                        definition,
                    });
                }

                const promptNames = newPrompts.map((p) => p.name);
                this.logger.debug(
                    `Updated prompts cache for ${serverName}: [${promptNames.join(', ')}]`
                );

                this.eventBus.emit('mcp:prompts-list-changed', {
                    serverName,
                    prompts: promptNames,
                });
            } catch (error) {
                this.logger.warn(`Failed to refresh prompts for ${serverName}: ${error}`);
            }
        } catch (error) {
            this.logger.error(`Error handling prompts list change: ${error}`);
        }
    }

    
    private async handleToolsListChanged(serverName: string, client: McpClient): Promise<void> {
        try {
            const removedToolBaseNames = new Set<string>();
            for (const [toolKey, entry] of Array.from(this.toolCache.entries())) {
                if (entry.serverName === serverName) {
                    const delimiterIndex = toolKey.lastIndexOf(MCPManager.SERVER_DELIMITER);
                    const baseName =
                        delimiterIndex === -1
                            ? toolKey
                            : toolKey.substring(
                                  delimiterIndex + MCPManager.SERVER_DELIMITER.length
                              );
                    removedToolBaseNames.add(baseName);
                    this.toolCache.delete(toolKey);
                }
            }

            try {
                const tools = await client.getTools();
                const toolNames = Object.keys(tools);

                this.logger.debug(
                    `🔧 Refreshing tools from server '${serverName}': [${toolNames.join(', ')}]`
                );

                for (const toolName in tools) {
                    const toolDef = tools[toolName];
                    if (!toolDef) continue;

                    const existingEntry = this.toolCache.get(toolName);
                    if (existingEntry && existingEntry.serverName !== serverName) {
                        this.toolConflicts.add(toolName);
                        this.toolCache.delete(toolName);

                        const existingSanitized = this.sanitizeServerName(existingEntry.serverName);
                        const existingQualified = `${existingSanitized}${MCPManager.SERVER_DELIMITER}${toolName}`;
                        this.toolCache.set(existingQualified, existingEntry);

                        const newSanitized = this.sanitizeServerName(serverName);
                        const newQualified = `${newSanitized}${MCPManager.SERVER_DELIMITER}${toolName}`;
                        this.toolCache.set(newQualified, {
                            serverName,
                            client,
                            definition: toolDef,
                        });

                        this.logger.warn(
                            `⚠️  Tool conflict detected for '${toolName}' - using server prefixes: ${existingQualified}, ${newQualified}`
                        );
                    } else if (this.toolConflicts.has(toolName)) {
                        const sanitizedName = this.sanitizeServerName(serverName);
                        const qualifiedName = `${sanitizedName}${MCPManager.SERVER_DELIMITER}${toolName}`;
                        this.toolCache.set(qualifiedName, {
                            serverName,
                            client,
                            definition: toolDef,
                        });
                        this.logger.debug(`✅ Tool '${qualifiedName}' cached (known conflict)`);
                    } else {
                        this.toolCache.set(toolName, {
                            serverName,
                            client,
                            definition: toolDef,
                        });
                        this.logger.debug(`✅ Tool '${toolName}' mapped to ${serverName}`);
                    }
                }

                for (const baseName of removedToolBaseNames) {
                    const remainingTools = Array.from(this.toolCache.entries()).filter(
                        ([key, _]) => {
                            const delimiterIndex = key.lastIndexOf(MCPManager.SERVER_DELIMITER);
                            const bn =
                                delimiterIndex === -1
                                    ? key
                                    : key.substring(
                                          delimiterIndex + MCPManager.SERVER_DELIMITER.length
                                      );
                            return bn === baseName;
                        }
                    );

                    if (remainingTools.length === 0) {
                        this.toolConflicts.delete(baseName);
                    } else if (remainingTools.length === 1 && this.toolConflicts.has(baseName)) {
                        const singleTool = remainingTools[0];
                        if (singleTool) {
                            const [qualifiedKey, entry] = singleTool;
                            this.toolCache.delete(qualifiedKey);
                            this.toolCache.set(baseName, entry);
                            this.toolConflicts.delete(baseName);
                            this.logger.debug(
                                `Restored tool '${baseName}' to simple name (conflict resolved)`
                            );
                        }
                    }
                }

                this.logger.debug(
                    `Updated tools cache for ${serverName}: [${toolNames.join(', ')}]`
                );

                this.eventBus.emit('mcp:tools-list-changed', {
                    serverName,
                    tools: toolNames,
                });
            } catch (error) {
                this.logger.warn(`Failed to refresh tools for ${serverName}: ${error}`);
            }
        } catch (error) {
            this.logger.error(`Error handling tools list change: ${error}`);
        }
    }
}
