import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context, Hono } from 'hono';
import type { BlankEnv, ExtractSchema, MergeSchemaPath } from 'hono/types';
import type { Env, Schema } from 'hono/types';
import type { AgentCard } from '@fius/core';
import { logger, getFiusGlobalPath } from '@fius/core';
import { getFiusPackageRoot } from '@fius/agent-management';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import nodePath from 'node:path';
import { createHealthRouter } from './routes/health.js';
import { createGreetingRouter, type GreetingRouterSchema } from './routes/greeting.js';
import { createMessagesRouter, type MessagesRouterSchema } from './routes/messages.js';
import { createLlmRouter, type LlmRouterSchema } from './routes/llm.js';
import { createSessionsRouter, type SessionsRouterSchema } from './routes/sessions.js';
import { createSearchRouter, type SearchRouterSchema } from './routes/search.js';
import { createMcpRouter, type McpRouterSchema } from './routes/mcp.js';
import { createA2aRouter } from './routes/a2a.js';
import { createA2AJsonRpcRouter } from './routes/a2a-jsonrpc.js';
import { createA2ATasksRouter } from './routes/a2a-tasks.js';
import { createWebhooksRouter, type WebhooksRouterSchema } from './routes/webhooks.js';
import { createPromptsRouter, type PromptsRouterSchema } from './routes/prompts.js';
import { createResourcesRouter, type ResourcesRouterSchema } from './routes/resources.js';
import { createMemoryRouter, type MemoryRouterSchema } from './routes/memory.js';
import { createWorkspacesRouter, type WorkspacesRouterSchema } from './routes/workspaces.js';
import { createSchedulesRouter, type SchedulesRouterSchema } from './routes/schedules.js';
import { createSkillsRouter, type SkillsRouterSchema } from './routes/skills.js';
import {
    createAgentsRouter,
    type AgentsRouterContext,
    type AgentsRouterSchema,
} from './routes/agents.js';
import { createApprovalsRouter, type ApprovalsRouterSchema } from './routes/approvals.js';
import { createQueueRouter, type QueueRouterSchema } from './routes/queue.js';
import { createOpenRouterRouter, type OpenRouterRouterSchema } from './routes/openrouter.js';
import { createKeyRouter, type KeyRouterSchema } from './routes/key.js';
import { createToolsRouter, type ToolsRouterSchema } from './routes/tools.js';
import { createDiscoveryRouter, type DiscoveryRouterSchema } from './routes/discovery.js';
import { createModelsRouter, type ModelsRouterSchema } from './routes/models.js';
import { createFiusAuthRouter, type FiusAuthRouterSchema } from './routes/fius-auth.js';
import { createGitHubMcpRouter } from './routes/github-mcp.js';
import { createGitHubAgentsRouter } from './routes/github-agents.js';
import { createSystemPromptRouter, type SystemPromptRouterSchema } from './routes/system-prompt.js';
import {
    createStaticRouter,
    createSpaFallbackHandler,
    type WebUIRuntimeConfig,
} from './routes/static.js';
import { WebhookEventSubscriber } from '../events/webhook-subscriber.js';
import { A2ASseEventSubscriber } from '../events/a2a-sse-subscriber.js';
import { SessionSseEventSubscriber } from '../events/session-sse-subscriber.js';
import { handleHonoError } from './middleware/error.js';
import { prettyJsonMiddleware, redactionMiddleware } from './middleware/redaction.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { ApprovalCoordinator } from '../approval/approval-coordinator.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FiusApp, GetAgentConfigPathFn, GetAgentFn } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readPackageVersion(packageJsonPath: string): string | undefined {
    if (!existsSync(packageJsonPath)) {
        return undefined;
    }

    try {
        const content = readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(content) as { version?: unknown };
        if (typeof packageJson.version === 'string' && packageJson.version.length > 0) {
            return packageJson.version;
        }
    } catch {
    }

    return undefined;
}

