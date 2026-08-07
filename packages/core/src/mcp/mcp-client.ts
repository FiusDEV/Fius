import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { AsyncLocalStorage } from 'async_hooks';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { EventEmitter } from 'events';
import { z } from 'zod';

import type { Logger } from '../logger/v2/types.js';
import { FiusLogComponent } from '../logger/v2/types.js';
import type { ApprovalManager } from '../approval/manager.js';
import { ApprovalStatus } from '../approval/types.js';
import type {
    ValidatedMcpServerConfig,
    ValidatedStdioServerConfig,
    ValidatedSseServerConfig,
    ValidatedHttpServerConfig,
} from './schemas.js';
import type { ToolExecutionContextBase, ToolSet } from '../tools/types.js';
import type { McpClient, MCPResourceSummary, McpAuthProviderFactory } from './types.js';
import { MCPError } from './errors.js';
import type {
    GetPromptResult,
    ReadResourceResult,
    Resource,
    ResourceUpdatedNotification,
    Prompt,
} from '@modelcontextprotocol/sdk/types.js';
import {
    ResourceUpdatedNotificationSchema,
    PromptListChangedNotificationSchema,
    ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { safeStringify } from '../utils/safe-stringify.js';

const UI_EXTENSION_NAME = 'io.modelcontextprotocol/ui';
const UI_EXTENSION_MIME_TYPE = 'text/html;profile=mcp-app';

type McpClientCapabilities = {
    elicitation?: Record<string, unknown>;
    extensions?: Record<string, { mimeTypes: string[] }>;
};

function buildClientCapabilities(): McpClientCapabilities {
    return {
        elicitation: {},
        extensions: {
            [UI_EXTENSION_NAME]: {
                mimeTypes: [UI_EXTENSION_MIME_TYPE],
            },
        },
    };
}

export class FiusMcpClient extends EventEmitter implements McpClient {
    private readonly toolInvocationContext = new AsyncLocalStorage<
        Pick<ToolExecutionContextBase, 'sessionId' | 'runContext'> | undefined
    >();
    private client: Client | null = null;
    private transport: any = null;
    private isConnected = false;
    private serverCommand: string | null = null;
    private originalArgs: string[] | null = null;
    private resolvedArgs: string[] | null = null;
    private serverEnv: Record<string, string> | null = null;
    private serverSpawned = false;
    private serverPid: number | null = null;
    private serverAlias: string | null = null;
    private timeout: number = 60000;
    private approvalManager: ApprovalManager | null = null;
    private logger: Logger;
    private authProviderFactory: McpAuthProviderFactory | null = null;
    private currentAuthProvider: ReturnType<McpAuthProviderFactory> | null = null;

    constructor(logger: Logger) {
        super();
        this.logger = logger.createChild(FiusLogComponent.MCP);
    }

    setAuthProviderFactory(factory: McpAuthProviderFactory | null): void {
        this.authProviderFactory = factory;
    }

    getCurrentAuthProvider(): ReturnType<McpAuthProviderFactory> | null {
        return this.currentAuthProvider;
    }

    async connect(config: ValidatedMcpServerConfig, serverName: string): Promise<Client> {
        this.timeout = config.timeout ?? 30000;
        if (config.type === 'stdio') {
            const stdioConfig: ValidatedStdioServerConfig = config;

            return this.connectViaStdio(stdioConfig.command, stdioConfig.args, stdioConfig.env, serverName);
        } else if (config.type === 'sse') {
            const sseConfig: ValidatedSseServerConfig = config;
            return this.connectViaSSE(sseConfig.url, sseConfig.headers, serverName);
        } else if (config.type === 'http') {
            const httpConfig: ValidatedHttpServerConfig = config;
            return this.connectViaHttp(httpConfig.url, httpConfig.headers || {}, serverName);
        } else {
            const _exhaustive: never = config;
            throw MCPError.protocolError(`Unsupported server type: ${JSON.stringify(_exhaustive)}`);
        }
    }

    
    async connectViaStdio(
        command: string,
        args: string[] = [],
        env?: Record<string, string>,
        serverAlias?: string
    ): Promise<Client> {
        this.serverCommand = command;
        this.originalArgs = [...args];
        this.resolvedArgs = [...this.originalArgs];
        this.serverEnv = env || null;
        this.serverAlias = serverAlias || null;

        this.logger.info('=======================================');
        this.logger.info(`MCP SERVER: ${command} ${this.resolvedArgs.join(' ')}`);
        if (env) {
            this.logger.info('Environment:');
            Object.entries(env).forEach(([key, _]) => {
                this.logger.info(`  ${key}= [value hidden]`);
            });
        }
        this.logger.info('=======================================\n');

        const serverName = this.serverAlias
            ? `"${this.serverAlias}" (${command} ${this.resolvedArgs.join(' ')})`
            : `${command} ${this.resolvedArgs.join(' ')}`;
        this.logger.debug(`Connecting to MCP server: ${serverName}`);

        const expandedEnv = {
            ...process.env,
            npm_config_loglevel: 'error',
            ...(env || {}),
        };

        this.transport = new StdioClientTransport({
            command: command,
            args: this.resolvedArgs,
            env: expandedEnv as Record<string, string>,
            stderr: 'pipe',
        });

        this.client = new Client(
            {
                name: 'Fius-stdio-mcp-client',
                version: '1.0.0',
            },
            {
                capabilities: buildClientCapabilities(),
            }
        );

        try {
            this.logger.info('Establishing connection...');
            await this.client.connect(this.transport);

            this.serverSpawned = true;
            this.logger.info(`✅ Stdio SERVER ${serverName} SPAWNED`);
            this.logger.info('Connection established!\n\n');
            this.isConnected = true;
            this.setupNotificationHandlers();
            this.setupElicitationHandler();

            return this.client;
        } catch (error: any) {
            this.logger.error(
                `Failed to connect to MCP server ${serverName}: ${JSON.stringify(error.message, null, 2)}`
            );
            throw error;
        }
    }

    async connectViaSSE(
        url: string,
        headers: Record<string, string> = {},
        serverName: string
    ): Promise<Client> {
        this.logger.debug(`Connecting to SSE MCP server at url: ${url}`);

        const authConfig = {
            type: 'sse',
            enabled: true,
            url,
            headers,
            timeout: 30000,
            connectionMode: 'lenient',
        } as ValidatedMcpServerConfig;
        this.currentAuthProvider = this.authProviderFactory
            ? this.authProviderFactory(serverName, authConfig)
            : null;
        const sseOptions: ConstructorParameters<typeof SSEClientTransport>[1] = {
            requestInit: {
                headers: headers,
            },
        };
        if (this.currentAuthProvider) {
            sseOptions.authProvider = this.currentAuthProvider;
        }
        const buildSseTransport = () => new SSEClientTransport(new URL(url), sseOptions);
        this.transport = buildSseTransport();

        this.logger.debug('[connectViaSSE] SSE transport initialized');
        this.client = new Client(
            {
                name: 'Fius-sse-mcp-client',
                version: '1.0.0',
            },
            {
                capabilities: buildClientCapabilities(),
            }
        );

        try {
            this.logger.info('Establishing connection...');
            await this.client.connect(this.transport);
            this.serverSpawned = true;
            this.logger.info(`✅ ${serverName} SSE SERVER SPAWNED`);
            this.logger.info('Connection established!\n\n');
            this.isConnected = true;
            this.setupNotificationHandlers();
            this.setupElicitationHandler();

            return this.client;
        } catch (error: any) {
            if (error instanceof UnauthorizedError) {
                if (!this.currentAuthProvider) {
                    throw MCPError.authenticationRequired(
                        serverName,
                        'No OAuth provider available'
                    );
                }
                const authCode = await this.currentAuthProvider.waitForAuthorizationCode?.();
                if (!authCode) {
                    throw MCPError.authenticationRequired(
                        serverName,
                        'OAuth flow was not completed'
                    );
                }
                this.logger.info('Completing MCP OAuth flow...');
                await this.transport.finishAuth(authCode);
                this.transport = buildSseTransport();
                await this.client.connect(this.transport);
                this.isConnected = true;
                this.logger.info(`✅ ${serverName} SSE SERVER SPAWNED`);
                this.setupNotificationHandlers();
                this.setupElicitationHandler();
                return this.client;
            }
            this.logger.error(
                `Failed to connect to SSE MCP server ${url}: ${JSON.stringify(error.message, null, 2)}`
            );
            throw error;
        }
    }

    
    private async connectViaHttp(
        url: string,
        headers: Record<string, string> = {},
        serverAlias?: string
    ): Promise<Client> {
        this.logger.info(`Connecting to HTTP MCP server at ${url}`);
        const defaultHeaders = {
            Accept: 'application/json, text/event-stream',
        };
        const mergedHeaders = { ...defaultHeaders, ...headers };
        const authConfig = {
            type: 'http',
            enabled: true,
            url,
            headers,
            timeout: 30000,
            connectionMode: 'lenient',
        } as ValidatedMcpServerConfig;
        this.currentAuthProvider = this.authProviderFactory
            ? this.authProviderFactory(serverAlias ?? url, authConfig)
            : null;
        const httpOptions: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] = {
            requestInit: { headers: mergedHeaders },
        };
        if (this.currentAuthProvider) {
            httpOptions.authProvider = this.currentAuthProvider;
        }
        const buildHttpTransport = () =>
            new StreamableHTTPClientTransport(new URL(url), httpOptions);
        this.transport = buildHttpTransport();
        this.client = new Client(
            { name: 'Fius-http-mcp-client', version: '1.0.0' },
            {
                capabilities: buildClientCapabilities(),
            }
        );
        try {
            this.logger.info('Establishing HTTP connection...');
            await this.client.connect(this.transport);
            this.isConnected = true;
            this.logger.info(`✅ HTTP SERVER ${serverAlias ?? url} CONNECTED`);
            this.setupNotificationHandlers();
            this.setupElicitationHandler();
            return this.client;
        } catch (error: any) {
            if (error instanceof UnauthorizedError) {
                if (!this.currentAuthProvider) {
                    throw MCPError.authenticationRequired(
                        serverAlias ?? url,
                        'No OAuth provider available'
                    );
                }
                const authCode = await this.currentAuthProvider.waitForAuthorizationCode?.();
                if (!authCode) {
                    throw MCPError.authenticationRequired(
                        serverAlias ?? url,
                        'OAuth flow was not completed'
                    );
                }
                this.logger.info('Completing MCP OAuth flow...');
                await this.transport.finishAuth(authCode);
                this.transport = buildHttpTransport();
                await this.client.connect(this.transport);
                this.isConnected = true;
                this.logger.info(`✅ HTTP SERVER ${serverAlias ?? url} CONNECTED`);
                this.setupNotificationHandlers();
                this.setupElicitationHandler();
                return this.client;
            }
            this.logger.error(
                `Failed to connect to HTTP MCP server ${url}: ${JSON.stringify(error.message, null, 2)}`
            );
            throw error;
        }
    }

    
    async disconnect(): Promise<void> {
        if (this.transport && typeof this.transport.close === 'function') {
            try {
                await this.transport.close();
                this.isConnected = false;
                this.serverSpawned = false;
                this.logger.info('Disconnected from MCP server');
            } catch (error: any) {
                this.logger.error(
                    `Error disconnecting from MCP server: ${JSON.stringify(error.message, null, 2)}`
                );
            }
        }
    }

    
    async callTool(
        name: string,
        args: any,
        invocation?: Pick<ToolExecutionContextBase, 'sessionId' | 'runContext'>
    ): Promise<any> {
        this.ensureConnected();

        return await this.toolInvocationContext.run(invocation, async () => {
            try {
                this.logger.debug(
                    `Calling tool '${name}' with args: ${JSON.stringify(args, null, 2)}`
                );

                let toolArgs = args;
                if (typeof args === 'string') {
                    try {
                        toolArgs = JSON.parse(args);
                    } catch {
                        toolArgs = { input: args };
                    }
                }

                this.logger.debug(`Using timeout: ${this.timeout}`);

                const result = await this.client!.callTool(
                    { name, arguments: toolArgs },
                    undefined,
                    { timeout: this.timeout }
                );

                const logResult = JSON.stringify(
                    result,
                    (key, value) => {
                        if (key === 'data' && typeof value === 'string' && value.length > 100) {
                            return `[Base64 data: ${value.length} chars]`;
                        }
                        return value;
                    },
                    2
                );
                this.logger.debug(`Tool '${name}' result: ${logResult}`);

                if (result === null || result === undefined) {
                    return 'Tool executed successfully with no result data.';
                }
                return result;
            } catch (error) {
                this.logger.error(`Tool call '${name}' failed: ${JSON.stringify(error, null, 2)}`);

                return `Error executing tool '${name}': ${
                    error instanceof Error ? error.message : String(error)
                }`;
            }
        });
    }

    
    async getTools(): Promise<ToolSet> {
        this.ensureConnected();
        const tools: ToolSet = {};
        try {
            const listToolResult = await this.client!.listTools({});
            this.logger.silly(`listTools result: ${JSON.stringify(listToolResult, null, 2)}`);

            if (listToolResult && listToolResult.tools) {
                listToolResult.tools.forEach((tool: any) => {
                    if (!tool.description) {
                        this.logger.warn(`Tool '${tool.name}' is missing a description`);
                    }
                    if (!tool.inputSchema) {
                        throw MCPError.invalidToolSchema(tool.name, 'missing input schema');
                    }
                    tools[tool.name] = {
                        description: tool.description ?? '',
                        parameters: tool.inputSchema,
                        _meta: tool._meta,
                    };
                });
            } else {
                throw MCPError.protocolError(
                    'listTools did not return the expected structure: missing tools'
                );
            }
        } catch (error) {
            this.logger.warn(
                `Failed to get tools from MCP server, proceeding with zero tools: ${JSON.stringify(error, null, 2)}`
            );
            return tools;
        }
        return tools;
    }

    
    async listPrompts(): Promise<Prompt[]> {
        this.ensureConnected();
        try {
            const response = await this.client!.listPrompts();
            this.logger.debug(`listPrompts response: ${JSON.stringify(response, null, 2)}`);
            return response.prompts;
        } catch (error) {
            this.logger.debug(
                `Failed to list prompts from MCP server (optional feature), skipping: ${JSON.stringify(error, null, 2)}`
            );
            return [];
        }
    }

    
    async getPrompt(name: string, args?: any): Promise<GetPromptResult> {
        this.ensureConnected();
        try {
            this.logger.debug(
                `Getting prompt '${name}' with args: ${JSON.stringify(args, null, 2)}`
            );
            const response = await this.client!.getPrompt(
                { name, arguments: args },
                { timeout: this.timeout }
            );
            this.logger.debug(`getPrompt '${name}' response: ${JSON.stringify(response, null, 2)}`);
            return response;
        } catch (error: any) {
            this.logger.debug(
                `Failed to get prompt '${name}' from MCP server: ${JSON.stringify(error, null, 2)}`
            );
            throw MCPError.protocolError(
                `Error getting prompt '${name}': ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    
    async listResources(): Promise<MCPResourceSummary[]> {
        this.ensureConnected();
        try {
            const response = await this.client!.listResources();
            this.logger.debug(`listResources response: ${JSON.stringify(response, null, 2)}`);
            return response.resources.map(
                (r: Resource): MCPResourceSummary => ({
                    uri: r.uri,
                    name: r.name,
                    ...(r.description !== undefined && { description: r.description }),
                    ...(r.mimeType !== undefined && { mimeType: r.mimeType }),
                })
            );
        } catch (error) {
            this.logger.debug(
                `Failed to list resources from MCP server (optional feature), skipping: ${JSON.stringify(error, null, 2)}`
            );
            return [];
        }
    }

    
    async readResource(uri: string): Promise<ReadResourceResult> {
        this.ensureConnected();
        try {
            this.logger.debug(`Reading resource '${uri}'`);
            const response = await this.client!.readResource({ uri }, { timeout: this.timeout });
            this.logger.debug(
                `readResource '${uri}' response: ${JSON.stringify(response, null, 2)}`
            );
            return response;
        } catch (error: any) {
            this.logger.debug(
                `Failed to read resource '${uri}' from MCP server: ${JSON.stringify(error, null, 2)}`
            );
            throw MCPError.protocolError(
                `Error reading resource '${uri}': ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    
    getConnectionStatus(): boolean {
        return this.isConnected;
    }

    
    getClient(): Client | null {
        return this.client;
    }

    
    getServerInfo(): {
        spawned: boolean;
        pid: number | null;
        command: string | null;
        originalArgs: string[] | null;
        resolvedArgs: string[] | null;
        env: Record<string, string> | null;
        alias: string | null;
    } {
        return {
            spawned: this.serverSpawned,
            pid: this.serverPid,
            command: this.serverCommand,
            originalArgs: this.originalArgs,
            resolvedArgs: this.resolvedArgs,
            env: this.serverEnv,
            alias: this.serverAlias,
        };
    }

    
    async getConnectedClient(): Promise<Client> {
        if (!this.client || !this.isConnected) {
            throw MCPError.clientNotConnected();
        }
        return this.client;
    }

    private ensureConnected(): void {
        if (!this.isConnected || !this.client) {
            throw MCPError.clientNotConnected('Please call connect() first');
        }
    }

    
    private setupNotificationHandlers(): void {
        if (!this.client) return;

        try {
            this.client.setNotificationHandler(
                ResourceUpdatedNotificationSchema,
                (notification: ResourceUpdatedNotification) => {
                    this.handleResourceUpdated({
                        uri: notification.params.uri,
                    });
                }
            );
        } catch (error) {
            this.logger.warn(`Could not set resources/updated notification handler: ${error}`);
        }
        try {
            this.client.setNotificationHandler(PromptListChangedNotificationSchema, () => {
                this.handlePromptsListChanged();
            });
        } catch (error) {
            this.logger.warn(`Could not set prompts/list_changed notification handler: ${error}`);
        }
        try {
            this.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
                this.handleToolsListChanged();
            });
        } catch (error) {
            this.logger.warn(`Could not set tools/list_changed notification handler: ${error}`);
        }

        this.logger.debug('MCP notification handlers registered (resources, prompts, tools)');
    }

    
    private handleResourceUpdated(params: { uri: string }): void {
        this.logger.debug(`Resource updated: ${params.uri}`);
        this.emit('resourceUpdated', params);
    }

    
    private handlePromptsListChanged(): void {
        this.logger.debug('Prompts list changed');
        this.emit('promptsListChanged');
    }

    
    private handleToolsListChanged(): void {
        this.logger.debug('Tools list changed');
        this.emit('toolsListChanged');
    }

    
    setApprovalManager(approvalManager: ApprovalManager): void {
        this.approvalManager = approvalManager;
        if (this.client) {
            this.setupElicitationHandler();
        }
    }

    
    private setupElicitationHandler(): void {
        if (!this.client) {
            this.logger.warn('Cannot setup elicitation handler: client not initialized');
            return;
        }

        if (!this.approvalManager) {
            this.logger.warn('Cannot setup elicitation handler: approval manager not set');
            return;
        }

        const ElicitationCreateRequestSchema = z
            .object({
                method: z.literal('elicitation/create'),
                params: z
                    .object({
                        message: z.string(),
                        requestedSchema: z.unknown(),
                    })
                    .passthrough(),
            })
            .passthrough();

        this.client.setRequestHandler(ElicitationCreateRequestSchema, async (request) => {
            const params = request.params;
            this.logger.info(
                `Elicitation request from MCP server '${this.serverAlias}': ${params.message}`
            );

            try {
                if (!this.approvalManager) {
                    this.logger.error('Approval manager not available for elicitation request');
                    return { action: 'decline' };
                }

                if (
                    typeof params.requestedSchema !== 'object' ||
                    params.requestedSchema === null ||
                    Array.isArray(params.requestedSchema)
                ) {
                    this.logger.error(
                        `Invalid elicitation schema from '${this.serverAlias}': expected object, got ${typeof params.requestedSchema}`
                    );
                    return { action: 'decline' };
                }

                const invocation = this.toolInvocationContext.getStore();
                const response = await this.approvalManager.requestElicitation({
                    schema: params.requestedSchema as Record<string, unknown>,
                    prompt: params.message,
                    serverName: this.serverAlias || 'unknown',
                    ...(invocation?.sessionId !== undefined
                        ? { sessionId: invocation.sessionId }
                        : {}),
                    ...(invocation?.runContext?.hostRuntime !== undefined
                        ? { hostRuntime: invocation.runContext.hostRuntime }
                        : {}),
                });

                if (response.status === ApprovalStatus.APPROVED && response.data) {
                    const formData =
                        response.data &&
                        typeof response.data === 'object' &&
                        'formData' in response.data
                            ? (response.data as { formData: unknown }).formData
                            : {};
                    this.logger.info(
                        `Elicitation approved for '${this.serverAlias}', returning data`
                    );
                    return {
                        action: 'accept',
                        content: formData,
                    };
                } else if (response.status === ApprovalStatus.DENIED) {
                    this.logger.info(`Elicitation declined for '${this.serverAlias}'`);
                    return {
                        action: 'decline',
                    };
                } else {
                    this.logger.info(`Elicitation cancelled for '${this.serverAlias}'`);
                    return {
                        action: 'cancel',
                    };
                }
            } catch (error) {
                this.logger.error(`Elicitation error for '${this.serverAlias}': ${error}`);
                return {
                    action: 'decline',
                };
            }
        });

        this.logger.debug(`Elicitation handler registered for MCP server '${this.serverAlias}'`);
    }
}
