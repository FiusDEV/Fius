import type { Server } from 'node:http';
import type { Context } from 'hono';
import type { FiusAgent, AgentCard } from '@fius/core';
import { createAgentCard, logger, startLlmRegistryAutoUpdate } from '@fius/core';
import { getFiusGlobalPath } from '@fius/core/utils/path.js';
import { readFileSync, existsSync } from 'node:fs';
import { createFiusApp } from './index.js';
import { createNodeServer } from './node/index.js';
import type { FiusApp } from './types.js';
import type { WebUIRuntimeConfig } from './routes/static.js';
import { WebhookEventSubscriber } from '../events/webhook-subscriber.js';
import { A2ASseEventSubscriber } from '../events/a2a-sse-subscriber.js';
import { ApprovalCoordinator } from '../approval/approval-coordinator.js';
import { createManualApprovalHandler } from '../approval/manual-approval-handler.js';
import { wireApprovalCoordinatorToAgent } from '../approval/wire-approval-events.js';
import { SessionSseEventSubscriber } from '../events/session-sse-subscriber.js';

function bootstrapFiusApiKey(): void {
    if (process.env.FIUS_API_KEY?.trim()) return;
    try {
        const authPath = getFiusGlobalPath('', 'auth.json');
        if (!existsSync(authPath)) return;
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
        if (auth.fiusApiKey) {
            process.env.FIUS_API_KEY = auth.fiusApiKey;
        }
    } catch {
    }
}

export type StartFiusServerOptions = {
    port?: number;
    hostname?: string;
    agentCard?: Partial<AgentCard>;
    webRoot?: string;
    webUIConfig?: WebUIRuntimeConfig;
    baseUrl?: string;
};

export type StartFiusServerResult = {
    server: Server;
    app: FiusApp;
    stop: () => Promise<void>;
    agentCard: AgentCard;
};

export async function startFiusServer(
    agent: FiusAgent,
    options: StartFiusServerOptions = {}
): Promise<StartFiusServerResult> {
    startLlmRegistryAutoUpdate();

    bootstrapFiusApiKey();

    const {
        port: requestedPort,
        hostname = '0.0.0.0',
        agentCard: agentCardOverride = {},
        webRoot,
        webUIConfig,
        baseUrl: baseUrlOverride,
    } = options;

    const resolvedPort = requestedPort ?? (process.env.PORT ? Number(process.env.PORT) : 3000);
    const baseUrl = baseUrlOverride ?? `http://localhost:${resolvedPort}`;

    logger.info(`Initializing Fius server on ${hostname}:${resolvedPort}...`);

    const agentCard = createAgentCard(
        {
            defaultName: agentCardOverride.name ?? 'fius-agent',
            defaultVersion: agentCardOverride.version ?? '1.0.0',
            defaultBaseUrl: baseUrl,
        },
        agentCardOverride
    );

    logger.debug('Creating event infrastructure...');
    const webhookSubscriber = new WebhookEventSubscriber();
    const sseSubscriber = new A2ASseEventSubscriber();
    const sessionSseSubscriber = new SessionSseEventSubscriber();
    const approvalCoordinator = new ApprovalCoordinator();
    let approvalEventBridge: AbortController | null = null;

    logger.debug('Creating Hono application...');
    const app = createFiusApp({
        getAgent: (_ctx: Context) => agent,
        getAgentCard: () => agentCard,
        approvalCoordinator,
        webhookSubscriber,
        sseSubscriber,
        sessionSseSubscriber,
        ...(webRoot ? { webRoot } : {}),
        ...(webUIConfig ? { webUIConfig } : {}),
    });

    logger.debug('Creating Node.js HTTP server...');
    const { server, webhookSubscriber: bridgeWebhookSubscriber } = createNodeServer(app, {
        getAgent: () => agent,
        port: resolvedPort,
        hostname,
    });

    if (bridgeWebhookSubscriber) {
        logger.debug('Registering webhook subscriber with agent...');
        agent.registerSubscriber(bridgeWebhookSubscriber);
    }

    const needsHandler =
        agent.config.permissions.mode === 'manual' || agent.config.elicitation.enabled;

    if (needsHandler) {
        logger.debug('Setting up manual approval handler...');
        const handler = createManualApprovalHandler(approvalCoordinator);
        agent.setApprovalHandler(handler);
    }

    approvalEventBridge = wireApprovalCoordinatorToAgent(agent, approvalCoordinator);

    logger.debug('Wiring event subscribers to agent...');
    agent.registerSubscriber(webhookSubscriber);
    agent.registerSubscriber(sseSubscriber);
    agent.registerSubscriber(sessionSseSubscriber);

    logger.info('Starting agent...');
    await agent.start();

    logger.info(`Server running at http://${hostname}:${resolvedPort}`, null, 'green');

    return {
        server,
        app,
        agentCard,
        stop: async () => {
            logger.info('Stopping Fius server...');
            approvalEventBridge?.abort();
            sessionSseSubscriber.cleanup();
            await agent.stop();
            server.close();
            logger.info('Server stopped', null, 'yellow');
        },
    };
}
