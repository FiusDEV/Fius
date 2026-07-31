import { MCPManager } from '../mcp/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import type { ToolPolicies } from '../tools/schemas.js';
import type { Tool } from '../tools/types.js';
import type { AllowedToolsProvider } from '../tools/approval/allowed-tools-provider/types.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { AgentStateManager } from '../agent/state-manager.js';
import { SessionManager } from '../session/index.js';
import { SearchService } from '../search/index.js';
import type { FiusStores } from '../storage/index.js';
import type { ToolExecutionStore } from '../storage/tool-executions/types.js';
import { AgentError } from '../agent/errors.js';
import { WorkspaceManager } from '../workspace/index.js';
import { createAllowedToolsProvider } from '../tools/approval/allowed-tools-provider/factory.js';
import type { Logger } from '../logger/v2/types.js';
import type { LlmAuthResolver } from '../llm/auth/index.js';
import type { AgentRuntimeSettings } from '../agent/runtime-config.js';
import { AgentEventBus } from '../events/index.js';
import { ResourceManager } from '../resources/manager.js';
import { ApprovalManager } from '../approval/manager.js';
import { MemoryManager } from '../memory/index.js';
import { HookManager } from '../hooks/manager.js';
import type { Hook } from '../hooks/types.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import { SessionToolPreferencesStore } from '../tools/session-tool-preferences-store.js';
import type { LLMExecutionControl, LanguageModelFactory } from '../llm/services/types.js';
import type { WorkspaceHandleProvider } from '../workspace/types.js';


export type AgentServices = {
    mcpManager: MCPManager;
    toolManager: ToolManager;
    systemPromptManager: SystemPromptManager;
    agentEventBus: AgentEventBus;
    stateManager: AgentStateManager;
    sessionManager: SessionManager;
    workspaceManager: WorkspaceManager;
    searchService: SearchService;
    stores: FiusStores;
    resourceManager: ResourceManager;
    approvalManager: ApprovalManager;
    memoryManager: MemoryManager;
    hookManager: HookManager;
};

export type ToolManagerFactoryOptions = {
    mcpManager: MCPManager;
    approvalManager: ApprovalManager;
    allowedToolsProvider: AllowedToolsProvider;
    approvalMode: 'manual' | 'auto-approve';
    agentEventBus: AgentEventBus;
    toolPolicies: ToolPolicies;
    tools: Tool[];
    logger: Logger;
    toolExecutionStore: ToolExecutionStore;
};

export type ToolManagerFactory = (options: ToolManagerFactoryOptions) => ToolManager;

export type ToolkitLoader = (toolkits: string[]) => Promise<Tool[]>;

export type InitializeServicesOptions = {
    sessionLoggerFactory?: import('../session/session-manager.js').SessionLoggerFactory;
    languageModelFactory?: LanguageModelFactory;
    authResolver?: LlmAuthResolver | null;
    mcpAuthProviderFactory?: import('../mcp/types.js').McpAuthProviderFactory | null;
    toolManager?: ToolManager;
    toolManagerFactory?: ToolManagerFactory;
    stores?: FiusStores;
    hooks?: Hook[] | undefined;
    workspaceHandleProvider?: WorkspaceHandleProvider | undefined;
    executionControl?: LLMExecutionControl | undefined;
};