function resolveServerVersion(): string {
    const localVersion = readPackageVersion(join(__dirname, '../../package.json'));
    if (localVersion) {
        return localVersion;
    }

    const packageRoot = getFiusPackageRoot();
    if (packageRoot) {
        const standaloneVersion = readPackageVersion(join(packageRoot, 'package.json'));
        if (standaloneVersion) {
            return standaloneVersion;
        }
    }

    return process.env.FIUS_CLI_VERSION ?? '0.0.0';
}

const serverVersion = resolveServerVersion();

const dummyAgentsContext: AgentsRouterContext = {
    switchAgentById: async () => {
        throw new Error('Multi-agent features not available in single-agent mode');
    },
    switchAgentByPath: async () => {
        throw new Error('Multi-agent features not available in single-agent mode');
    },
    resolveAgentInfo: async () => {
        throw new Error('Multi-agent features not available in single-agent mode');
    },
    ensureAgentAvailable: () => {},
    getActiveAgentId: () => undefined,
};

export type CreateFiusAppOptions = {
    apiPrefix?: string;
    getAgent: GetAgentFn;
    getAgentConfigPath?: GetAgentConfigPathFn;
    getAgentCard: () => AgentCard;
    approvalCoordinator: ApprovalCoordinator;
    webhookSubscriber: WebhookEventSubscriber;
    sseSubscriber: A2ASseEventSubscriber;
    sessionSseSubscriber: SessionSseEventSubscriber;
    agentsContext?: AgentsRouterContext;
    webRoot?: string;
    webUIConfig?: WebUIRuntimeConfig;
    disableAuth?: boolean;
};

const DEFAULT_API_PREFIX = '/api' as const;

type HealthSchema = MergeSchemaPath<
    ExtractSchema<ReturnType<typeof createHealthRouter>>,
    '/health'
>;
type DiscoverySchema = MergeSchemaPath<ExtractSchema<ReturnType<typeof createA2aRouter>>, '/'>;
type JsonRpcSchema = MergeSchemaPath<ExtractSchema<ReturnType<typeof createA2AJsonRpcRouter>>, '/'>;

type ConversationRouterSchema =
    | GreetingRouterSchema
    | MessagesRouterSchema
    | LlmRouterSchema
    | SessionsRouterSchema
    | SearchRouterSchema;

type IntegrationRouterSchema =
    | McpRouterSchema
    | WebhooksRouterSchema
    | PromptsRouterSchema
    | ResourcesRouterSchema
    | MemoryRouterSchema
    | WorkspacesRouterSchema
    | SchedulesRouterSchema
    | SkillsRouterSchema;

type ManagementRouterSchema = ApprovalsRouterSchema | AgentsRouterSchema | QueueRouterSchema;

type SystemRouterSchema =
    | OpenRouterRouterSchema
    | KeyRouterSchema
    | ToolsRouterSchema
    | DiscoveryRouterSchema
    | ModelsRouterSchema
    | SystemPromptRouterSchema
    | FiusAuthRouterSchema;

type DefaultApiRouterSchema =
    | ConversationRouterSchema
    | IntegrationRouterSchema
    | ManagementRouterSchema
    | SystemRouterSchema;

type DefaultApiSchema = MergeSchemaPath<DefaultApiRouterSchema, typeof DEFAULT_API_PREFIX>;

type PublicApiSchema = HealthSchema | DiscoverySchema | JsonRpcSchema;
type AppSchema = PublicApiSchema | DefaultApiSchema;

