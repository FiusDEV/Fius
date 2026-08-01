import os from 'node:os';
import type { Context } from 'hono';
import type { AgentCard } from '@fiusdev/core';
import { FiusAgent, createAgentCard, logger, AgentError } from '@fiusdev/core';
import {
    loadAgentConfig,
    deriveDisplayName,
    getAgentRegistry,
    AgentFactory,
    globalPreferencesExist,
    loadGlobalPreferences,
    createFiusAgentFromConfig,
} from '@fiusdev/agent-management';
import { applyUserPreferences } from '../config/cli-overrides.js';
import { createFileSessionLoggerFactory } from '../utils/session-logger-factory.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
    createFiusApp,
    createNodeServer,
    createMcpTransport as createServerMcpTransport,
    createMcpHttpHandlers,
    initializeMcpServer as initializeServerMcpServer,
    createManualApprovalHandler,
    WebhookEventSubscriber,
    A2ASseEventSubscriber,
    SessionSseEventSubscriber,
    ApprovalCoordinator,
    wireApprovalCoordinatorToAgent,
    type McpTransportType,
    type WebUIRuntimeConfig,
} from '@fiusdev/server';
import { registerGracefulShutdown } from '../utils/graceful-shutdown.js';
import { applyWorkspaceToAgent } from '../utils/workspace.js';

const DEFAULT_AGENT_VERSION = '1.0.0';

const sessionLoggerFactory = createFileSessionLoggerFactory();

/**
 * List all agents (installed and available)
 * Replacement for old Fius.listAgents()
 */
async function listAgents(): Promise<{
    installed: Array<{
        id: string;
        name: string;
        description: string;
        author?: string;
        tags?: string[];
        type: 'builtin' | 'custom';
    }>;
    available: Array<{
        id: string;
        name: string;
        description: string;
        author?: string;
        tags?: string[];
        type: 'builtin' | 'custom';
    }>;
}> {
    return AgentFactory.listAgents({
        descriptionFallback: 'No description',
        customAgentDescriptionFallback: 'Custom agent',
    });
}

/**
 * Create an agent from an agent ID
 * Replacement for old Fius.createAgent()
 * Uses registry.resolveAgent() which auto-installs if needed
 *
 * Applies user preferences (preferences.yml) to ALL agents, not just the default.
 * See feature-plans/auto-update.md section 8.11 - Three-Layer LLM Resolution.
 */