export async function createAgentServices(
    config: AgentRuntimeSettings,
    logger: Logger,
    agentEventBus: AgentEventBus,
    overrides?: InitializeServicesOptions,
    compactionStrategy?: CompactionStrategy | null | undefined
): Promise<AgentServices> {
    logger.debug('Using pre-created agent event bus');

    logger.debug('Initializing typed stores');
    const stores =
        overrides?.stores ??
        (() => {
            throw AgentError.initializationFailed(
                'FiusStores must be provided via overrides.stores during the DI refactor'
            );
        })();

    if (!stores.isConnected()) {
        await stores.connect();
    }

    logger.debug('Typed stores initialized', { type: stores.getStoreType() });

    const sessionCacheTtlMs = config.sessions?.sessionTTL ?? 3600000;
    const approvalStore = stores.getStore('approvals');
    const sessionStore = stores.getStore('sessions');
    const conversationStore = stores.getStore('conversation');
    const sessionToolPreferencesStore = new SessionToolPreferencesStore(
        stores.getStore('toolPreferences'),
        logger,
        {
            cacheTtlMs: sessionCacheTtlMs,
        }
    );
    const steerQueueStore = stores.getStore('steerQueue');
    const followUpQueueStore = stores.getStore('followUpQueue');

    const workspaceManager = new WorkspaceManager(
        stores.getStore('workspaces'),
        agentEventBus,
        logger,
        overrides?.workspaceHandleProvider
    );
    logger.debug('Workspace manager initialized');

    logger.debug('Initializing approval manager');
    const approvalManager = new ApprovalManager(
        {
            permissions: {
                mode: config.permissions.mode,
                ...(config.permissions.timeout !== undefined && {
                    timeout: config.permissions.timeout,
                }),
            },
            elicitation: {
                enabled: config.elicitation.enabled,
                ...(config.elicitation.timeout !== undefined && {
                    timeout: config.elicitation.timeout,
                }),
            },
        },
        logger,
        approvalStore
    );
    logger.debug('Approval system initialized');

    const mcpManager = new MCPManager(logger, agentEventBus);
    if (overrides?.mcpAuthProviderFactory) {
        mcpManager.setAuthProviderFactory(overrides.mcpAuthProviderFactory);
    }
    await mcpManager.initializeFromConfig(config.mcpServers);

    mcpManager.setApprovalManager(approvalManager);
    logger.debug('Approval manager connected to MCP manager for elicitation support');

    const searchService = new SearchService(conversationStore, sessionStore, logger);

    const memoryManager = new MemoryManager(stores.getStore('memories'), logger);
    logger.debug('Memory manager initialized');

    const hooks = overrides?.hooks ?? [];
    const hookManager = new HookManager(
        {
            agentEventBus,
            stores,
        },
        hooks,
        logger
    );

    await hookManager.initialize();
    logger.info('Hook manager initialized');

    const resourceManager = new ResourceManager(
        mcpManager,
        {
            resourcesConfig: config.resources,
            artifactStore: stores.getStore('artifacts'),
        },
        agentEventBus,
        logger
    );
    await resourceManager.initialize();

    const allowedToolsProvider = createAllowedToolsProvider(
        {
            type: config.permissions.allowedToolsStorage,
            toolPreferenceStore: stores.getStore('toolPreferences'),
        },
        logger
    );

    const toolManager =
        overrides?.toolManager ??
        overrides?.toolManagerFactory?.({
            mcpManager,
            approvalManager,
            allowedToolsProvider,
            approvalMode: config.permissions.mode,
            agentEventBus,
            toolPolicies: config.permissions.toolPolicies,
            tools: [],
            logger,
            toolExecutionStore: stores.getStore('toolExecutions'),
        }) ??
        new ToolManager(
            mcpManager,
            approvalManager,
            allowedToolsProvider,
            config.permissions.mode,
            agentEventBus,
            config.permissions.toolPolicies,
            [],
            logger,
            sessionToolPreferencesStore,
            stores.getStore('toolExecutions')
        );
    await toolManager.setWorkspaceManager(workspaceManager);

    const mcpServerCount = Object.keys(config.mcpServers).length;
    if (mcpServerCount === 0) {
        logger.info('Agent initialized without MCP servers - only built-in capabilities available');
    } else {
        logger.debug(`MCPManager initialized with ${mcpServerCount} MCP server(s)`);
    }

    const systemPromptManager = new SystemPromptManager(
        config.systemPrompt,
        memoryManager,
        config.memories,
        logger
    );

    const stateManager = new AgentStateManager(config, agentEventBus, logger);
    logger.debug('Agent state manager initialized');

    try {
        const { loadPersistedMcpServers } = await import('../mcp/mcp-persistence.js');
        const { resolveAndValidateMcpServerConfig } = await import('../mcp/resolver.js');
        const { ensureOk } = await import('../errors/result-bridge.js');
        const persisted = await loadPersistedMcpServers();
        const existingNames = Object.keys(stateManager.getRuntimeConfig().mcpServers);
        for (const [name, serverConfig] of Object.entries(persisted)) {
            if (existingNames.includes(name)) {
                continue;
            }
            const validation = resolveAndValidateMcpServerConfig(name, serverConfig, existingNames);
            if (validation.ok) {
                stateManager.setMcpServer(name, validation.data);
                existingNames.push(name);
                if (validation.data.enabled !== false) {
                    mcpManager.connectServer(name, validation.data).catch((err) => {
                        logger.warn(`Failed to connect persisted MCP server '${name}': ${err}`);
                    });
                }
            }
        }
    } catch {
    }

    const sessionManager = new SessionManager(
        {
            stateManager,
            systemPromptManager,
            toolManager,
            approvalManager,
            agentEventBus,
            sessionStore,
            conversationStore,
            resourceManager,
            hookManager,
            mcpManager,
            steerQueueStore,
            followUpQueueStore,
            compactionStrategy: compactionStrategy ?? null,
            workspaceManager,
        },
        {
            sessionTTL: config.sessions?.sessionTTL,
            ...(overrides?.sessionLoggerFactory !== undefined && {
                sessionLoggerFactory: overrides.sessionLoggerFactory,
            }),
            ...(overrides?.languageModelFactory !== undefined && {
                languageModelFactory: overrides.languageModelFactory,
            }),
            ...(overrides?.authResolver !== undefined && {
                authResolver: overrides.authResolver,
            }),
            ...(overrides?.executionControl !== undefined && {
                executionControl: overrides.executionControl,
            }),
        },
        logger
    );

    await sessionManager.init();

    logger.debug('Session manager initialized with storage support');

    toolManager.setHookSupport(hookManager, sessionManager, stateManager);
    logger.debug('Hook support connected to ToolManager');

    return {
        mcpManager,
        toolManager,
        systemPromptManager,
        agentEventBus,
        stateManager,
        sessionManager,
        workspaceManager,
        searchService,
        stores,
        resourceManager,
        approvalManager,
        memoryManager,
        hookManager,
    };
}
