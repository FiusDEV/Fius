import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Env } from 'hono';
import {
    AgentError,
    logger,
    MCPError,
    McpServerConfigSchema,
    MCP_CONNECTION_STATUSES,
} from '@fiusdev/core';
import { updateAgentConfigFile } from '@fiusdev/agent-management';
import {
    ApiErrorResponseSchema,
    BadRequestErrorResponse,
    InternalErrorResponse,
    JsonObjectSchema,
    JsonValueSchema,
    ToolInputSchema,
} from '../schemas/responses.js';
import type { GetAgentConfigPathFn, GetAgentFn, OpenAPIRouteSchema } from '../types.js';

const McpServerRequestSchema = z
    .object({
        name: z.string().min(1, 'Server name is required').describe('A unique name for the server'),
        config: McpServerConfigSchema.describe('The server configuration object'),
        persistToAgent: z
            .boolean()
            .optional()
            .describe('If true, saves the server to agent configuration file'),
    })
    .strict()
    .describe('Request body for adding or updating an MCP server');

const McpServerUpdateSchema = z
    .object({
        config: McpServerConfigSchema.describe('The updated server configuration object'),
        persistToAgent: z
            .boolean()
            .optional()
            .describe('If true, saves the server to agent configuration file'),
    })
    .strict()
    .describe('Request body for updating an MCP server');

const ExecuteToolBodySchema = JsonObjectSchema.describe(
    "Tool execution parameters as JSON object. The specific fields depend on the tool being executed and are defined by the tool's inputSchema."
);

const ServerStatusResponseSchema = z
    .object({
        status: z.string().describe('Connection status'),
        name: z.string().describe('Server name'),
    })
    .strict()
    .describe('Server status response');

const ServerInfoSchema = z
    .object({
        id: z.string().describe('Server identifier'),
        name: z.string().describe('Server name'),
        status: z.enum(MCP_CONNECTION_STATUSES).describe('Server status'),
    })
    .strict()
    .describe('MCP server information');

const ServersListResponseSchema = z
    .object({
        servers: z.array(ServerInfoSchema).describe('Array of server information'),
    })
    .strict()
    .describe('List of MCP servers');

const ToolInfoSchema = z
    .object({
        id: z.string().describe('Tool identifier'),
        name: z.string().describe('Tool name'),
        description: z.string().describe('Tool description'),
        inputSchema: ToolInputSchema.optional().describe('JSON Schema for tool input parameters'),
        _meta: JsonObjectSchema.optional().describe(
            'Optional tool metadata (e.g., MCP Apps UI resource info)'
        ),
    })
    .strict()
    .describe('Tool information');

type ToolInfo = z.output<typeof ToolInfoSchema>;

const ToolsListResponseSchema = z
    .object({
        tools: z.array(ToolInfoSchema).describe('Array of available tools'),
    })
    .strict()
    .describe('List of tools from MCP server');

type ToolsListResponse = z.output<typeof ToolsListResponseSchema>;

const DisconnectResponseSchema = z
    .object({
        status: z.literal('disconnected').describe('Disconnection status'),
        id: z.string().describe('Server identifier'),
    })
    .strict()
    .describe('Server disconnection response');

type DisconnectResponse = z.output<typeof DisconnectResponseSchema>;

const RestartResponseSchema = z
    .object({
        status: z.literal('restarted').describe('Restart status'),
        id: z.string().describe('Server identifier'),
    })
    .strict()
    .describe('Server restart response');

type RestartResponse = z.output<typeof RestartResponseSchema>;

const ToolExecutionResponseSchema = z
    .object({
        success: z.boolean().describe('Whether tool execution succeeded'),
        data: JsonValueSchema.optional().describe('Tool execution result data'),
        error: z.string().optional().describe('Error message if execution failed'),
    })
    .strict()
    .describe('Tool execution response');

type ToolExecutionResponse = z.output<typeof ToolExecutionResponseSchema>;

const ServerConfigResponseSchema = z
    .object({
        name: z.string().describe('Server name'),
        config: McpServerConfigSchema.describe('Server configuration'),
    })
    .strict()
    .describe('MCP server configuration response');

const ServerResourceSchema = z
    .object({
        uri: z.string().describe('Resolved resource URI for this server'),
        name: z.string().describe('Resource display name'),
        originalUri: z.string().describe('Original MCP resource URI'),
        serverName: z.string().describe('Owning MCP server name'),
    })
    .strict()
    .describe('Resource exposed by a specific MCP server');

