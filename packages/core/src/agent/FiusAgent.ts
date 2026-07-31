import { randomUUID } from 'crypto';
import { setMaxListeners } from 'events';
import { ZodError } from 'zod';
import { MCPManager } from '../mcp/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { SkillsContributor } from '../systemPrompt/contributors.js';
import {
    CompositeSkillManager,
    GlobalSkillSource,
    type SkillManager,
    type SkillSource,
} from '../skills/index.js';
import { ResourceManager, expandMessageReferences } from '../resources/index.js';
import { expandBlobReferences, fileTypesToMimePatterns } from '../context/utils.js';
import type { ContentPart, InternalMessage } from '../context/types.js';
import { PromptManager } from '../prompts/index.js';
import type { PromptsConfig } from '../prompts/schemas.js';
import { AgentStateManager } from './state-manager.js';
import { SessionManager, ChatSession, SessionError } from '../session/index.js';
import type { QueuedMessage, SessionMetadata } from '../session/index.js';
import type { UserMessageInput } from '../session/message-queue.js';
import {
    AgentServices,
    type InitializeServicesOptions,
    type ToolkitLoader,
} from '../utils/service-initializer.js';
import type { Logger, LogLevel } from '../logger/v2/types.js';
import { resolveAndValidateLLMConfig } from '../llm/resolver.js';
import { validateInputForLLM } from '../llm/validation.js';
import { LLMError } from '../llm/errors.js';
import { AgentError } from './errors.js';
import { MCPError } from '../mcp/errors.js';
import { MCPErrorCode } from '../mcp/error-codes.js';
import { addPersistedMcpServer, removePersistedMcpServer } from '../mcp/mcp-persistence.js';
import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { FiusValidationError } from '../errors/FiusValidationError.js';
import { ensureOk } from '../errors/result-bridge.js';
import { fail, zodToIssues } from '../utils/result.js';
import { resolveAndValidateMcpServerConfig } from '../mcp/resolver.js';
import type {
    McpServerConfig,
    McpServerStatus,
    McpConnectionStatus,
    ValidatedMcpServerConfig,
} from '../mcp/schemas.js';
import {
    getSupportedProviders,
    getDefaultModelForProvider,
    getProviderFromModel,
    getSupportedFileTypesForModel,
    getModelDisplayName,
    type ModelInfo,
} from '@fius/llm';
import { getAllModelsForProvider } from '../llm/registry/index.js';
import type { LLMProvider } from '@fius/llm';
import { createAgentServices } from '../utils/service-initializer.js';
import { LLMConfigSchema, LLMUpdatesSchema } from '../llm/schemas.js';
import type { LLMUpdates, ValidatedLLMConfig } from '../llm/schemas.js';
import { summarizeAssistantUsage } from '../llm/usage-summary.js';
import { ServersConfigSchema } from '../mcp/schemas.js';
import { MemoriesConfigSchema } from '../memory/schemas.js';
import { PromptsSchema } from '../prompts/schemas.js';
import { ResourcesConfigSchema } from '../resources/schemas.js';
import { SessionConfigSchema } from '../session/schemas.js';
import { SystemPromptConfigSchema } from '../systemPrompt/schemas.js';
import { SessionPromptContributorSchema } from '../systemPrompt/schemas.js';
import { ElicitationConfigSchema, PermissionsConfigSchema } from '../tools/schemas.js';
import { AgentCardSchema } from './schemas.js';
import type { AgentRuntimeSettings, FiusAgentConfigInput } from './runtime-config.js';
import { UsageScopeIdSchema } from '../llm/usage-scope.js';
import {
    AgentEventBus,
    type AgentEventMap,
    type EventArgs,
    type EventListener,
    type StreamingEvent,
    type StreamingEventName,
} from '../events/index.js';
import type { McpClient } from '../mcp/types.js';
import type { Tool, ToolSet } from '../tools/types.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import { SearchService } from '../search/index.js';
import type { SearchOptions, SearchResponse, SessionSearchResponse } from '../search/index.js';
import { safeStringify } from '../utils/safe-stringify.js';
import {
    deriveHeuristicTitle,
    generateSessionTitle,
    type GenerateSessionTitleTokenUsage,
} from '../session/title-generator.js';
import type { ApprovalHandler } from '../approval/types.js';
import type { FiusAgentOptions } from './agent-options.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import type { SetWorkspaceInput, WorkspaceContext } from '../workspace/types.js';
import { createAgentRunContext } from '../runtime/run-context.js';

const requiredServices: (keyof AgentServices)[] = [
    'mcpManager',
    'toolManager',
    'systemPromptManager',
    'agentEventBus',
    'stateManager',
    'sessionManager',
    'workspaceManager',
    'searchService',
    'memoryManager',
];

export interface AgentEventSubscriber {
    subscribe(eventBus: AgentEventBus): void;
}

export type SessionTitleSource = 'existing' | 'llm' | 'heuristic';

export interface SessionTitleGenerationDetails {
    title: string;
    source: SessionTitleSource;
    reason?: string;
    timedOut?: boolean;
    tokenUsage?: GenerateSessionTitleTokenUsage;
}

export class FiusAgent {
    
    public readonly mcpManager!: MCPManager;
    public readonly systemPromptManager!: SystemPromptManager;
    private readonly agentEventBus: AgentEventBus;
    public readonly promptManager!: PromptManager;
    public readonly skillManager!: SkillManager;
    public readonly stateManager!: AgentStateManager;
    public readonly sessionManager!: SessionManager;
    public readonly workspaceManager!: WorkspaceManager;
    public readonly toolManager!: ToolManager;
    public readonly resourceManager!: ResourceManager;
    public readonly memoryManager!: import('../memory/index.js').MemoryManager;
    public readonly services!: AgentServices;

    private searchService!: SearchService;
    private _isStarted: boolean = false;
    private _isStopped: boolean = false;
    public config: AgentRuntimeSettings;
    private eventSubscribers: Set<AgentEventSubscriber> = new Set();
    private approvalHandler?: ApprovalHandler | undefined;
    private mcpAuthProviderFactory: import('../mcp/types.js').McpAuthProviderFactory | null = null;

    private activeStreamControllers: Map<string, AbortController> = new Map();
    private readonly overrides: InitializeServicesOptions;
    private readonly toolkitLoader: ToolkitLoader | undefined;
    private readonly loadedToolkits: Set<string> = new Set();
    private readonly loadingToolkits: Set<string> = new Set();
    private readonly skillSources: SkillSource[];