async function createAgentFromId(agentId: string, workspaceRoot?: string): Promise<FiusAgent> {
    try {
        const registry = getAgentRegistry();
        const agentPath = await registry.resolveAgent(agentId, true);

        let config = await loadAgentConfig(agentPath);

        if (globalPreferencesExist()) {
            try {
                const preferences = await loadGlobalPreferences();
                if (preferences?.llm?.provider && preferences?.llm?.model) {
                    config = applyUserPreferences(config, preferences);
                    logger.debug(`Applied user preferences to ${agentId}`, {
                        provider: preferences.llm.provider,
                        model: preferences.llm.model,
                    });
                }
            } catch {
                logger.debug('Could not load preferences, using bundled config');
            }
        }

        logger.info(`Creating agent: ${agentId} from ${agentPath}`);
        return await createFiusAgentFromConfig({
            config,
            configPath: agentPath,
            enrichOptions: {
                logLevel: 'info',
                ...(workspaceRoot ? { workspaceRoot } : {}),
            },
            overrides: { sessionLoggerFactory },
        });
    } catch (error) {
        throw new Error(
            `Failed to create agent '${agentId}': ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function resolvePort(listenPort?: number): number {
    if (typeof listenPort === 'number') {
        return listenPort;
    }
    const envPort = Number(process.env.PORT);
    return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

function resolveBaseUrl(port: number): string {
    return process.env.FIUS_BASE_URL ?? `http://localhost:${port}`;
}

export type HonoInitializationResult = {
    app: ReturnType<typeof createFiusApp>;
    server: ReturnType<typeof createNodeServer>['server'];
    webhookSubscriber?: NonNullable<ReturnType<typeof createNodeServer>['webhookSubscriber']>;
    agentCard: AgentCard;
    mcpTransport?: Transport;
    switchAgentById: (agentId: string) => Promise<{ id: string; name: string }>;
    switchAgentByPath: (filePath: string) => Promise<{ id: string; name: string }>;
    resolveAgentInfo: (agentId: string) => Promise<{ id: string; name: string }>;
    ensureAgentAvailable: () => void;
    getActiveAgentId: () => string | undefined;
};

export async function initializeHonoApi(
    agent: FiusAgent,
    agentCardOverride?: Partial<AgentCard>,
    listenPort?: number,
    agentId?: string,
    configFilePath?: string,
    workspaceRoot?: string,
    webRoot?: string,
    webUIConfig?: WebUIRuntimeConfig
): Promise<HonoInitializationResult> {
    let activeAgent: FiusAgent = agent;
    let activeAgentId: string | undefined = agentId || 'fius';
    let activeAgentConfigPath: string | undefined = configFilePath;
    let isSwitchingAgent = false;
    registerGracefulShutdown(() => activeAgent);

    const resolvedPort = resolvePort(listenPort);
    const baseApiUrl = resolveBaseUrl(resolvedPort);

    const overrides = agentCardOverride ?? {};
    let agentCardData = createAgentCard(
        {
            defaultName: overrides.name ?? activeAgentId,
            defaultVersion: overrides.version ?? DEFAULT_AGENT_VERSION,
            defaultBaseUrl: baseApiUrl,
        },
        overrides
    );

    const webhookSubscriber = new WebhookEventSubscriber();
    const sseSubscriber = new A2ASseEventSubscriber();
    const sessionSseSubscriber = new SessionSseEventSubscriber();
    const approvalCoordinator = new ApprovalCoordinator();
    let approvalEventBridge: AbortController | null = null;

    /**
     * Wire services (SSE subscribers) to an agent.
     * Called for agent switching to re-subscribe to the new agent's event bus.
     * Note: Approval handler and coordinator are set before agent.start() for each agent.
     */
    async function wireServicesToAgent(agent: FiusAgent): Promise<void> {
        logger.debug('Wiring services to agent...');

        approvalEventBridge?.abort();
        approvalEventBridge = wireApprovalCoordinatorToAgent(agent, approvalCoordinator);

        agent.registerSubscriber(webhookSubscriber);
        agent.registerSubscriber(sseSubscriber);
        agent.registerSubscriber(sessionSseSubscriber);
    }

    /**
     * Helper to resolve agent ID to { id, name } by looking up in registry
     */
    async function resolveAgentInfo(agentId: string): Promise<{ id: string; name: string }> {
        const agents = await listAgents();
        const agent =
            agents.installed.find((a) => a.id === agentId) ??
            agents.available.find((a) => a.id === agentId);
        return {
            id: agentId,
            name: agent?.name ?? deriveDisplayName(agentId),
        };
    }

    function ensureAgentAvailable(): void {
        if (isSwitchingAgent) {
            throw AgentError.switchInProgress();
        }

        if (activeAgent.isStarted() && !activeAgent.isStopped()) {
            return;
        }

        if (activeAgent.isStopped()) {
            throw AgentError.stopped();
        }
        if (!activeAgent.isStarted()) {
            throw AgentError.notStarted();
        }
    }

    /**
     * Common agent switching logic shared by switchAgentById and switchAgentByPath.
     */
    async function performAgentSwitch(
        newAgent: FiusAgent,
        agentId: string,
        agentConfigPath: string | undefined,
        bridge: ReturnType<typeof createNodeServer>
    ) {
        logger.info('Preparing new agent for switch...');

        if (bridge.webhookSubscriber) {
            newAgent.registerSubscriber(bridge.webhookSubscriber);
        }

        const previousAgent = activeAgent;
        activeAgent = newAgent;
        activeAgentId = agentId;
        activeAgentConfigPath = agentConfigPath;

        const needsHandler =
            newAgent.config.permissions.mode === 'manual' || newAgent.config.elicitation.enabled;

        if (needsHandler) {
            logger.debug('Setting up manual approval handler for new agent...');
            const handler = createManualApprovalHandler(approvalCoordinator);
            newAgent.setApprovalHandler(handler);
        }

        logger.info('Wiring services to new agent...');
        await wireServicesToAgent(newAgent);

        logger.info(`Starting new agent: ${agentId}`);
        await newAgent.start();
        if (workspaceRoot) {
            await applyWorkspaceToAgent(newAgent, workspaceRoot);
        }

        agentCardData = createAgentCard(
            {
                defaultName: agentId,
                defaultVersion: overrides.version ?? DEFAULT_AGENT_VERSION,
                defaultBaseUrl: baseApiUrl,
            },
            overrides
        );

        logger.info(`Successfully switched to agent: ${agentId}`);

        try {
            if (previousAgent && previousAgent !== newAgent) {
                logger.info('Stopping previous agent...');
                await previousAgent.stop();
            }
        } catch (err) {
            logger.warn(`Stopping previous agent failed: ${err}`);
        }

        return await resolveAgentInfo(agentId);
    }

    async function switchAgentById(agentId: string, bridge: ReturnType<typeof createNodeServer>) {
        if (isSwitchingAgent) {
            throw AgentError.switchInProgress();
        }
        isSwitchingAgent = true;

        let newAgent: FiusAgent | undefined;
        let newAgentConfigPath: string | undefined;
        try {
            const registry = getAgentRegistry();
            newAgentConfigPath = await registry.resolveAgent(agentId, true);

            if (newAgentConfigPath!.endsWith('.md')) {
                const fs = await import('node:fs');
                const fsPromises = await import('node:fs/promises');
                const nodePath = await import('node:path');
                const { stringify: yamlStringify } = await import('yaml');
                const skillContent = fs.readFileSync(newAgentConfigPath!, 'utf-8');
                const currentLlm = activeAgent?.config?.llm ?? { provider: 'openrouter', model: 'google/gemini-2.5-flash' };
                const agentDir = nodePath.dirname(newAgentConfigPath!);
                const yamlPath = nodePath.join(agentDir, 'agent.yaml');
                await fsPromises.writeFile(yamlPath, yamlStringify({ systemPrompt: skillContent, llm: currentLlm }), 'utf-8');
                logger.info(`Created agent.yaml for skill-only agent '${agentId}' from SKILL.md`);
                newAgentConfigPath = yamlPath;
            }

            newAgent = await createAgentFromId(agentId, workspaceRoot);

            return await performAgentSwitch(newAgent, agentId, newAgentConfigPath, bridge);
        } catch (error) {
            logger.error(
                `Failed to switch to agent '${agentId}': ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { error }
            );

            if (newAgent) {
                try {
                    await newAgent.stop();
                } catch (cleanupErr) {
                    logger.warn(`Failed to cleanup new agent: ${cleanupErr}`);
                }
            }

            throw error;
        } finally {
            isSwitchingAgent = false;
        }
    }

    async function switchAgentByPath(
        filePath: string,
        bridge: ReturnType<typeof createNodeServer>
    ) {
        if (isSwitchingAgent) {
            throw AgentError.switchInProgress();
        }
        isSwitchingAgent = true;

        let newAgent: FiusAgent | undefined;
        try {
            let config = await loadAgentConfig(filePath);

            if (globalPreferencesExist()) {
                try {
                    const preferences = await loadGlobalPreferences();
                    if (preferences?.llm?.provider && preferences?.llm?.model) {
                        config = applyUserPreferences(config, preferences);
                        logger.debug(
                            `Applied user preferences to agent from ${filePath} (provider=${preferences.llm.provider}, model=${preferences.llm.model})`
                        );
                    }
                } catch {
                    logger.debug('Could not load preferences, using bundled config');
                }
            }

            newAgent = await createFiusAgentFromConfig({
                config,
                configPath: filePath,
                enrichOptions: {
                    logLevel: 'info',
                    ...(workspaceRoot ? { workspaceRoot } : {}),
                },
                overrides: { sessionLoggerFactory },
            });

            const agentId = newAgent!.config.agentId;

            return await performAgentSwitch(newAgent!, agentId, filePath, bridge);
        } catch (error) {
            logger.error(
                `Failed to switch to agent from path '${filePath}': ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { error }
            );

            if (newAgent) {
                try {
                    await newAgent.stop();
                } catch (cleanupErr) {
                    logger.warn(`Failed to cleanup new agent: ${cleanupErr}`);
                }
            }

            throw error;
        } finally {
            isSwitchingAgent = false;
        }
    }

    const getAgent = (_ctx: Context): FiusAgent => {
        ensureAgentAvailable();
        return activeAgent;
    };
    const getAgentCard = () => agentCardData;
    const getAgentConfigPath = (_ctx: Context): string | undefined => activeAgentConfigPath;

    let bridgeRef: ReturnType<typeof createNodeServer> | null = null;

    const app = createFiusApp({
        apiPrefix: '/api',
        getAgent,
        getAgentConfigPath,
        getAgentCard,
        approvalCoordinator,
        webhookSubscriber,
        sseSubscriber,
        sessionSseSubscriber,
        ...(webRoot ? { webRoot } : {}),
        ...(webUIConfig ? { webUIConfig } : {}),
        agentsContext: {
            switchAgentById: (id: string) => {
                if (!bridgeRef) throw new Error('Bridge not initialized');
                return switchAgentById(id, bridgeRef);
            },
            switchAgentByPath: (filePath: string) => {
                if (!bridgeRef) throw new Error('Bridge not initialized');
                return switchAgentByPath(filePath, bridgeRef);
            },
            resolveAgentInfo,
            ensureAgentAvailable,
            getActiveAgentId: () => activeAgentId,
        },
    });

    let mcpTransport: Transport | undefined;
    const transportType = (process.env.FIUS_MCP_TRANSPORT_TYPE as McpTransportType) || 'http';
    try {
        mcpTransport = await createServerMcpTransport(transportType);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to create MCP transport: ${errorMessage}`);
        mcpTransport = undefined;
    }

    bridgeRef = createNodeServer(app, {
        getAgent: () => activeAgent,
        mcpHandlers: mcpTransport ? createMcpHttpHandlers(mcpTransport) : null,
    });

    logger.debug('Registering webhook subscriber with agent...');
    if (bridgeRef.webhookSubscriber) {
        activeAgent.registerSubscriber(bridgeRef.webhookSubscriber);
    }

    agentCardData = createAgentCard(
        {
            defaultName: overrides.name ?? activeAgentId,
            defaultVersion: overrides.version ?? DEFAULT_AGENT_VERSION,
            defaultBaseUrl: baseApiUrl,
        },
        overrides
    );

    const needsHandler =
        activeAgent.config.permissions.mode === 'manual' || activeAgent.config.elicitation.enabled;

    if (needsHandler) {
        logger.debug('Setting up manual approval handler for initial agent...');
        const handler = createManualApprovalHandler(approvalCoordinator);
        activeAgent.setApprovalHandler(handler);
    }

    logger.debug('Wiring SSE subscribers to initial agent...');
    await wireServicesToAgent(activeAgent);

    if (!activeAgent.isStarted() || activeAgent.isStopped()) {
        await activeAgent.start();
    }
    if (workspaceRoot) {
        await applyWorkspaceToAgent(activeAgent, workspaceRoot);
    }

    if (mcpTransport) {
        try {
            await initializeServerMcpServer(activeAgent, getAgentCard(), mcpTransport);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to initialize MCP server: ${errorMessage}`);
            mcpTransport = undefined;
        }
    }

    return {
        app,
        server: bridgeRef.server,
        ...(bridgeRef.webhookSubscriber ? { webhookSubscriber: bridgeRef.webhookSubscriber } : {}),
        agentCard: agentCardData,
        ...(mcpTransport ? { mcpTransport } : {}),
        switchAgentById: (id: string) => switchAgentById(id, bridgeRef!),
        switchAgentByPath: (filePath: string) => switchAgentByPath(filePath, bridgeRef!),
        resolveAgentInfo,
        ensureAgentAvailable,
        getActiveAgentId: () => activeAgentId,
    };
}

export async function startHonoApiServer(
    agent: FiusAgent,
    port = 3000,
    agentCardOverride?: Partial<AgentCard>,
    agentId?: string,
    configFilePath?: string,
    workspaceRoot?: string,
    webRoot?: string,
    webUIConfig?: WebUIRuntimeConfig
): Promise<{
    server: ReturnType<typeof createNodeServer>['server'];
    webhookSubscriber?: NonNullable<ReturnType<typeof createNodeServer>['webhookSubscriber']>;
}> {
    const { server, webhookSubscriber } = await initializeHonoApi(
        agent,
        agentCardOverride,
        port,
        agentId,
        configFilePath,
        workspaceRoot,
        webRoot,
        webUIConfig
    );

    server.listen(port, '0.0.0.0', () => {});

    server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            logger.warn(`Port ${port} already in use - WebUI may already be running`);
        } else {
            logger.error(`Server error on port ${port}: ${err.message}`);
        }
    });

    return {
        server,
        ...(webhookSubscriber ? { webhookSubscriber } : {}),
    };
}