const ResourcesListResponseSchema = z
    .object({
        success: z.boolean().describe('Success indicator'),
        resources: z.array(ServerResourceSchema).describe('Array of available resources'),
    })
    .strict()
    .describe('List of resources from MCP server');

type ResourcesListResponse = z.output<typeof ResourcesListResponseSchema>;

const ResourceContentSchema = z
    .object({
        content: JsonValueSchema.describe('Resource content data'),
    })
    .strict()
    .describe('Resource content wrapper');

const ResourceContentResponseSchema = z
    .object({
        success: z.boolean().describe('Success indicator'),
        data: ResourceContentSchema.describe('Resource content'),
    })
    .strict()
    .describe('Resource content response');

type ResourceContentResponse = z.output<typeof ResourceContentResponseSchema>;

function mountMcpSubrouter(app: OpenAPIHono, router: OpenAPIHono) {
    app.route('/', router);
}

const addServerRoute = createRoute({
    method: 'post',
    path: '/mcp/servers',
    summary: 'Add MCP Server',
    description: 'Connects a new MCP server dynamically',
    tags: ['mcp'],
    request: { body: { content: { 'application/json': { schema: McpServerRequestSchema } } } },
    responses: {
        200: {
            description: 'Server connected',
            content: { 'application/json': { schema: ServerStatusResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const listServersRoute = createRoute({
    method: 'get',
    path: '/mcp/servers',
    summary: 'List MCP Servers',
    description: 'Gets a list of all connected and failed MCP servers',
    tags: ['mcp'],
    responses: {
        200: {
            description: 'Servers list',
            content: { 'application/json': { schema: ServersListResponseSchema } },
        },
        500: InternalErrorResponse,
    },
});

const getServerConfigRoute = createRoute({
    method: 'get',
    path: '/mcp/servers/{serverId}/config',
    summary: 'Get MCP Server Config',
    description: 'Retrieves the configuration for a specific MCP server',
    tags: ['mcp'],
    request: {
        params: z.object({ serverId: z.string().describe('The ID of the MCP server') }),
    },
    responses: {
        200: {
            description: 'Server configuration',
            content: { 'application/json': { schema: ServerConfigResponseSchema } },
        },
        404: {
            description: 'Not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
    },
});

const updateServerRoute = createRoute({
    method: 'put',
    path: '/mcp/servers/{serverId}',
    summary: 'Update MCP Server',
    description: 'Updates configuration for an existing MCP server',
    tags: ['mcp'],
    request: {
        params: z.object({ serverId: z.string().describe('The ID of the MCP server') }),
        body: { content: { 'application/json': { schema: McpServerUpdateSchema } } },
    },
    responses: {
        200: {
            description: 'Server updated',
            content: { 'application/json': { schema: ServerStatusResponseSchema } },
        },
        404: {
            description: 'Not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
    },
});

const toolsRoute = createRoute({
    method: 'get',
    path: '/mcp/servers/{serverId}/tools',
    summary: 'List Server Tools',
    description: 'Retrieves the list of tools available on a specific MCP server',
    tags: ['mcp'],
    request: {
        params: z.object({ serverId: z.string().describe('The ID of the MCP server') }),
    },
    responses: {
        200: {
            description: 'Tools list',
            content: { 'application/json': { schema: ToolsListResponseSchema } },
        },
        404: {
            description: 'Not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
    },
});

const deleteServerRoute = createRoute({
    method: 'delete',
    path: '/mcp/servers/{serverId}',
    summary: 'Remove MCP Server',
    description: 'Disconnects and removes an MCP server',
    tags: ['mcp'],
    request: {
        params: z.object({ serverId: z.string().describe('The ID of the MCP server') }),
    },
    responses: {
        200: {
            description: 'Disconnected',
            content: { 'application/json': { schema: DisconnectResponseSchema } },
        },
        404: {
            description: 'Not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
    },
});

const restartServerRoute = createRoute({
    method: 'post',
    path: '/mcp/servers/{serverId}/restart',
    summary: 'Restart MCP Server',
    description: 'Restarts a connected MCP server',
    tags: ['mcp'],
    request: {
        params: z.object({ serverId: z.string().describe('The ID of the MCP server') }),
    },
    responses: {
        200: {
            description: 'Server restarted',
            content: { 'application/json': { schema: RestartResponseSchema } },
        },
        404: {
            description: 'Not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
    },
});

const execToolRoute = createRoute({
    method: 'post',
    path: '/mcp/servers/{serverId}/tools/{toolName}/execute',
    summary: 'Execute MCP Tool',
    description: 'Executes a tool on an MCP server directly',
    tags: ['mcp'],
    request: {
        params: z.object({
            serverId: z.string().describe('The ID of the MCP server'),
            toolName: z.string().describe('The name of the tool to execute'),
        }),
        body: { content: { 'application/json': { schema: ExecuteToolBodySchema } } },
    },
    responses: {
        200: {
            description: 'Tool executed',
            content: { 'application/json': { schema: ToolExecutionResponseSchema } },
        },
        404: {
            description: 'Not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
    },
});

const listResourcesRoute = createRoute({
    method: 'get',
    path: '/mcp/servers/{serverId}/resources',
    summary: 'List Server Resources',
    description: 'Retrieves all resources available from a specific MCP server',
    tags: ['mcp'],
    request: {
        params: z.object({ serverId: z.string().describe('The ID of the MCP server') }),
    },
    responses: {
        200: {
            description: 'Server resources',
            content: { 'application/json': { schema: ResourcesListResponseSchema } },
        },
        404: {
            description: 'Not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
    },
});

const getResourceContentRoute = createRoute({
    method: 'get',
    path: '/mcp/servers/{serverId}/resources/{resourceId}/content',
    summary: 'Read Server Resource Content',
    description:
        'Reads content from a specific resource on an MCP server. This endpoint automatically constructs the qualified URI format (mcp:serverId:resourceId)',
    tags: ['mcp'],
    request: {
        params: z.object({
            serverId: z.string().describe('The ID of the MCP server'),
            resourceId: z
                .string()
                .min(1, 'Resource ID is required')
                .transform((encoded) => decodeURIComponent(encoded))
                .describe('The URI-encoded resource identifier on that server'),
        }),
    },
    responses: {
        200: {
            description: 'Resource content',
            content: { 'application/json': { schema: ResourceContentResponseSchema } },
        },
        404: {
            description: 'Not found',
            content: { 'application/json': { schema: ApiErrorResponseSchema } },
        },
    },
});

export function createMcpRouter(
    getAgent: GetAgentFn,
    getAgentConfigPath: GetAgentConfigPathFn
): OpenAPIHono<Env, McpRouterSchema> {
    const app = new OpenAPIHono<Env, McpRouterSchema>();
const serverRegistrationRouter = new OpenAPIHono()
        .openapi(addServerRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { name, config, persistToAgent } = ctx.req.valid('json');

            await agent.addMcpServer(name, config);
            const isConnected = config.enabled !== false;
            logger.info(
                isConnected
                    ? `Successfully connected to new server '${name}' via API request.`
                    : `Registered server '${name}' (disabled) via API request.`
            );

            if (persistToAgent === true) {
                try {
                    const agentPath = await getAgentConfigPath(ctx);
                    if (!agentPath) {
                        throw AgentError.noConfigPath();
                    }

                    const currentConfig = agent.getEffectiveConfig();

                    const updates = {
                        mcpServers: {
                            ...(currentConfig.mcpServers || {}),
                            [name]: config,
                        },
                    };

                    await updateAgentConfigFile(agentPath, updates);
                    logger.info(`Saved server '${name}' to agent configuration file`);
                } catch (saveError) {
                    const errorMessage =
                        saveError instanceof Error ? saveError.message : String(saveError);
                    logger.warn(
                        `Failed to save server '${name}' to agent config: ${errorMessage}`,
                        {
                            error: saveError,
                        }
                    );
                }
            }

            const status = isConnected ? 'connected' : 'registered';
            return ctx.json({ status, name }, 200);
        })
        .openapi(listServersRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const clientsMap = agent.getMcpClients();
            const failedConnections = agent.getMcpFailedConnections();
            const allConfig = agent.getEffectiveConfig().mcpServers || {};
            const servers: z.output<typeof ServerInfoSchema>[] = [];
            const seen = new Set<string>();
            for (const name of clientsMap.keys()) {
                servers.push({ id: name, name, status: 'connected' });
                seen.add(name);
            }
            for (const name of Object.keys(failedConnections)) {
                if (!seen.has(name)) {
                    servers.push({ id: name, name, status: 'error' });
                    seen.add(name);
                }
            }
            for (const [name, cfg] of Object.entries(allConfig)) {
                if (!seen.has(name) && cfg.enabled === false) {
                    servers.push({ id: name, name, status: 'disconnected' });
                }
            }
            return ctx.json({ servers }, 200);
        })
        .openapi(getServerConfigRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { serverId } = ctx.req.valid('param');
            const config = agent.getMcpServerConfig(serverId);
            if (!config) {
                throw MCPError.serverNotFound(serverId);
            }
            return ctx.json({ name: serverId, config: McpServerConfigSchema.parse(config) }, 200);
        });

    const serverUpdateRouter = new OpenAPIHono().openapi(updateServerRoute, async (ctx) => {
        const agent = await getAgent(ctx);
        const { serverId } = ctx.req.valid('param');
        const { config, persistToAgent } = ctx.req.valid('json');

        const existingConfig = agent.getMcpServerConfig(serverId);
        if (!existingConfig) {
            throw MCPError.serverNotFound(serverId);
        }

        await agent.updateMcpServer(serverId, config);

        if (persistToAgent === true) {
            try {
                const agentPath = await getAgentConfigPath(ctx);
                if (!agentPath) {
                    throw AgentError.noConfigPath();
                }

                const currentConfig = agent.getEffectiveConfig();
                const updates = {
                    mcpServers: {
                        ...(currentConfig.mcpServers || {}),
                        [serverId]: config,
                    },
                };

                await updateAgentConfigFile(agentPath, updates);
                logger.info(`Saved server '${serverId}' to agent configuration file`);
            } catch (saveError) {
                const errorMessage =
                    saveError instanceof Error ? saveError.message : String(saveError);
                logger.warn(`Failed to persist MCP server '${serverId}' update: ${errorMessage}`, {
                    error: saveError,
                });
            }
        }

        const status = config.enabled === false ? 'registered' : 'connected';
        return ctx.json({ status, name: serverId }, 200);
    });

    const serverToolsRouter = new OpenAPIHono().openapi(toolsRoute, async (ctx) => {
        const agent = await getAgent(ctx);
        const { serverId } = ctx.req.valid('param');
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            throw MCPError.serverNotFound(serverId);
        }
        const toolsMap = await client.getTools();
        const tools: ToolInfo[] = Object.entries(toolsMap).map(([toolName, toolDef]) => ({
            id: toolName,
            name: toolName,
            description: toolDef.description || '',
            inputSchema:
                toolDef.parameters === undefined
                    ? undefined
                    : ToolInputSchema.parse(toolDef.parameters),
            _meta: toolDef._meta === undefined ? undefined : JsonObjectSchema.parse(toolDef._meta),
        }));
        const response: ToolsListResponse = { tools };
        return ctx.json(response, 200);
    });

    const deleteServerRouter = new OpenAPIHono().openapi(deleteServerRoute, async (ctx) => {
        const agent = await getAgent(ctx);
        const { serverId } = ctx.req.valid('param');
        const clientExists =
            agent.getMcpClients().has(serverId) || agent.getMcpFailedConnections()[serverId];
        if (!clientExists) {
            throw MCPError.serverNotFound(serverId);
        }

        await agent.removeMcpServer(serverId);
        const response: DisconnectResponse = { status: 'disconnected', id: serverId };
        return ctx.json(response, 200);
    });

    const restartServerRouter = new OpenAPIHono().openapi(restartServerRoute, async (ctx) => {
        const agent = await getAgent(ctx);
        const { serverId } = ctx.req.valid('param');
        logger.info(`Received request to POST /api/mcp/servers/${serverId}/restart`);

        const clientExists = agent.getMcpClients().has(serverId);
        const failedExists = agent.getMcpFailedConnections()[serverId];

        if (!clientExists && !failedExists) {
            logger.warn(`Attempted to restart non-existent server: ${serverId}`);
            throw MCPError.serverNotFound(serverId);
        }

        if (clientExists) {
            await agent.restartMcpServer(serverId);
        } else {
            const config = agent.getEffectiveConfig().mcpServers?.[serverId];
            if (!config) {
                throw MCPError.serverNotFound(serverId);
            }
            await agent.removeMcpServer(serverId);
            await agent.addMcpServer(serverId, config);
        }

        const response: RestartResponse = { status: 'restarted', id: serverId };
        return ctx.json(response, 200);
    });

    const execToolRouter = new OpenAPIHono().openapi(execToolRoute, async (ctx) => {
        const agent = await getAgent(ctx);
        const { serverId, toolName } = ctx.req.valid('param');
        const body = ctx.req.valid('json');
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            throw MCPError.serverNotFound(serverId);
        }
        try {
            const rawResult = await client.callTool(toolName, body);
            const response: ToolExecutionResponse = {
                success: true,
                data: JsonValueSchema.parse(rawResult),
            };
            return ctx.json(response, 200);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(
                `Tool execution failed for '${toolName}' on server '${serverId}': ${errorMessage}`,
                { error }
            );
            const response: ToolExecutionResponse = {
                success: false,
                error: errorMessage,
            };
            return ctx.json(response, 200);
        }
    });

    const listResourcesRouter = new OpenAPIHono().openapi(listResourcesRoute, async (ctx) => {
        const agent = await getAgent(ctx);
        const { serverId } = ctx.req.valid('param');
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            throw MCPError.serverNotFound(serverId);
        }
        const resources = await agent.listResourcesForServer(serverId);
        const response: ResourcesListResponse = { success: true, resources };
        return ctx.json(response, 200);
    });

    const getResourceContentRouter = new OpenAPIHono().openapi(
        getResourceContentRoute,
        async (ctx) => {
            const agent = await getAgent(ctx);
            const { serverId, resourceId } = ctx.req.valid('param');
            const client = agent.getMcpClients().get(serverId);
            if (!client) {
                throw MCPError.serverNotFound(serverId);
            }
            const qualifiedUri = `mcp:${serverId}:${resourceId}`;
            const content = await agent.readResource(qualifiedUri);
            const response: ResourceContentResponse = {
                success: true,
                data: { content: JsonValueSchema.parse(content) },
            };
            return ctx.json(response, 200);
        }
    );

    mountMcpSubrouter(app, serverRegistrationRouter);
    mountMcpSubrouter(app, serverUpdateRouter);
    mountMcpSubrouter(app, serverToolsRouter);
    mountMcpSubrouter(app, deleteServerRouter);
    mountMcpSubrouter(app, restartServerRouter);
    mountMcpSubrouter(app, execToolRouter);
    mountMcpSubrouter(app, listResourcesRouter);
    mountMcpSubrouter(app, getResourceContentRouter);

    return app;
}

type ServerIdParamInput = { param: { serverId: string } };

type AddServerRouteSchema = OpenAPIRouteSchema<
    typeof addServerRoute,
    { json: z.input<typeof McpServerRequestSchema> }
>;
type ListServersRouteSchema = OpenAPIRouteSchema<typeof listServersRoute, {}>;
type GetServerConfigRouteSchema = OpenAPIRouteSchema<
    typeof getServerConfigRoute,
    ServerIdParamInput
>;
type UpdateServerRouteSchema = OpenAPIRouteSchema<
    typeof updateServerRoute,
    ServerIdParamInput & { json: z.input<typeof McpServerUpdateSchema> }
>;
type ToolsRouteSchema = OpenAPIRouteSchema<typeof toolsRoute, ServerIdParamInput>;
type DeleteServerRouteSchema = OpenAPIRouteSchema<typeof deleteServerRoute, ServerIdParamInput>;
type RestartServerRouteSchema = OpenAPIRouteSchema<typeof restartServerRoute, ServerIdParamInput>;
type ExecToolRouteSchema = OpenAPIRouteSchema<
    typeof execToolRoute,
    { param: { serverId: string; toolName: string }; json: z.input<typeof ExecuteToolBodySchema> }
>;
type ListResourcesRouteSchema = OpenAPIRouteSchema<typeof listResourcesRoute, ServerIdParamInput>;
type GetResourceContentRouteSchema = OpenAPIRouteSchema<
    typeof getResourceContentRoute,
    { param: { serverId: string; resourceId: string } }
>;

export type McpRouterSchema =
    | AddServerRouteSchema
    | ListServersRouteSchema
    | GetServerConfigRouteSchema
    | UpdateServerRouteSchema
    | ToolsRouteSchema
    | DeleteServerRouteSchema
    | RestartServerRouteSchema
    | ExecToolRouteSchema
    | ListResourcesRouteSchema
    | GetResourceContentRouteSchema;