export function createFiusApp(options: CreateFiusAppOptions): FiusApp {
    const {
        apiPrefix,
        getAgent,
        getAgentConfigPath,
        getAgentCard,
        approvalCoordinator,
        webhookSubscriber,
        sseSubscriber,
        sessionSseSubscriber,
        agentsContext,
        webRoot,
        webUIConfig,
        disableAuth = false,
    } = options;

    if (disableAuth) {
        logger.warn(
            `⚠️  Authentication disabled (disableAuth=true). createAuthMiddleware() skipped. Ensure external auth is in place.`
        );
    }

    const app = new OpenAPIHono({ strict: false });

    app.use('*', createCorsMiddleware());

    if (!disableAuth) {
        app.use('*', createAuthMiddleware());
    }

    app.onError((err, ctx) => handleHonoError(ctx, err));

    const rawPrefix = apiPrefix ?? DEFAULT_API_PREFIX;
    const normalizedPrefix = rawPrefix === '' ? '/' : rawPrefix.replace(/\/+$/, '') || '/';
    const middlewarePattern = normalizedPrefix === '/' ? '/*' : `${normalizedPrefix}/*`;

    app.use(middlewarePattern, prettyJsonMiddleware);

    const routePrefix = normalizedPrefix as typeof DEFAULT_API_PREFIX;

    const resolvedGetAgentConfigPath = getAgentConfigPath ?? ((_ctx: Context) => undefined);
    const fullApp: FiusApp = app;

    const mountedRouters: Array<readonly [string, Hono<Env, Schema, string>]> = [
        ['/health', createHealthRouter(getAgent)],
        ['/', createA2aRouter(getAgentCard)],
        ['/', createA2AJsonRpcRouter(getAgent, sseSubscriber)],
        ['/', createA2ATasksRouter(getAgent, sseSubscriber)],
        [routePrefix, createGreetingRouter(getAgent)],
        [routePrefix, createMessagesRouter(getAgent, approvalCoordinator)],
        [routePrefix, createLlmRouter(getAgent)],
        [routePrefix, createSessionsRouter(getAgent, sessionSseSubscriber)],
        [routePrefix, createSearchRouter(getAgent)],
        [routePrefix, createMcpRouter(getAgent, resolvedGetAgentConfigPath)],
        [routePrefix, createWebhooksRouter(getAgent, webhookSubscriber)],
        [routePrefix, createPromptsRouter(getAgent)],
        [routePrefix, createResourcesRouter(getAgent)],
        [routePrefix, createMemoryRouter(getAgent)],
        [routePrefix, createWorkspacesRouter(getAgent)],
        [routePrefix, createSchedulesRouter(getAgent)],
        [routePrefix, createSkillsRouter(getAgent)],
        [routePrefix, createApprovalsRouter(getAgent, approvalCoordinator)],
        [
            routePrefix,
            createAgentsRouter(
                getAgent,
                agentsContext || dummyAgentsContext,
                resolvedGetAgentConfigPath
            ),
        ],
        [routePrefix, createQueueRouter(getAgent)],
        [routePrefix, createOpenRouterRouter()],
        [routePrefix, createKeyRouter()],
        [routePrefix, createToolsRouter(getAgent)],
        [routePrefix, createDiscoveryRouter(resolvedGetAgentConfigPath)],
        [routePrefix, createModelsRouter()],
        [routePrefix, createSystemPromptRouter(getAgent)],
        [routePrefix, createFiusAuthRouter(getAgent)],
        [routePrefix, createGitHubMcpRouter()],
        [routePrefix, createGitHubAgentsRouter()],
    ];

    for (const [path, router] of mountedRouters) {
        fullApp.route(path, router);
    }

    fullApp.post('/api/llm/streaming', async (ctx) => {
        try {
            const body = await ctx.req.json();
            const enabled = typeof body?.enabled === 'boolean' ? body.enabled : false;
            const settingsPath = getFiusGlobalPath('', 'settings.json');
            let settings: Record<string, unknown> = {};
            if (existsSync(settingsPath)) {
                settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
            }
            settings.streaming = enabled;
            const dir = nodePath.dirname(settingsPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            return ctx.json({ streaming: enabled }, 200);
        } catch {
            return ctx.json({ streaming: false }, 500);
        }
    });

    fullApp.get('/api/llm/build-mode', async (ctx) => {
        try {
            const settingsPath = getFiusGlobalPath('', 'settings.json');
            let mode = 'build';
            if (existsSync(settingsPath)) {
                const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
                mode = settings.buildMode === 'plan' ? 'plan' : 'build';
            }
            return ctx.json({ buildMode: mode }, 200);
        } catch {
            return ctx.json({ buildMode: 'build' }, 200);
        }
    });

    fullApp.post('/api/llm/build-mode', async (ctx) => {
        try {
            const body = await ctx.req.json();
            const mode = body?.buildMode === 'plan' ? 'plan' : 'build';
            const settingsPath = getFiusGlobalPath('', 'settings.json');
            let settings: Record<string, unknown> = {};
            if (existsSync(settingsPath)) {
                settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
            }
            settings.buildMode = mode;
            const dir = nodePath.dirname(settingsPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            return ctx.json({ buildMode: mode }, 200);
        } catch {
            return ctx.json({ buildMode: 'build' }, 500);
        }
    });

    fullApp.doc('/openapi.json', {
        openapi: '3.0.0',
        info: {
            title: 'Fius API',
            version: serverVersion,
            description: 'OpenAPI spec for the Fius REST API server',
        },
        servers: [
            {
                url: 'http://localhost:3001',
                description: 'Local development server (default port)',
            },
            {
                url: 'http://localhost:{port}',
                description: 'Local development server (custom port)',
                variables: {
                    port: {
                        default: '3001',
                        description: 'API server port',
                    },
                },
            },
        ],
        tags: [
            {
                name: 'system',
                description: 'System health and status endpoints',
            },
            {
                name: 'config',
                description: 'Agent configuration and greeting management',
            },
            {
                name: 'messages',
                description: 'Send messages to the agent and manage conversations',
            },
            {
                name: 'sessions',
                description: 'Create and manage conversation sessions',
            },
            {
                name: 'schedules',
                description: 'Create and manage automation schedules',
            },
            {
                name: 'llm',
                description: 'Configure and switch between LLM providers and models',
            },
            {
                name: 'mcp',
                description: 'Manage Model Context Protocol (MCP) servers and tools',
            },
            {
                name: 'webhooks',
                description: 'Register and manage webhook endpoints for agent events',
            },
            {
                name: 'search',
                description: 'Search through messages and sessions',
            },
            {
                name: 'memory',
                description: 'Store and retrieve agent memories for context',
            },
            {
                name: 'prompts',
                description: 'Manage custom prompts and templates',
            },
            {
                name: 'skills',
                description: 'List and read available agent skills',
            },
            {
                name: 'resources',
                description: 'Access and manage resources from MCP servers and internal providers',
            },
            {
                name: 'agent',
                description: 'Current agent configuration and file operations',
            },
            {
                name: 'agents',
                description: 'Install, switch, and manage agent configurations',
            },
            {
                name: 'steer',
                description: 'Manage active-turn steer messages for busy sessions',
            },
            {
                name: 'follow-up',
                description: 'Manage follow-up messages that run after the active turn',
            },
            {
                name: 'openrouter',
                description: 'OpenRouter model validation and cache management',
            },
            {
                name: 'discovery',
                description: 'Discover available providers and capabilities',
            },
            {
                name: 'tools',
                description: 'List and inspect available tools from local and MCP sources',
            },
            {
                name: 'models',
                description: 'List and manage local GGUF models and Ollama models',
            },
            {
                name: 'auth',
                description: 'Fius authentication status and management',
            },
        ],
    });

    if (webRoot) {
        fullApp.route('/', createStaticRouter(webRoot));
        fullApp.notFound(createSpaFallbackHandler(webRoot, webUIConfig, normalizedPrefix));
    }

    Object.assign(fullApp, { webhookSubscriber });

    return fullApp;
}

export type AppType = Hono<BlankEnv, AppSchema, '/'>;

export type { WebUIRuntimeConfig } from './routes/static.js';