    private tools: Tool[];
    private readonly compactionStrategy: CompactionStrategy | null;
    public readonly logger: Logger;

    
    public static validateConfig(options: FiusAgentConfigInput): AgentRuntimeSettings {
        return {
            agentId: options.agentId,
            llm: LLMConfigSchema.parse(options.llm),
            systemPrompt: SystemPromptConfigSchema.parse(options.systemPrompt),
            mcpServers: ServersConfigSchema.parse(options.mcpServers ?? {}),
            sessions: SessionConfigSchema.parse(options.sessions ?? {}),
            permissions: PermissionsConfigSchema.parse(options.permissions ?? {}),
            elicitation: ElicitationConfigSchema.parse(options.elicitation ?? {}),
            resources: ResourcesConfigSchema.parse(options.resources ?? []),
            prompts: PromptsSchema.parse(options.prompts),
            ...(options.usageScopeId !== undefined && {
                usageScopeId: UsageScopeIdSchema.parse(options.usageScopeId),
            }),
            ...(options.agentCard !== undefined && {
                agentCard: AgentCardSchema.parse(options.agentCard),
            }),
            ...(options.greeting !== undefined && { greeting: options.greeting }),
            ...(options.memories !== undefined && {
                memories: MemoriesConfigSchema.parse(options.memories),
            }),
        };
    }

    
    constructor(options: FiusAgentOptions) {
        const {
            logger,
            stores,
            tools: toolsInput,
            hooks: hooksInput,
            compaction,
            overrides: overridesInput,
            ...runtimeSettings
        } = options;

        const tools = toolsInput ?? [];
        const hooks = hooksInput ?? [];

        this.config = FiusAgent.validateConfig(runtimeSettings);

        this.logger = logger;

        this.tools = tools;
        this.compactionStrategy = compaction ?? null;

        const overrides: InitializeServicesOptions = { ...(overridesInput ?? {}) };

        if (overrides.stores === undefined) {
            overrides.stores = stores;
        }

        if (overrides.hooks === undefined) {
            overrides.hooks = hooks;
        }

        this.overrides = overrides;
        this.toolkitLoader = options.toolkitLoader;
        this.skillSources = options.skillSources ?? [];

        if (overrides.mcpAuthProviderFactory !== undefined) {
            this.mcpAuthProviderFactory = overrides.mcpAuthProviderFactory;
        }

        this.agentEventBus = new AgentEventBus();

        this.logger.info('FiusAgent created.');
    }

    
    public async start(): Promise<void> {
        if (this._isStarted) {
            throw AgentError.alreadyStarted();
        }

        try {
            this.logger.info('Starting FiusAgent...');

            const services = await createAgentServices(
                this.config,
                this.logger,
                this.agentEventBus,
                this.overrides,
                this.compactionStrategy
            );

            if (this.mcpAuthProviderFactory) {
                services.mcpManager.setAuthProviderFactory(this.mcpAuthProviderFactory);
            }

            for (const service of requiredServices) {
                if (!services[service]) {
                    throw AgentError.initializationFailed(
                        `Required service ${service} is missing during agent start`
                    );
                }
            }

            const needsHandler =
                this.config.permissions.mode === 'manual' || this.config.elicitation.enabled;

            if (needsHandler && !this.approvalHandler) {
                const reasons = [];
                if (this.config.permissions.mode === 'manual') {
                    reasons.push('permissions mode is "manual"');
                }
                if (this.config.elicitation.enabled) {
                    reasons.push('elicitation is enabled');
                }

                throw AgentError.initializationFailed(
                    `An approval handler is required but not configured (${reasons.join(' and ')}).\n` +
                        'Either:\n' +
                        '  • Call agent.setApprovalHandler() before starting\n' +
                        '  • Set permissions: { mode: "auto-approve" }\n' +
                        '  • Disable elicitation: { enabled: false }'
                );
            }

            if (this.approvalHandler) {
                services.approvalManager.setHandler(this.approvalHandler);
            }

            Object.assign(this, {
                mcpManager: services.mcpManager,
                toolManager: services.toolManager,
                resourceManager: services.resourceManager,
                systemPromptManager: services.systemPromptManager,
                stateManager: services.stateManager,
                sessionManager: services.sessionManager,
                workspaceManager: services.workspaceManager,
                memoryManager: services.memoryManager,
                services: services,
            });

            const promptManager = new PromptManager(
                this.mcpManager,
                this.resourceManager,
                this.config,
                this.agentEventBus,
                services.stores,
                this.logger
            );
            await promptManager.initialize();
            const skillManager = new CompositeSkillManager([
                ...this.skillSources,
                new GlobalSkillSource(),
            ]);
            Object.assign(this, { promptManager, skillManager });

            const toolExecutionServices = {
                approval: services.approvalManager,
                search: services.searchService,
                resources: services.resourceManager,
                prompts: promptManager,
                skills: skillManager,
                mcp: services.mcpManager,
                taskForker: null,
                workspaceManager: services.workspaceManager,
            };
            services.toolManager.setToolExecutionContextFactory((baseContext) => ({
                ...baseContext,
                ...(baseContext.runContext?.hostRuntime !== undefined && {
                    hostRuntime: baseContext.runContext.hostRuntime,
                }),
                agent: this,
                toolState: services.stores.getStore('toolState'),
                services: toolExecutionServices,
            }));

            const agentTools = this.tools;

            if (agentTools.some((t) => t.id === 'invoke_skill')) {
                const skillsContributor = new SkillsContributor(
                    'skills',
                50,
                skillManager,
                    this.logger
                );
                services.systemPromptManager.addContributor(skillsContributor);
                this.logger.debug('Added SkillsContributor to system prompt');
            }

            services.toolManager.setTools(agentTools);

            await services.toolManager.initialize();

            this.searchService = services.searchService;

            this._isStarted = true;
            this._isStopped = false;
            this.logger.info('FiusAgent started successfully.');

            for (const subscriber of this.eventSubscribers) {
                subscriber.subscribe(this.agentEventBus);
            }
        } catch (error) {
            this.logger.error('Failed to start FiusAgent', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    
    public async stop(): Promise<void> {
        if (this._isStopped) {
            this.logger.warn('Agent is already stopped');
            return;
        }

        if (!this._isStarted) {
            throw AgentError.notStarted();
        }

        try {
            this.logger.info('Stopping FiusAgent...');

            const shutdownErrors: Error[] = [];

            try {
                if (this.sessionManager) {
                    await this.sessionManager.cleanup();
                    this.logger.debug('SessionManager cleaned up successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`SessionManager cleanup failed: ${err.message}`));
            }

            try {
                if (this.toolManager) {
                    await this.toolManager.cleanup();
                    this.logger.debug('ToolManager cleaned up successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`ToolManager cleanup failed: ${err.message}`));
            }

            try {
                if (this.services?.hookManager) {
                    await this.services.hookManager.cleanup();
                    this.logger.debug('HookManager cleaned up successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`HookManager cleanup failed: ${err.message}`));
            }

            try {
                if (this.mcpManager) {
                    await this.mcpManager.disconnectAll();
                    this.logger.debug('MCPManager disconnected all clients successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`MCPManager disconnect failed: ${err.message}`));
            }

            try {
                if (this.resourceManager) {
                    this.resourceManager.cleanup();
                    this.logger.debug('ResourceManager cleaned up successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`ResourceManager cleanup failed: ${err.message}`));
            }

            try {
                if (this.services?.stores) {
                    await this.services.stores.disconnect();
                    this.logger.debug('Stores disconnected successfully');
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                shutdownErrors.push(new Error(`Store disconnect failed: ${err.message}`));
            }

            this._isStopped = true;
            this._isStarted = false;

            if (shutdownErrors.length > 0) {
                const errorMessages = shutdownErrors.map((e) => e.message).join('; ');
                this.logger.warn(`FiusAgent stopped with some errors: ${errorMessages}`);
            } else {
                this.logger.info('FiusAgent stopped successfully.');
            }

            this.agentEventBus.emit('agent:stopped');
        } catch (error) {
            this.logger.error('Failed to stop FiusAgent', {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    
    public registerSubscriber(subscriber: AgentEventSubscriber): void {
        this.eventSubscribers.add(subscriber);
        if (this._isStarted) {
            subscriber.subscribe(this.agentEventBus);
        }
    }

    
    public on<K extends keyof AgentEventMap>(
        event: K,
        listener: EventListener<AgentEventMap[K]>,
        options?: { signal?: AbortSignal }
    ): this {
        this.agentEventBus.on(event, listener, options);
        return this;
    }

    public once<K extends keyof AgentEventMap>(
        event: K,
        listener: EventListener<AgentEventMap[K]>,
        options?: { signal?: AbortSignal }
    ): this {
        this.agentEventBus.once(event, listener, options);
        return this;
    }

    public off<K extends keyof AgentEventMap>(
        event: K,
        listener: EventListener<AgentEventMap[K]>
    ): this {
        this.agentEventBus.off(event, listener);
        return this;
    }

    public emit<K extends keyof AgentEventMap>(
        event: K,
        ...args: EventArgs<AgentEventMap[K]>
    ): boolean {
        return this.agentEventBus.emit(event, ...args);
    }

    
    public async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    
    public isStarted(): boolean {
        return this._isStarted;
    }

    
    public isStopped(): boolean {
        return this._isStopped;
    }

    
    private ensureStarted(): void {
        if (this._isStopped) {
            this.logger.warn('Agent is stopped');
            throw AgentError.stopped();
        }
        if (!this._isStarted) {
            this.logger.warn('Agent is not started');
            throw AgentError.notStarted();
        }
    }

    public async run(
        textInput: string,
        imageDataInput: { image: string; mimeType: string } | undefined,
        fileDataInput: { data: string; mimeType: string; filename?: string } | undefined,
        sessionId: string,
        _stream: boolean = false
    ): Promise<string> {
        const parts: import('./types.js').ContentPart[] = [];

        if (textInput) {
            parts.push({ type: 'text', text: textInput });
        }

        if (imageDataInput) {
            parts.push({
                type: 'image',
                image: imageDataInput.image,
                mimeType: imageDataInput.mimeType,
            });
        }

        if (fileDataInput) {
            parts.push({
                type: 'file',
                data: fileDataInput.data,
                mimeType: fileDataInput.mimeType,
                ...(fileDataInput.filename && { filename: fileDataInput.filename }),
            });
        }

        const response = await this.generate(parts.length > 0 ? parts : textInput, sessionId);
        return response.content;
    }

    
    public async generate(
        content: import('./types.js').ContentInput,
        sessionId: string,
        options?: import('./types.js').GenerateOptions
    ): Promise<import('./types.js').GenerateResponse> {
        const events: StreamingEvent[] = [];

        for await (const event of await this.stream(content, sessionId, options)) {
            events.push(event);
        }

        const fatalErrorEvent = events.find(
            (e): e is Extract<StreamingEvent, { name: 'llm:error' }> =>
                e.name === 'llm:error' && e.recoverable !== true
        );
        if (fatalErrorEvent) {
            if (
                fatalErrorEvent.error instanceof FiusRuntimeError ||
                fatalErrorEvent.error instanceof FiusValidationError
            ) {
                throw fatalErrorEvent.error;
            }
            const llmConfig = this.stateManager.getLLMConfig(sessionId);
            throw LLMError.generationFailed(
                fatalErrorEvent.error.message,
                llmConfig.provider,
                llmConfig.model
            );
        }

        const responseEvents = events.filter(
            (e): e is Extract<StreamingEvent, { name: 'llm:response' }> => e.name === 'llm:response'
        );
        const responseEvent = responseEvents[responseEvents.length - 1];
        if (!responseEvent || responseEvent.name !== 'llm:response') {
            const llmConfig = this.stateManager.getLLMConfig(sessionId);
            throw LLMError.generationFailed(
                'Stream did not complete successfully - no response received',
                llmConfig.provider,
                llmConfig.model
            );
        }

        const toolCallEvents = events.filter(
            (e): e is Extract<StreamingEvent, { name: 'llm:tool-call' }> =>
                e.name === 'llm:tool-call'
        );
        const toolResultEvents = events.filter(
            (e): e is Extract<StreamingEvent, { name: 'llm:tool-result' }> =>
                e.name === 'llm:tool-result'
        );

        const toolCalls: import('./types.js').AgentToolCall[] = toolCallEvents.map((tc) => {
            const toolResult = toolResultEvents.find((tr) => tr.callId === tc.callId);
            return {
                toolName: tc.toolName,
                args: tc.args,
                callId: tc.callId,
                result: toolResult
                    ? {
                          success: toolResult.success,
                          data: toolResult.sanitized,
                      }
                    : undefined,
            };
        });

        return {
            content: responseEvent.content,
            reasoning: responseEvent.reasoning,
            usage: responseEvent.tokenUsage as import('./types.js').TokenUsage,
            toolCalls,
            sessionId,
            ...(responseEvent.messageId && { messageId: responseEvent.messageId }),
            ...(responseEvent.usageScopeId && { usageScopeId: responseEvent.usageScopeId }),
            provider: responseEvent.provider,
            model: responseEvent.model,
            ...(responseEvent.estimatedCost !== undefined && {
                estimatedCost: responseEvent.estimatedCost,
            }),
            ...(responseEvent.pricingStatus && { pricingStatus: responseEvent.pricingStatus }),
            ...(responseEvent.hostRuntime && { hostRuntime: responseEvent.hostRuntime }),
        };
    }

    
    public async stream(
        content: import('./types.js').ContentInput,
        sessionId: string,
        options?: import('./types.js').StreamOptions
    ): Promise<AsyncIterableIterator<StreamingEvent>> {
        this.ensureStarted();

        if (!sessionId) {
            throw AgentError.apiValidationError('sessionId is required');
        }

        if (this.activeStreamControllers.has(sessionId)) {
            throw AgentError.sessionBusy(sessionId);
        }

        const signal = options?.signal;
        const disconnectSignal = options?.disconnectSignal ?? signal;
        let runContext;
        try {
            runContext = createAgentRunContext({
                sessionId,
                hostRuntime: options?.executionContext,
            });
        } catch (error) {
            if (error instanceof ZodError) {
                throw AgentError.apiValidationError(
                    'executionContext is invalid',
                    zodToIssues(error)
                );
            }
            throw error;
        }
        const executionContext = runContext.hostRuntime;

        let contentParts: import('./types.js').ContentPart[] =
            typeof content === 'string' ? [{ type: 'text', text: content }] : [...content];

        const eventQueue: StreamingEvent[] = [];
        let completed = false;
        let terminalError: Error | undefined;
        let sawFatalErrorEvent = false;
        let sawRunCompleteEvent = false;

        const controller = new AbortController();
        const cleanupSignal = controller.signal;

        this.activeStreamControllers.set(sessionId, controller);

        setMaxListeners(30, cleanupSignal);

        const listenerCleanups: Array<() => void> = [];
        let detachDisconnectAbortListener: (() => void) | undefined;

        const addStreamingListener = <K extends StreamingEventName>(
            event: K,
            listener: EventListener<AgentEventMap[K]>
        ) => {
            this.agentEventBus.on(event, listener, { signal: cleanupSignal });
            listenerCleanups.push(() => {
                this.agentEventBus.off(event, listener);
            });
        };

        const cleanupListeners = () => {
            detachDisconnectAbortListener?.();
            detachDisconnectAbortListener = undefined;
            this.activeStreamControllers.delete(sessionId);

            if (listenerCleanups.length === 0) {
                return;
            }
            for (const removeListener of listenerCleanups) {
                removeListener();
            }
            listenerCleanups.length = 0;
        };

        try {
            const existingSession = await this.sessionManager.getSession(sessionId, false);
            if (existingSession?.isBusy?.()) {
                throw AgentError.sessionBusy(sessionId);
            }
        } catch (error) {
            cleanupListeners();
            controller.abort();
            throw error;
        }

        if (disconnectSignal) {
            const abortHandler = () => {
                cleanupListeners();
                controller.abort();
            };
            disconnectSignal.addEventListener('abort', abortHandler, { once: true });
            detachDisconnectAbortListener = () =>
                disconnectSignal.removeEventListener('abort', abortHandler);
        }

        const thinkingListener = (data: AgentEventMap['llm:thinking']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:thinking', ...data });
        };
        addStreamingListener('llm:thinking', thinkingListener);

        const chunkListener = (data: AgentEventMap['llm:chunk']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:chunk', ...data });
        };
        addStreamingListener('llm:chunk', chunkListener);

        const responseListener = (data: AgentEventMap['llm:response']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:response', ...data });
        };
        addStreamingListener('llm:response', responseListener);

        const interactionBlockedListener = (data: AgentEventMap['interaction:blocked']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'interaction:blocked', ...data });
        };
        addStreamingListener('interaction:blocked', interactionBlockedListener);

        const toolCallListener = (data: AgentEventMap['llm:tool-call']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:tool-call', ...data });
        };
        addStreamingListener('llm:tool-call', toolCallListener);

        const toolCallPartialListener = (data: AgentEventMap['llm:tool-call-partial']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:tool-call-partial', ...data });
        };
        addStreamingListener('llm:tool-call-partial', toolCallPartialListener);

        const toolResultListener = (data: AgentEventMap['llm:tool-result']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:tool-result', ...data });
        };
        addStreamingListener('llm:tool-result', toolResultListener);

        const retryingListener = (data: AgentEventMap['llm:retrying']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:retrying', ...data });
        };
        addStreamingListener('llm:retrying', retryingListener);

        const errorListener = (data: AgentEventMap['llm:error']) => {
            if (data.sessionId !== sessionId) return;
            if (data.recoverable !== true) {
                sawFatalErrorEvent = true;
                terminalError = data.error;
            }
            eventQueue.push({ name: 'llm:error', ...data });
        };
        addStreamingListener('llm:error', errorListener);

        const unsupportedInputListener = (data: AgentEventMap['llm:unsupported-input']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'llm:unsupported-input', ...data });
        };
        addStreamingListener('llm:unsupported-input', unsupportedInputListener);

        const titleUpdatedListener = (data: AgentEventMap['session:title-updated']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'session:title-updated', ...data });
        };
        addStreamingListener('session:title-updated', titleUpdatedListener);

        const approvalRequestListener = (data: AgentEventMap['approval:request']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'approval:request', ...data });
        };
        addStreamingListener('approval:request', approvalRequestListener);

        const approvalResponseListener = (data: AgentEventMap['approval:response']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'approval:response', ...data });
        };
        addStreamingListener('approval:response', approvalResponseListener);

        const toolRunningListener = (data: AgentEventMap['tool:running']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'tool:running', ...data });
        };
        addStreamingListener('tool:running', toolRunningListener);

        const contextCompactingListener = (data: AgentEventMap['context:compacting']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'context:compacting', ...data });
        };
        addStreamingListener('context:compacting', contextCompactingListener);

        const contextCompactedListener = (data: AgentEventMap['context:compacted']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'context:compacted', ...data });
        };
        addStreamingListener('context:compacted', contextCompactedListener);

        const messageQueuedListener = (data: AgentEventMap['message:queued']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'message:queued', ...data });
        };
        addStreamingListener('message:queued', messageQueuedListener);

        const messageDequeuedListener = (data: AgentEventMap['message:dequeued']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'message:dequeued', ...data });
        };
        addStreamingListener('message:dequeued', messageDequeuedListener);

        const serviceEventListener = (data: AgentEventMap['service:event']) => {
            if (data.sessionId !== sessionId) return;
            eventQueue.push({ name: 'service:event', ...data });
        };
        addStreamingListener('service:event', serviceEventListener);

        const runCompleteListener = (data: AgentEventMap['run:complete']) => {
            if (data.sessionId !== sessionId) return;
            sawRunCompleteEvent = true;
            if (data.finishReason === 'error' && data.error !== undefined) {
                terminalError = data.error;
            }
            eventQueue.push({ name: 'run:complete', ...data });
            completed = true;
        };
        addStreamingListener('run:complete', runCompleteListener);

        (async () => {
                try {
                    const llmConfig = this.stateManager.getLLMConfig(sessionId);

                    const textParts = contentParts.filter(
                        (p): p is import('./types.js').TextPart => p.type === 'text'
                    );
                    const textContent = textParts.map((p) => p.text).join('\n');
                    const imageParts = contentParts.filter(
                        (p): p is import('./types.js').ImagePart => p.type === 'image'
                    );
                    const fileParts = contentParts.filter(
                        (p): p is import('./types.js').FilePart => p.type === 'file'
                    );

                    this.logger.debug(
                        `FiusAgent.stream: sessionId=${sessionId}, textLength=${textContent?.length ?? 0}, imageCount=${imageParts.length}, fileCount=${fileParts.length}`
                    );

                    const validatePromptContentParts = (
                        parts: import('./types.js').ContentPart[]
                    ) => {
                        const currentTextParts = parts.filter(
                            (part): part is import('./types.js').TextPart => part.type === 'text'
                        );
                        const currentText = currentTextParts.map((part) => part.text).join('\n');
                        const currentImageParts = parts.filter(
                            (part): part is import('./types.js').ImagePart => part.type === 'image'
                        );
                        const currentFileParts = parts.filter(
                            (part): part is import('./types.js').FilePart => part.type === 'file'
                        );

                        const textValidation = validateInputForLLM(
                            { text: currentText },
                            { provider: llmConfig.provider, model: llmConfig.model },
                            this.logger
                        );
                        ensureOk(textValidation, this.logger);

                        for (const imagePart of currentImageParts) {
                            const imageValidation = validateInputForLLM(
                                {
                                    imageData: {
                                        image:
                                            typeof imagePart.image === 'string'
                                                ? imagePart.image
                                                : imagePart.image.toString(),
                                        mimeType: imagePart.mimeType || 'image/png',
                                    },
                                },
                                { provider: llmConfig.provider, model: llmConfig.model },
                                this.logger
                            );
                            ensureOk(imageValidation, this.logger);
                        }

                        for (const filePart of currentFileParts) {
                            const fileValidation = validateInputForLLM(
                                {
                                    fileData: {
                                        data:
                                            typeof filePart.data === 'string'
                                                ? filePart.data
                                                : filePart.data.toString(),
                                        mimeType: filePart.mimeType,
                                    },
                                },
                                { provider: llmConfig.provider, model: llmConfig.model },
                                this.logger
                            );
                            ensureOk(fileValidation, this.logger);
                        }
                    };

                    let allowedMediaTypes: string[] | undefined = llmConfig.allowedMediaTypes;
                    if (!allowedMediaTypes) {
                        allowedMediaTypes = fileTypesToMimePatterns(
                            getSupportedFileTypesForModel(llmConfig.provider, llmConfig.model),
                            this.logger
                        );
                    }

                    if (contentParts.some((part) => part.type === 'resource')) {
                        contentParts = await expandBlobReferences(
                            contentParts,
                            this.resourceManager,
                            this.logger,
                            allowedMediaTypes
                        );
                    }

                    if (textContent.includes('@')) {
                        try {
                            const resources = await this.resourceManager.list();
                            const expansion = await expandMessageReferences(
                                textContent,
                                resources,
                                (uri) => this.resourceManager.read(uri),
                                allowedMediaTypes
                            );

                            if (expansion.unresolvedReferences.length > 0) {
                                const unresolvedNames = expansion.unresolvedReferences
                                    .map((ref) => ref.originalRef)
                                    .join(', ');
                                this.logger.warn(
                                    `Could not resolve ${expansion.unresolvedReferences.length} resource reference(s): ${unresolvedNames}`
                                );
                            }

                            const MAX_EXPANDED_SIZE = 5 * 1024 * 1024;
                            const expandedSize = Buffer.byteLength(
                                expansion.expandedMessage,
                                'utf-8'
                            );
                            if (expandedSize > MAX_EXPANDED_SIZE) {
                                this.logger.warn(
                                    `Expanded message size (${(expandedSize / 1024 / 1024).toFixed(2)}MB) exceeds limit (${MAX_EXPANDED_SIZE / 1024 / 1024}MB). Content may be truncated.`
                                );
                            }

                            contentParts = contentParts.filter((p) => p.type !== 'text');
                            if (expansion.expandedMessage.trim()) {
                                contentParts.unshift({
                                    type: 'text',
                                    text: expansion.expandedMessage,
                                });
                            }

                            for (const resource of expansion.extractedResources) {
                                if (resource.kind === 'image') {
                                    contentParts.push({
                                        type: 'image',
                                        image: resource.data,
                                        mimeType: resource.mimeType,
                                    });
                                } else {
                                    contentParts.push({
                                        type: 'file',
                                        data: resource.data,
                                        mimeType: resource.mimeType,
                                        filename: resource.name,
                                    });
                                }
                                this.logger.debug(
                                    `Added extracted resource: ${resource.name} (${resource.mimeType})`
                                );
                            }
                        } catch (error) {
                            this.logger.error(
                                `Failed to expand resource references: ${error instanceof Error ? error.message : String(error)}. Continuing with original message.`
                            );
                        }
                    }

                    const hasTextContent = contentParts.some(
                        (p) => p.type === 'text' && p.text.trim()
                    );
                    const hasMediaContent = contentParts.some(
                        (p) => p.type === 'image' || p.type === 'file' || p.type === 'resource'
                    );
                    if (!hasTextContent && !hasMediaContent) {
                        this.logger.warn(
                            'Resource expansion resulted in empty content. Using original message.'
                        );
                        contentParts = [{ type: 'text', text: textContent }];
                    }

                    validatePromptContentParts(contentParts);

                    const session: ChatSession =
                        (await this.sessionManager.getSession(sessionId)) ||
                        (await this.sessionManager.createSession(sessionId));

                    await session.stream(contentParts, {
                        ...(signal ? { signal } : {}),
                        runContext,
                    });

                    this.sessionManager
                        .incrementMessageCount(session.id)
                        .catch((error) =>
                            this.logger.warn(
                                `Failed to increment message count: ${error instanceof Error ? error.message : String(error)}`
                            )
                        );
                } catch (err) {
                    const error =
                        err instanceof FiusRuntimeError || err instanceof FiusValidationError
                            ? err
                            : err instanceof Error
                              ? err
                              : AgentError.streamFailed(String(err));

                    if (sawFatalErrorEvent || sawRunCompleteEvent) {
                        if (!sawRunCompleteEvent) {
                            completed = true;
                        }
                        this.logger.debug(
                            `Suppressing duplicate terminal stream error: ${error.message}`
                        );
                        return;
                    }

                    completed = true;
                    terminalError = error;
                    this.logger.error(`Error in FiusAgent.stream: ${error.message}`);

                    const errorEvent: { name: 'llm:error' } & AgentEventMap['llm:error'] = {
                        name: 'llm:error',
                        error,
                        recoverable: false,
                        context: 'run_failed',
                        sessionId,
                        ...(executionContext !== undefined && { hostRuntime: executionContext }),
                    };
                    eventQueue.push(errorEvent);
                }
        })();

        const iterator: AsyncIterableIterator<StreamingEvent> = {
            async next(): Promise<IteratorResult<StreamingEvent>> {
                while (!completed && eventQueue.length === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 0));

                    if (disconnectSignal?.aborted || cleanupSignal.aborted) {
                        cleanupListeners();
                        controller.abort();
                        return { done: true, value: undefined };
                    }
                }

                if (eventQueue.length > 0) {
                    return { done: false, value: eventQueue.shift()! };
                }

                if (completed) {
                    cleanupListeners();
                    controller.abort();
                    if (terminalError !== undefined) {
                        throw terminalError;
                    }
                    return { done: true, value: undefined };
                }

                cleanupListeners();
                return { done: true, value: undefined };
            },

            async return(): Promise<IteratorResult<StreamingEvent>> {
                cleanupListeners();
                controller.abort();
                return { done: true, value: undefined };
            },

            [Symbol.asyncIterator]() {
                return iterator;
            },
        };

        return iterator;
    }

    
    public async isSessionBusy(sessionId: string): Promise<boolean> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        return session?.isBusy?.() ?? false;
    }

    
    public async steer(
        sessionId: string,
        message: UserMessageInput
    ): Promise<{ queued: true; position: number; id: string }> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.steer(message);
    }

    
    public async followUp(
        sessionId: string,
        message: UserMessageInput
    ): Promise<{ queued: true; position: number; id: string }> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.followUp(message);
    }

    
    public async getSteerMessages(sessionId: string): Promise<QueuedMessage[]> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.getSteerMessages();
    }

    
    public async getFollowUpMessages(sessionId: string): Promise<QueuedMessage[]> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.getFollowUpMessages();
    }

    
    public async removeSteerMessage(sessionId: string, messageId: string): Promise<boolean> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.removeSteerMessage(messageId);
    }

    
    public async removeFollowUpMessage(sessionId: string, messageId: string): Promise<boolean> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.removeFollowUpMessage(messageId);
    }

    
    public async clearSteerQueue(sessionId: string): Promise<number> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.clearSteerQueue();
    }

    
    public async clearFollowUpQueue(sessionId: string): Promise<number> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.clearFollowUpQueue();
    }

    
    public async clearPendingInput(sessionId: string): Promise<number> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        return session.clearPendingInput();
    }

    
    public async cancel(sessionId: string): Promise<boolean> {
        this.ensureStarted();

        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        const streamController = this.activeStreamControllers.get(sessionId);
        if (streamController) {
            streamController.abort();
            this.activeStreamControllers.delete(sessionId);
        }

        const existing = await this.sessionManager.getSession(sessionId, false);
        if (existing) {
            return existing.cancel();
        }
        return !!streamController;
    }

    public async setWorkspace(input: SetWorkspaceInput): Promise<WorkspaceContext> {
        this.ensureStarted();
        return await this.workspaceManager.setWorkspace(input);
    }

    
    public async getWorkspace(): Promise<WorkspaceContext | undefined> {
        this.ensureStarted();
        return await this.workspaceManager.getWorkspace();
    }

    
    public async clearWorkspace(): Promise<void> {
        this.ensureStarted();
        await this.workspaceManager.clearWorkspace();
    }

    
    public async listWorkspaces(): Promise<WorkspaceContext[]> {
        this.ensureStarted();
        return await this.workspaceManager.listWorkspaces();
    }

    public async createSession(sessionId?: string): Promise<ChatSession> {
        this.ensureStarted();
        return await this.sessionManager.createSession(sessionId);
    }

    
    public async forkSession(parentSessionId: string): Promise<ChatSession> {
        this.ensureStarted();
        return await this.sessionManager.forkSession(parentSessionId);
    }

    
    public async getSession(sessionId: string): Promise<ChatSession | undefined> {
        this.ensureStarted();
        return await this.sessionManager.getSession(sessionId);
    }

    
    public async listSessions(): Promise<string[]> {
        this.ensureStarted();
        return await this.sessionManager.listSessions();
    }

    
    public async setLogLevel(level: LogLevel, options?: { sessionId?: string }): Promise<void> {
        this.ensureStarted();

        this.logger.setLevel(level);

        const sessionId = options?.sessionId;
        if (!sessionId) {
            return;
        }

        const session = await this.sessionManager.getSession(sessionId, false);
        if (!session) {
            return;
        }

        session.logger.setLevel(level);
        session.logger.debug(`Log level changed to '${level}'`);
    }

    
    public async endSession(sessionId: string): Promise<void> {
        this.ensureStarted();
        this.toolManager.clearSessionAutoApproveTools(sessionId);
        return this.sessionManager.endSession(sessionId);
    }

    
    public async deleteSession(sessionId: string): Promise<void> {
        this.ensureStarted();
        this.toolManager.clearSessionAutoApproveTools(sessionId);
        return this.sessionManager.deleteSession(sessionId);
    }

    
    public async clearSessionLLMOverride(sessionId: string): Promise<void> {
        this.ensureStarted();
        return this.sessionManager.clearPersistedSessionLLMOverride(sessionId);
    }

    
    public async getSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined> {
        this.ensureStarted();
        return await this.sessionManager.getSessionMetadata(sessionId);
    }

    
    public async setSessionTitle(sessionId: string, title: string): Promise<void> {
        this.ensureStarted();
        await this.sessionManager.setSessionTitle(sessionId, title);
    }

    
    public async getSessionTitle(sessionId: string): Promise<string | undefined> {
        this.ensureStarted();
        return await this.sessionManager.getSessionTitle(sessionId);
    }

    
    public async generateSessionTitle(sessionId: string): Promise<string | null> {
        const result = await this.generateSessionTitleDetails(sessionId);
        return result?.title ?? null;
    }

    
    public async generateSessionTitleDetails(
        sessionId: string
    ): Promise<SessionTitleGenerationDetails | null> {
        this.ensureStarted();

        const metadata = await this.sessionManager.getSessionMetadata(sessionId);
        if (!metadata) {
            throw SessionError.notFound(sessionId);
        }
        if (metadata.title) {
            this.logger.debug(
                `[SessionTitle] Session ${sessionId} already has title '${metadata.title}'`
            );
            return {
                source: 'existing',
                title: metadata.title,
            };
        }

        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        const history = await session.getHistory();
        const firstUserMsg = history.find((m) => m.role === 'user');
        if (!firstUserMsg) {
            this.logger.debug(`[SessionTitle] No user message found for session ${sessionId}`);
            return null;
        }

        const userText =
            typeof firstUserMsg.content === 'string'
                ? firstUserMsg.content
                : firstUserMsg.content
                      ?.filter((p) => p.type === 'text')
                      .map((p: { type: string; text: string }) => p.text)
                      .join(' ');

        if (!userText || !userText.trim()) {
            this.logger.debug(`[SessionTitle] Empty user text for session ${sessionId}`);
            return null;
        }

        const llmConfig = this.getEffectiveConfig(sessionId).llm;

        const result = await generateSessionTitle(llmConfig, userText, this.logger, {
            providerContext: {
                sessionId,
                authResolver: this.overrides.authResolver ?? null,
            },
            ...(this.overrides.languageModelFactory !== undefined && {
                languageModelFactory: this.overrides.languageModelFactory,
            }),
        });

        let title = result.title;
        if (!title) {
            title = deriveHeuristicTitle(userText);
            if (title) {
                this.logger.info(`[SessionTitle] Using heuristic title for ${sessionId}: ${title}`);
                const details = {
                    ...(result.error !== undefined && { reason: result.error }),
                    ...(result.timedOut !== undefined && { timedOut: result.timedOut }),
                    ...(result.usage !== undefined && { tokenUsage: result.usage }),
                    source: 'heuristic',
                    title,
                } satisfies SessionTitleGenerationDetails;
                await this.sessionManager.setSessionTitle(sessionId, title, { ifUnsetOnly: true });
                return details;
            } else {
                this.logger.debug(`[SessionTitle] No suitable title derived for ${sessionId}`);
                return null;
            }
        } else {
            this.logger.info(`[SessionTitle] Generated LLM title for ${sessionId}: ${title}`);
        }

        await this.sessionManager.setSessionTitle(sessionId, title, { ifUnsetOnly: true });

        return {
            source: 'llm',
            title,
            ...(result.usage !== undefined && { tokenUsage: result.usage }),
        };
    }

    
    public async getSessionHistory(
        sessionId: string,
        options?: { expandBlobReferences?: boolean }
    ): Promise<InternalMessage[]> {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }
        const history = await session.getHistory();
        const expandBlobReferencesByDefault = options?.expandBlobReferences ?? true;
        if (!this.resourceManager || !expandBlobReferencesByDefault) {
            return history;
        }

        return (await Promise.all(
            history.map(async (message): Promise<InternalMessage> => {
                if (!Array.isArray(message.content)) {
                    return message;
                }

                try {
                    const expandedContent = (
                        await Promise.all(
                            message.content.map(async (part): Promise<ContentPart[]> => {
                                try {
                                    if (
                                        part.type === 'text' &&
                                        typeof part.text === 'string' &&
                                        part.text.includes('@blob:')
                                    ) {
                                        return await expandBlobReferences(
                                            [part],
                                            this.resourceManager,
                                            this.logger
                                        );
                                    }

                                    if (
                                        part.type === 'image' &&
                                        typeof part.image === 'string' &&
                                        part.image.startsWith('@blob:')
                                    ) {
                                        const result = await this.resourceManager.read(
                                            part.image.slice(1)
                                        );
                                        for (const item of result.contents) {
                                            if (
                                                typeof item === 'object' &&
                                                item !== null &&
                                                'blob' in item &&
                                                typeof item.blob === 'string'
                                            ) {
                                                return [
                                                    {
                                                        type: 'image',
                                                        image: item.blob,
                                                        ...(typeof item.mimeType === 'string'
                                                            ? { mimeType: item.mimeType }
                                                            : part.mimeType !== undefined
                                                              ? { mimeType: part.mimeType }
                                                              : {}),
                                                    } satisfies ContentPart,
                                                ];
                                            }
                                        }
                                    }

                                    if (
                                        part.type === 'file' &&
                                        typeof part.data === 'string' &&
                                        part.data.startsWith('@blob:')
                                    ) {
                                        const result = await this.resourceManager.read(
                                            part.data.slice(1)
                                        );
                                        for (const item of result.contents) {
                                            if (
                                                typeof item === 'object' &&
                                                item !== null &&
                                                'blob' in item &&
                                                typeof item.blob === 'string'
                                            ) {
                                                return [
                                                    {
                                                        type: 'file',
                                                        data: item.blob,
                                                        mimeType:
                                                            typeof item.mimeType === 'string'
                                                                ? item.mimeType
                                                                : part.mimeType,
                                                        ...('filename' in item &&
                                                        typeof item.filename === 'string'
                                                            ? { filename: item.filename }
                                                            : part.filename !== undefined
                                                              ? { filename: part.filename }
                                                              : {}),
                                                    } satisfies ContentPart,
                                                ];
                                            }
                                        }
                                    }

                                    if (
                                        part.type === 'resource' &&
                                        typeof part.uri === 'string' &&
                                        part.uri.startsWith('blob:')
                                    ) {
                                        return await expandBlobReferences(
                                            [part],
                                            this.resourceManager,
                                            this.logger
                                        );
                                    }

                                    return [part];
                                } catch (error) {
                                    this.logger.warn(
                                        `Failed to expand blob content part in message: ${error instanceof Error ? error.message : String(error)}`
                                    );
                                    return [part];
                                }
                            })
                        )
                    ).flat();

                    return {
                        ...message,
                        content: expandedContent,
                    } as InternalMessage;
                } catch (error) {
                    this.logger.warn(
                        `Failed to expand blob references in message: ${error instanceof Error ? error.message : String(error)}`
                    );
                    return message;
                }
            })
        )) as InternalMessage[];
    }

    public async getSessionUsageSummary(sessionId: string, usageScopeId?: string) {
        this.ensureStarted();
        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        return summarizeAssistantUsage(await session.getHistory(), usageScopeId);
    }

    
    public async searchMessages(
        query: string,
        options: SearchOptions = {}
    ): Promise<SearchResponse> {
        this.ensureStarted();
        return await this.searchService.searchMessages(query, options);
    }

    
    public async searchSessions(query: string): Promise<SessionSearchResponse> {
        this.ensureStarted();
        return await this.searchService.searchSessions(query);
    }

    
    public async resetConversation(sessionId: string): Promise<void> {
        this.ensureStarted();

        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        try {
            await this.sessionManager.resetSession(sessionId);

            this.logger.info(`FiusAgent conversation reset for session: ${sessionId}`);
            this.agentEventBus.emit('session:reset', {
                sessionId: sessionId,
            });
        } catch (error) {
            this.logger.error(
                `Error during FiusAgent.resetConversation: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    
    public async clearContext(sessionId: string): Promise<void> {
        this.ensureStarted();

        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        const contextManager = session.getContextManager();
        await contextManager.clearContext();

        this.logger.info(`Context cleared for session: ${sessionId}`);
        this.agentEventBus.emit('context:cleared', {
            sessionId,
        });
    }

    
    public async compactContext(sessionId: string): Promise<{
        
        sessionId: string;
        
        compactedContextTokens: number;
        
        originalMessages: number;
        
        compactedMessages: number;
    } | null> {
        this.ensureStarted();

        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        const llmService = session.getLLMService();
        const compactionStrategy = llmService.getCompactionStrategy();

        if (!compactionStrategy) {
            this.logger.warn(
                `Compaction strategy not configured for session ${sessionId} - skipping manual compaction`
            );
            return null;
        }

        const contextManager = session.getContextManager();
        const history = await contextManager.getHistory();

        if (history.length < 4) {
            this.logger.debug(`Compaction skipped for session ${sessionId} - history too short`);
            return null;
        }

        const contributorContext = await this.toolManager.buildContributorContext({ sessionId });
        const tools = await llmService.getEnabledTools();
        const beforeEstimate = await contextManager.getContextTokenEstimate(
            contributorContext,
            tools
        );
        const originalTokens = beforeEstimate.estimated;
        const originalMessages = beforeEstimate.stats.filteredMessageCount;

        this.agentEventBus.emit('context:compacting', {
            estimatedTokens: originalTokens,
            sessionId,
        });

        const summaryMessages = await compactionStrategy.compact(history, {
            sessionId,
            model: llmService.getLanguageModel(),
            logger: session.logger,
        });

        if (summaryMessages.length === 0) {
            this.logger.debug(`Compaction skipped for session ${sessionId} - nothing to compact`);
            this.agentEventBus.emit('context:compacted', {
                originalTokens,
                compactedTokens: originalTokens,
                originalMessages,
                compactedMessages: originalMessages,
                strategy: compactionStrategy.name,
                reason: 'manual',
                sessionId,
            });
            return null;
        }

        for (const summary of summaryMessages) {
            await contextManager.addMessage(summary);
        }

        contextManager.resetActualTokenTracking();

        const afterEstimate = await contextManager.getContextTokenEstimate(
            contributorContext,
            tools
        );
        const compactedTokens = afterEstimate.estimated;
        const compactedMessages = afterEstimate.stats.filteredMessageCount;

        this.agentEventBus.emit('context:compacted', {
            originalTokens,
            compactedTokens,
            originalMessages,
            compactedMessages,
            strategy: compactionStrategy.name,
            reason: 'manual',
            sessionId,
        });

        this.logger.info(
            `Compaction complete for session ${sessionId}: ` +
                `${originalMessages} messages → ${compactedMessages} messages (~${compactedTokens} tokens)`
        );

        return {
            sessionId,
            compactedContextTokens: compactedTokens,
            originalMessages,
            compactedMessages,
        };
    }

    
    public async getContextStats(sessionId: string): Promise<{
        estimatedTokens: number;
        
        actualTokens: number | null;
        
        maxContextTokens: number;
        
        modelContextWindow: number;
        
        thresholdPercent: number;
        usagePercent: number;
        messageCount: number;
        filteredMessageCount: number;
        prunedToolCount: number;
        hasSummary: boolean;
        
        model: string;
        
        modelDisplayName: string;
        
        breakdown: {
            systemPrompt: number;
            tools: {
                total: number;
                
                perTool: Array<{ name: string; tokens: number }>;
            };
            messages: number;
        };
        
        calculationBasis?: {
            
            method: 'actuals' | 'estimate';
            
            lastInputTokens?: number;
            
            lastOutputTokens?: number;
            
            newMessagesEstimate?: number;
        };
    }> {
        this.ensureStarted();

        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        const contextManager = session.getContextManager();

        const contributorContext = await this.toolManager.buildContributorContext({ sessionId });
        const llmService = session.getLLMService();
        const tools = await llmService.getEnabledTools();

        const tokenEstimate = await contextManager.getContextTokenEstimate(
            contributorContext,
            tools
        );

        const history = await contextManager.getHistory();
        const runtimeConfig = this.stateManager.getRuntimeConfig(sessionId);
        const modelContextWindow = contextManager.getMaxInputTokens();
        const compactionStrategy = this.compactionStrategy;
        const compactionSettings = compactionStrategy?.getSettings();
        const thresholdPercent =
            compactionSettings && compactionSettings.enabled
                ? compactionSettings.thresholdPercent
                : 1.0;
        const modelLimits = compactionStrategy
            ? compactionStrategy.getModelLimits(modelContextWindow)
            : { contextWindow: modelContextWindow };
        const maxContextTokens =
            thresholdPercent < 1.0
                ? Math.floor(modelLimits.contextWindow * thresholdPercent)
                : modelLimits.contextWindow;

        const hasSummary = history.some(
            (msg) => msg.metadata?.isSummary === true || msg.metadata?.isSessionSummary === true
        );

        const llmConfig = runtimeConfig.llm;
        const modelDisplayName = getModelDisplayName(llmConfig.model, llmConfig.provider);

        const estimatedTokens = tokenEstimate.estimated;

        const autoCompactBuffer =
            thresholdPercent > 0 && thresholdPercent < 1.0
                ? Math.floor((maxContextTokens * (1 - thresholdPercent)) / thresholdPercent)
                : 0;
        const totalTokenSpace = maxContextTokens + autoCompactBuffer;
        const usedTokens = estimatedTokens + autoCompactBuffer;

        return {
            estimatedTokens,
            actualTokens: tokenEstimate.actual,
            maxContextTokens,
            modelContextWindow,
            thresholdPercent,
            usagePercent:
                totalTokenSpace > 0 ? Math.round((usedTokens / totalTokenSpace) * 100) : 0,
            messageCount: tokenEstimate.stats.originalMessageCount,
            filteredMessageCount: tokenEstimate.stats.filteredMessageCount,
            prunedToolCount: tokenEstimate.stats.prunedToolCount,
            hasSummary,
            model: llmConfig.model,
            modelDisplayName,
            breakdown: {
                systemPrompt: tokenEstimate.breakdown.systemPrompt,
                tools: tokenEstimate.breakdown.tools,
                messages: tokenEstimate.breakdown.messages,
            },
            ...(tokenEstimate.calculationBasis && {
                calculationBasis: tokenEstimate.calculationBasis,
            }),
        };
    }

    public getCurrentLLMConfig(sessionId?: string): ValidatedLLMConfig {
        this.ensureStarted();
        if (sessionId !== undefined && (!sessionId || typeof sessionId !== 'string')) {
            throw AgentError.apiValidationError(
                'sessionId must be a non-empty string when provided'
            );
        }
        return structuredClone(this.stateManager.getLLMConfig(sessionId));
    }

    
    public hasSessionLLMOverride(sessionId: string): boolean {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError('sessionId must be a non-empty string');
        }
        return this.stateManager.hasSessionLLMOverride(sessionId);
    }

    
    public async switchLLM(
        llmUpdates: LLMUpdates,
        sessionId?: string
    ): Promise<ValidatedLLMConfig> {
        this.ensureStarted();
        this.logger.debug(`FiusAgent.switchLLM: llmUpdates: ${safeStringify(llmUpdates)}`);
        const parseResult = LLMUpdatesSchema.safeParse(llmUpdates);
        if (!parseResult.success) {
            const validation = fail(zodToIssues(parseResult.error, 'error'));
            ensureOk(validation, this.logger);
            throw new Error('Unreachable');
        }
        const validatedUpdates = parseResult.data;

        if (sessionId !== undefined && sessionId !== '*' && sessionId.trim() === '') {
            throw AgentError.apiValidationError(
                'sessionId must be a non-empty string when provided'
            );
        }

        const currentLLMConfig =
            sessionId !== undefined && sessionId !== '*'
                ? this.stateManager.getRuntimeConfig(sessionId).llm
                : this.stateManager.getRuntimeConfig().llm;

        const result = await resolveAndValidateLLMConfig(
            currentLLMConfig,
            validatedUpdates,
            this.logger
        );
        const validatedConfig = ensureOk(result, this.logger);
        await this.performLLMSwitch(validatedConfig, sessionId);
        this.logger.info(
            `FiusAgent.switchLLM: LLM switched to: ${safeStringify(validatedConfig)}`
        );

        const warnings = result.issues.filter((issue) => issue.severity === 'warning');
        if (warnings.length > 0) {
            this.logger.warn(
                `LLM switch completed with warnings: ${warnings.map((w) => w.message).join(', ')}`
            );
        }

        return validatedConfig;
    }

    
    private async performLLMSwitch(
        validatedConfig: ValidatedLLMConfig,
        sessionScope?: string
    ): Promise<void> {
        if (sessionScope === '*') {
            await this.sessionManager.switchLLMForAllSessions(validatedConfig);
        } else if (sessionScope !== undefined) {
            const session = await this.sessionManager.getSession(sessionScope);
            if (!session) {
                throw SessionError.notFound(sessionScope);
            }
            await this.sessionManager.switchLLMForSpecificSession(validatedConfig, sessionScope);
        } else {
            this.stateManager.updateLLM(validatedConfig, sessionScope);
            this.agentEventBus.emit('llm:switched', {
                newConfig: validatedConfig,
                historyRetained: true,
                sessionIds: [],
            });
            this.logger.debug('LLM config updated at agent level (no active session switches)');
        }
    }

    
    public getSupportedProviders(): LLMProvider[] {
        return getSupportedProviders();
    }

    
    public getSupportedModels(): Record<
        LLMProvider,
        Array<ModelInfo & { isDefault: boolean; originalProvider?: LLMProvider }>
    > {
        const result = {} as Record<
            LLMProvider,
            Array<ModelInfo & { isDefault: boolean; originalProvider?: LLMProvider }>
        >;

        for (const provider of this.getSupportedProviders()) {
            result[provider] = this.getSupportedModelsForProvider(provider);
        }

        return result;
    }

    
    public getSupportedModelsForProvider(
        provider: LLMProvider
    ): Array<ModelInfo & { isDefault: boolean; originalProvider?: LLMProvider }> {
        const models = getAllModelsForProvider(provider);

        return models.map((model) => {
            const originalProvider =
                'originalProvider' in model ? model.originalProvider : provider;
            const defaultModel = getDefaultModelForProvider(originalProvider ?? provider);

            return {
                ...model,
                isDefault: model.name === defaultModel,
            };
        });
    }

    
    public inferProviderFromModel(modelName: string): LLMProvider | null {
        try {
            return getProviderFromModel(modelName) as LLMProvider;
        } catch {
            return null;
        }
    }

    public async addMcpServer(name: string, config: McpServerConfig): Promise<void> {
        this.ensureStarted();

        const existingServerNames = Object.keys(this.stateManager.getRuntimeConfig().mcpServers);
        const validation = resolveAndValidateMcpServerConfig(name, config, existingServerNames);
        const validatedConfig = ensureOk(validation, this.logger);

        this.stateManager.setMcpServer(name, validatedConfig);

        if (validatedConfig.enabled === false) {
            this.logger.info(`MCP server '${name}' added but not connected (disabled)`);
            addPersistedMcpServer(name, validatedConfig).catch((err) => {
                this.logger.warn(`Failed to persist MCP server '${name}': ${err}`);
            });
            return;
        }

        try {
            await this.mcpManager.connectServer(name, validatedConfig);

            await this.toolManager.refresh();

            this.agentEventBus.emit('mcp:server-connected', {
                name,
                success: true,
            });
            this.agentEventBus.emit('tools:available-updated', {
                tools: Object.keys(await this.toolManager.getAllTools()),
                source: 'mcp',
            });

            this.logger.info(`MCP server '${name}' added and connected successfully`);

            addPersistedMcpServer(name, validatedConfig).catch((err) => {
                this.logger.warn(`Failed to persist MCP server '${name}': ${err}`);
            });

            const warnings = validation.issues.filter((i) => i.severity === 'warning');
            if (warnings.length > 0) {
                this.logger.warn(
                    `MCP server connected with warnings: ${warnings.map((w) => w.message).join(', ')}`
                );
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to connect MCP server '${name}': ${errorMessage}`);

            addPersistedMcpServer(name, validatedConfig).catch((err) => {
                this.logger.warn(`Failed to persist MCP server '${name}': ${err}`);
            });

            this.agentEventBus.emit('mcp:server-connected', {
                name,
                success: false,
                error: errorMessage,
            });

            throw MCPError.connectionFailed(name, errorMessage);
        }
    }

    
    public async updateMcpServer(name: string, config: McpServerConfig): Promise<void> {
        this.ensureStarted();

        const currentConfig = this.stateManager.getRuntimeConfig().mcpServers[name];
        if (!currentConfig) {
            throw MCPError.serverNotFound(name);
        }

        const existingServerNames = Object.keys(this.stateManager.getRuntimeConfig().mcpServers);
        const validation = resolveAndValidateMcpServerConfig(name, config, existingServerNames);
        const validatedConfig = ensureOk(validation, this.logger);

        this.stateManager.setMcpServer(name, validatedConfig);

        addPersistedMcpServer(name, validatedConfig).catch((err) => {
            this.logger.warn(`Failed to persist MCP server update '${name}': ${err}`);
        });

        const shouldEnable = validatedConfig.enabled !== false;
        const hasClient = this.mcpManager.getClients().has(name);

        if (!shouldEnable) {
            if (hasClient) {
                await this.mcpManager.removeClient(name);
                await this.toolManager.refresh();
            }
            this.logger.info(`MCP server '${name}' updated (disabled)`);
            return;
        }

        try {
            if (hasClient) {
                await this.mcpManager.removeClient(name);
            }

            await this.mcpManager.connectServer(name, validatedConfig);
            await this.toolManager.refresh();

            this.agentEventBus.emit('mcp:server-connected', { name, success: true });
            this.agentEventBus.emit('tools:available-updated', {
                tools: Object.keys(await this.toolManager.getAllTools()),
                source: 'mcp',
            });

            this.logger.info(`MCP server '${name}' updated and reconnected successfully`);

            const warnings = validation.issues.filter((i) => i.severity === 'warning');
            if (warnings.length > 0) {
                this.logger.warn(
                    `MCP server updated with warnings: ${warnings.map((w) => w.message).join(', ')}`
                );
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to update MCP server '${name}': ${errorMessage}`);

            this.stateManager.setMcpServer(name, currentConfig);
            if (currentConfig.enabled !== false) {
                try {
                    await this.mcpManager.connectServer(name, currentConfig);
                    await this.toolManager.refresh();
                } catch (reconnectError) {
                    const reconnectMsg =
                        reconnectError instanceof Error
                            ? reconnectError.message
                            : String(reconnectError);
                    this.logger.error(
                        `Failed to restore MCP server '${name}' after update error: ${reconnectMsg}`
                    );
                }
            }

            throw MCPError.connectionFailed(name, errorMessage);
        }
    }

    
    public async connectMcpServer(name: string, config: McpServerConfig): Promise<void> {
        return this.addMcpServer(name, config);
    }

    
    public async enableMcpServer(name: string): Promise<void> {
        this.ensureStarted();

        const currentConfig = this.stateManager.getRuntimeConfig().mcpServers[name];
        if (!currentConfig) {
            throw MCPError.serverNotFound(name);
        }

        const updatedConfig = { ...currentConfig, enabled: true };
        this.stateManager.setMcpServer(name, updatedConfig);

        addPersistedMcpServer(name, updatedConfig).catch((err) => {
            this.logger.warn(`Failed to persist MCP server enable '${name}': ${err}`);
        });

        try {
            await this.mcpManager.connectServer(name, updatedConfig);
            await this.toolManager.refresh();

            this.agentEventBus.emit('mcp:server-connected', { name, success: true });
            this.logger.info(`MCP server '${name}' enabled and connected`);
        } catch (error) {
            this.stateManager.setMcpServer(name, currentConfig);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to enable MCP server '${name}': ${errorMessage}`);
            throw MCPError.connectionFailed(name, errorMessage);
        }
    }

    
    public async disableMcpServer(name: string): Promise<void> {
        this.ensureStarted();

        const currentConfig = this.stateManager.getRuntimeConfig().mcpServers[name];
        if (!currentConfig) {
            throw MCPError.serverNotFound(name);
        }

        const updatedConfig = { ...currentConfig, enabled: false };
        this.stateManager.setMcpServer(name, updatedConfig);

        addPersistedMcpServer(name, updatedConfig).catch((err) => {
            this.logger.warn(`Failed to persist MCP server disable '${name}': ${err}`);
        });

        try {
            await this.mcpManager.removeClient(name);
            await this.toolManager.refresh();

            this.logger.info(`MCP server '${name}' disabled and disconnected`);
        } catch (error) {
            this.stateManager.setMcpServer(name, currentConfig);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to disable MCP server '${name}': ${errorMessage}`);
            throw MCPError.disconnectionFailed(name, errorMessage);
        }
    }

    
    public async removeMcpServer(name: string): Promise<void> {
        this.ensureStarted();

        try {
            await this.mcpManager.removeClient(name);

            this.stateManager.removeMcpServer(name);

            removePersistedMcpServer(name).catch((err) => {
                this.logger.warn(`Failed to remove persisted MCP server '${name}': ${err}`);
            });

            await this.toolManager.refresh();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to remove MCP server '${name}': ${errorMessage}`);
            throw MCPError.disconnectionFailed(name, errorMessage);
        }
    }

    
    public async restartMcpServer(name: string): Promise<void> {
        this.ensureStarted();

        try {
            this.logger.info(`FiusAgent: Restarting MCP server '${name}'...`);

            await this.mcpManager.restartServer(name);

            await this.toolManager.refresh();

            this.agentEventBus.emit('mcp:server-restarted', {
                serverName: name,
            });
            this.agentEventBus.emit('tools:available-updated', {
                tools: Object.keys(await this.toolManager.getAllTools()),
                source: 'mcp',
            });

            this.logger.info(`FiusAgent: Successfully restarted MCP server '${name}'.`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(
                `FiusAgent: Failed to restart MCP server '${name}': ${errorMessage}`
            );

            throw error;
        }
    }

    public getMcpAuthProvider(name: string) {
        if (!name || typeof name !== 'string') {
            throw AgentError.apiValidationError('name is required and must be a non-empty string');
        }
        this.ensureStarted();
        return this.mcpManager.getAuthProvider(name);
    }

    
    public async executeTool(toolName: string, args: any): Promise<any> {
        this.ensureStarted();
        const toolCallId = `direct-${randomUUID()}`;
        return await this.toolManager.executeTool(toolName, args, toolCallId);
    }

    
    public async getAllMcpTools(): Promise<ToolSet> {
        this.ensureStarted();
        return await this.mcpManager.getAllTools();
    }

    
    public getAllMcpToolsWithServerInfo() {
        this.ensureStarted();
        return this.mcpManager.getAllToolsWithServerInfo();
    }

    
    public async getAllTools(): Promise<ToolSet> {
        this.ensureStarted();
        return await this.toolManager.getAllTools();
    }

    
    public async loadToolkits(
        toolkits: string[]
    ): Promise<{ loaded: string[]; skipped: string[] }> {
        this.ensureStarted();
        if (
            !Array.isArray(toolkits) ||
            toolkits.some((toolkit) => typeof toolkit !== 'string' || toolkit.trim() === '')
        ) {
            throw AgentError.apiValidationError('toolkits must be an array of non-empty strings');
        }

        const normalized = Array.from(new Set(toolkits.map((toolkit) => toolkit.trim())));

        if (normalized.length === 0) {
            return { loaded: [], skipped: [] };
        }

        if (!this.toolkitLoader) {
            throw AgentError.initializationFailed('Toolkit loader not configured');
        }

        const toLoad = normalized.filter(
            (toolkit) => !this.loadedToolkits.has(toolkit) && !this.loadingToolkits.has(toolkit)
        );
        const skipped = normalized.filter(
            (toolkit) => this.loadedToolkits.has(toolkit) || this.loadingToolkits.has(toolkit)
        );
        if (toLoad.length === 0) {
            return { loaded: [], skipped };
        }

        toLoad.forEach((toolkit) => {
            this.loadingToolkits.add(toolkit);
        });
        let tools: Tool[];
        try {
            tools = await this.toolkitLoader(toLoad);
        } finally {
            toLoad.forEach((toolkit) => {
                this.loadingToolkits.delete(toolkit);
            });
        }
        const existingIds = new Set(this.tools.map((tool) => tool.id));
        const newTools = tools.filter((tool) => !existingIds.has(tool.id));

        if (newTools.length > 0) {
            this.toolManager.addTools(newTools);
            this.tools = [...this.tools, ...newTools];
        }

        for (const toolkit of toLoad) {
            this.loadedToolkits.add(toolkit);
        }

        return {
            loaded: toLoad,
            skipped,
        };
    }

    
    public async getEnabledTools(sessionId?: string): Promise<ToolSet> {
        this.ensureStarted();
        if (sessionId !== undefined && (!sessionId || typeof sessionId !== 'string')) {
            throw AgentError.apiValidationError('sessionId must be a non-empty string');
        }
        if (sessionId !== undefined) {
            await this.toolManager.restoreSessionState(sessionId);
        }
        return this.toolManager.filterToolsForSession(
            await this.toolManager.getAllTools(),
            sessionId
        );
    }

    
    public getGlobalDisabledTools(): string[] {
        this.ensureStarted();
        return this.toolManager.getGlobalDisabledTools();
    }

    
    public setGlobalDisabledTools(toolNames: string[]): void {
        this.ensureStarted();
        if (
            !Array.isArray(toolNames) ||
            toolNames.some((name) => !name || typeof name !== 'string')
        ) {
            throw AgentError.apiValidationError('toolNames must be an array of non-empty strings');
        }
        this.toolManager.setGlobalDisabledTools(toolNames);
    }

    
    public async setSessionDisabledTools(sessionId: string, toolNames: string[]): Promise<void> {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }
        if (
            !Array.isArray(toolNames) ||
            toolNames.some((name) => !name || typeof name !== 'string')
        ) {
            throw AgentError.apiValidationError('toolNames must be an array of non-empty strings');
        }
        await this.toolManager.setSessionDisabledTools(sessionId, toolNames);
    }

    
    public async clearSessionDisabledTools(sessionId: string): Promise<void> {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }
        await this.toolManager.clearSessionDisabledTools(sessionId);
    }

    
    public async getSessionAutoApproveTools(sessionId: string): Promise<string[]> {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }
        await this.toolManager.restoreSessionState(sessionId);
        return this.toolManager.getSessionUserAutoApproveTools(sessionId) ?? [];
    }

    
    public async setSessionAutoApproveTools(sessionId: string, toolNames: string[]): Promise<void> {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }
        if (
            !Array.isArray(toolNames) ||
            toolNames.some((name) => !name || typeof name !== 'string')
        ) {
            throw AgentError.apiValidationError('toolNames must be an array of non-empty strings');
        }
        await this.toolManager.setSessionUserAutoApproveTools(sessionId, toolNames);
    }

    
    public getMcpClients(): Map<string, McpClient> {
        this.ensureStarted();
        return this.mcpManager.getClients();
    }

    
    public getMcpFailedConnections(): Record<string, string> {
        this.ensureStarted();
        const failures = this.mcpManager.getFailedConnections();
        return Object.fromEntries(
            Object.entries(failures).map(([name, error]) => [name, error.message])
        );
    }

    
    public getMcpServerStatus(name: string): McpServerStatus | undefined {
        this.ensureStarted();
        const config = this.stateManager.getRuntimeConfig();
        const serverConfig = config.mcpServers[name];
        if (!serverConfig) return undefined;

        const enabled = serverConfig.enabled !== false;
        const connectedClients = this.mcpManager.getClients();
        const failedConnections = this.mcpManager.getFailedConnections();

        let status: McpConnectionStatus;
        if (!enabled) {
            status = 'disconnected';
        } else if (connectedClients.has(name)) {
            status = 'connected';
        } else {
            const errorCode = this.mcpManager.getFailedConnectionErrorCode(name);
            if (errorCode === MCPErrorCode.AUTH_REQUIRED) {
                status = 'auth-required';
            } else {
                status = 'error';
            }
        }

        const result: McpServerStatus = {
            name,
            type: serverConfig.type,
            enabled,
            status,
        };
        if (failedConnections[name]) {
            result.error = failedConnections[name].message;
        }
        return result;
    }

    
    public getMcpServersWithStatus(): McpServerStatus[] {
        this.ensureStarted();
        const config = this.stateManager.getRuntimeConfig();
        const mcpServers = config.mcpServers || {};
        const connectedClients = this.mcpManager.getClients();
        const failedConnections = this.mcpManager.getFailedConnections();

        const servers: McpServerStatus[] = [];

        for (const [name, serverConfig] of Object.entries(mcpServers)) {
            const enabled = serverConfig.enabled !== false;
            let status: McpConnectionStatus;

            if (!enabled) {
                status = 'disconnected';
            } else if (connectedClients.has(name)) {
                status = 'connected';
            } else {
                const errorCode = this.mcpManager.getFailedConnectionErrorCode(name);
                if (errorCode === MCPErrorCode.AUTH_REQUIRED) {
                    status = 'auth-required';
                } else {
                    status = 'error';
                }
            }

            const server: McpServerStatus = {
                name,
                type: serverConfig.type,
                enabled,
                status,
            };
            if (failedConnections[name]) {
                server.error = failedConnections[name].message;
            }
            servers.push(server);
        }

        return servers;
    }

    public async listResources(): Promise<import('../resources/index.js').ResourceSet> {
        this.ensureStarted();
        return await this.resourceManager.list();
    }

    
    public async hasResource(uri: string): Promise<boolean> {
        this.ensureStarted();
        return await this.resourceManager.has(uri);
    }

    
    public async readResource(
        uri: string
    ): Promise<import('@modelcontextprotocol/sdk/types.js').ReadResourceResult> {
        this.ensureStarted();
        return await this.resourceManager.read(uri);
    }

    
    public async listResourcesForServer(serverId: string): Promise<
        Array<{
            uri: string;
            name: string;
            originalUri: string;
            serverName: string;
        }>
    > {
        this.ensureStarted();
        const allResources = await this.resourceManager.list();
        const serverResources = Object.values(allResources)
            .filter((resource) => resource.serverName === serverId)
            .map((resource) => {
                const original = (resource.metadata?.originalUri as string) ?? resource.uri;
                const name = resource.name ?? resource.uri.split('/').pop() ?? resource.uri;
                const serverName = resource.serverName ?? serverId;
                return { uri: original, name, originalUri: original, serverName };
            });
        return serverResources;
    }

    public async getSystemPrompt(sessionId?: string): Promise<string> {
        this.ensureStarted();
        if (sessionId !== undefined && (!sessionId || typeof sessionId !== 'string')) {
            throw AgentError.apiValidationError(
                'sessionId must be a non-empty string when provided'
            );
        }
        const context = await this.toolManager.buildContributorContext(
            sessionId !== undefined ? { sessionId } : undefined
        );
        return await this.systemPromptManager.build(context);
    }

    public async getSessionSystemPromptContributors(sessionId: string) {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        return await this.sessionManager.getSessionSystemPromptContributors(sessionId);
    }

    public async upsertSessionSystemPromptContributor(
        sessionId: string,
        contributor: unknown
    ): Promise<{ replaced: boolean }> {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }

        const parseResult = SessionPromptContributorSchema.safeParse(contributor);
        const parsedContributor = parseResult.success
            ? parseResult.data
            : ensureOk(fail(zodToIssues(parseResult.error, 'error')), this.logger);
        const replaced = await this.sessionManager.upsertSessionSystemPromptContributor(
            sessionId,
            parsedContributor
        );
        return { replaced };
    }

    public async removeSessionSystemPromptContributor(
        sessionId: string,
        contributorId: string
    ): Promise<boolean> {
        this.ensureStarted();
        if (!sessionId || typeof sessionId !== 'string') {
            throw AgentError.apiValidationError(
                'sessionId is required and must be a non-empty string'
            );
        }
        if (!contributorId || typeof contributorId !== 'string') {
            throw AgentError.apiValidationError(
                'contributorId is required and must be a non-empty string'
            );
        }

        return await this.sessionManager.removeSessionSystemPromptContributor(
            sessionId,
            contributorId
        );
    }

    
    public async listPrompts(): Promise<import('../prompts/index.js').PromptSet> {
        this.ensureStarted();
        return await this.promptManager.list();
    }

    
    public async getPromptDefinition(
        name: string
    ): Promise<import('../prompts/index.js').PromptDefinition | null> {
        this.ensureStarted();
        return await this.promptManager.getPromptDefinition(name);
    }

    
    public async hasPrompt(name: string): Promise<boolean> {
        this.ensureStarted();
        return await this.promptManager.has(name);
    }

    
    public async refreshPrompts(newPrompts?: PromptsConfig): Promise<void> {
        this.ensureStarted();
        if (newPrompts) {
            this.promptManager.updateConfigPrompts(newPrompts);
        }
        await this.promptManager.refresh();
    }

    
    public async getPrompt(
        name: string,
        args?: Record<string, unknown>
    ): Promise<import('@modelcontextprotocol/sdk/types.js').GetPromptResult> {
        this.ensureStarted();
        return await this.promptManager.getPrompt(name, args);
    }

    
    public async createCustomPrompt(
        input: import('../prompts/index.js').CreateCustomPromptInput
    ): Promise<import('../prompts/index.js').PromptInfo> {
        this.ensureStarted();
        return await this.promptManager.createCustomPrompt(input);
    }

    
    public async deleteCustomPrompt(name: string): Promise<void> {
        this.ensureStarted();
        return await this.promptManager.deleteCustomPrompt(name);
    }

    
    public async resolvePrompt(
        name: string,
        options: {
            context?: string;
            args?: Record<string, unknown>;
        } = {}
    ): Promise<import('../prompts/index.js').ResolvedPromptResult> {
        this.ensureStarted();
        return await this.promptManager.resolvePrompt(name, options);
    }

    public getEffectiveConfig(sessionId?: string): Readonly<AgentRuntimeSettings> {
        this.ensureStarted();
        return sessionId
            ? this.stateManager.getRuntimeConfig(sessionId)
            : this.stateManager.getRuntimeConfig();
    }

    public getMcpServerConfig(name: string): ValidatedMcpServerConfig | undefined {
        this.ensureStarted();
        const config = this.stateManager.getRuntimeConfig().mcpServers[name];
        if (config) return config;
        return this.mcpManager.getServerConfig(name);
    }

    public setApprovalHandler(handler: ApprovalHandler): void {
        this.approvalHandler = handler;

        if (this._isStarted && this.services) {
            this.services.approvalManager.setHandler(handler);
        }

        this.logger.debug('Approval handler registered');
    }

    
    public setPermissionsMode(mode: 'manual' | 'auto-approve'): void {
        if (this._isStarted && this.services) {
            this.services.approvalManager.setPermissionsMode(mode);
        }
        this.logger.debug(`Permissions mode set to: ${mode}`);
    }

    public setMcpAuthProviderFactory(
        factory: import('../mcp/types.js').McpAuthProviderFactory | null
    ): void {
        this.mcpAuthProviderFactory = factory;
        if (this._isStarted && this.services) {
            this.services.mcpManager.setAuthProviderFactory(factory);
        }
    }

    
    public clearApprovalHandler(): void {
        this.approvalHandler = undefined;

        if (this._isStarted && this.services) {
            this.services.approvalManager.clearHandler();
        }

        this.logger.debug('Approval handler cleared');
    }
}
