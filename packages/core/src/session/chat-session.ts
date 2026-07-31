import { randomUUID } from 'crypto';
import { createLLMService } from '../llm/services/factory.js';
import type { ContextManager } from '../context/index.js';
import {
    describeContentInputForAudit,
    describeContentPartsForAudit,
} from '../context/content-audit.js';
import type {
    CreateLLMServiceOptions,
    LLMExecutionControl,
    LanguageModelFactory,
} from '../llm/services/types.js';
import type { LlmAuthResolver } from '../llm/auth/index.js';
import type { SystemPromptManager } from '../systemPrompt/manager.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { ConversationStore } from '../storage/index.js';
import type { HookManager } from '../hooks/manager.js';
import type { MCPManager } from '../mcp/manager.js';
import type { BeforeLLMRequestPayload, BeforeResponsePayload } from '../hooks/types.js';
import {
    SessionEventBus,
    AgentEventBus,
    forwardSessionEventsToAgentBus,
    SessionEventMap,
} from '../events/index.js';
import type { Logger } from '../logger/v2/types.js';
import { FiusLogComponent } from '../logger/v2/types.js';
import { FiusRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import { getModelDisplayName } from '../utils/model-display-names.js';
import { HookErrorCode } from '../hooks/error-codes.js';
import type { InternalMessage, ContentPart } from '../context/types.js';
import type { QueuedMessage } from './types.js';
import { MessageQueueService, type UserMessageInput } from './message-queue.js';
import type { SessionMessageQueueStore } from '../storage/message-queue/types.js';
import type { ContentInput } from '../agent/types.js';
import {
    getUsagePricingMetadata,
    hasMeaningfulTokenUsage,
    normalizeTokenUsageForAccounting,
} from '../llm/usage-metadata.js';
import { parseCodexBaseURL } from '../llm/providers/codex-base-url.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import type { VercelLLMService } from '../llm/services/vercel.js';
import type { AgentRunContext } from '../runtime/run-context.js';
import { SessionError } from './errors.js';
import type { TurnDriver, TurnDriverState } from '../llm/executor/turn-executor.js';

export type ChatSessionTurnDriverInput =
    | {
          kind: 'start';
          content: ContentInput;
          streaming?: boolean;
          signal?: AbortSignal;
          runContext?: AgentRunContext;
      }
    | {
          kind: 'resume';
          state: TurnDriverState;
          streaming?: boolean;
          signal?: AbortSignal;
          runContext?: AgentRunContext;
      };


export class ChatSession {
    
    public readonly eventBus: SessionEventBus;

    
    private conversationStore!: ConversationStore;

    
    private llmService!: VercelLLMService;

    
    private steerQueue!: MessageQueueService;
    private followUpQueue!: MessageQueueService;

    private activeForwarderCleanup: (() => void) | null = null;

    
    private tokenAccumulatorListener: ((payload: SessionEventMap['llm:response']) => void) | null =
        null;

    
    private currentRunController: AbortController | null = null;

    public readonly logger: Logger;

    
    constructor(
        private services: {
            stateManager: AgentStateManager;
            systemPromptManager: SystemPromptManager;
            toolManager: ToolManager;
            agentEventBus: AgentEventBus;
            conversationStore: ConversationStore;
            resourceManager: import('../resources/index.js').ResourceManager;
            hookManager: HookManager;
            mcpManager: MCPManager;
            sessionManager: import('./session-manager.js').SessionManager;
            steerQueueStore: SessionMessageQueueStore;
            followUpQueueStore: SessionMessageQueueStore;
            languageModelFactory?: LanguageModelFactory;
            authResolver?: LlmAuthResolver | null;
            workspaceManager?: import('../workspace/manager.js').WorkspaceManager;
            compactionStrategy: CompactionStrategy | null;
            executionControl?: LLMExecutionControl | undefined;
        },
        public readonly id: string,
        logger: Logger
    ) {
        this.logger = logger.createChild(FiusLogComponent.SESSION);
        this.eventBus = new SessionEventBus();
        this.steerQueue = new MessageQueueService(
            this.eventBus,
            this.logger,
            this.id,
            this.services.steerQueueStore,
            'steer'
        );
        this.followUpQueue = new MessageQueueService(
            this.eventBus,
            this.logger,
            this.id,
            this.services.followUpQueueStore,
            'follow-up'
        );

        this.setupTokenAccumulation();

        this.logger.debug(`ChatSession ${this.id}: Created, awaiting initialization`);
    }

    
    public async init(): Promise<void> {
        await this.initializeServices();
    }

    private attachRunEventForwarders(runContext?: AgentRunContext): () => void {
        const cleanup = forwardSessionEventsToAgentBus({
            sessionEventBus: this.eventBus,
            agentEventBus: this.services.agentEventBus,
            sessionId: this.id,
            ...(runContext?.hostRuntime !== undefined
                ? { hostRuntime: runContext.hostRuntime }
                : {}),
        });

        this.activeForwarderCleanup = cleanup;
        return () => {
            if (this.activeForwarderCleanup === cleanup) {
                this.activeForwarderCleanup = null;
            }
            cleanup();
        };
    }

    
    private setupTokenAccumulation(): void {
        this.tokenAccumulatorListener = (payload: SessionEventMap['llm:response']) => {
            const tokenUsage = normalizeTokenUsageForAccounting(payload.tokenUsage);
            const llmConfig = this.services.stateManager.getLLMConfig(this.id);
            const isChatGPTLogin =
                llmConfig.provider === 'openai-compatible' &&
                parseCodexBaseURL(llmConfig.baseURL)?.authMode === 'chatgpt';
            const hasMeaningfulUsage = hasMeaningfulTokenUsage(tokenUsage);

            if (isChatGPTLogin && !hasMeaningfulUsage) {
                this.services.sessionManager
                    .markUntrackedChatGPTLoginUsage(this.id)
                    .catch((err) => {
                        this.logger.warn(
                            `Failed to mark ChatGPT Login usage as untracked: ${err instanceof Error ? err.message : String(err)}`
                        );
                    });
                return;
            }

            const modelInfo = {
                provider: payload.provider,
                model: payload.model,
            };

            const pricingMetadata = getUsagePricingMetadata({
                provider: modelInfo.provider,
                model: modelInfo.model,
                tokenUsage,
            });

            this.services.sessionManager
                .accumulateTokenUsage(
                    this.id,
                    tokenUsage,
                    payload.estimatedCost ?? pricingMetadata.estimatedCost,
                    modelInfo
                )
                .catch((err) => {
                    this.logger.warn(
                        `Failed to accumulate token usage: ${err instanceof Error ? err.message : String(err)}`
                    );
                });
        };

        this.eventBus.on('llm:response', this.tokenAccumulatorListener);
    }

    
    private async initializeServices(): Promise<void> {
        const runtimeConfig = this.services.stateManager.getRuntimeConfig(this.id);
        const llmConfig = runtimeConfig.llm;

        await this.steerQueue.initialize();
        await this.followUpQueue.initialize();

        this.conversationStore = this.services.conversationStore;

        this.llmService = await this.createSessionLLMService(llmConfig, runtimeConfig.usageScopeId);

        this.logger.debug(`ChatSession ${this.id}: Services initialized with storage`);
    }

    private async createSessionLLMService(
        llmConfig: ValidatedLLMConfig,
        usageScopeId?: string
    ): Promise<VercelLLMService> {
        const workspace = await this.services.workspaceManager?.getWorkspace();
        const options: CreateLLMServiceOptions = {
            usageScopeId,
            compactionStrategy: this.services.compactionStrategy,
            ...(this.services.executionControl !== undefined && {
                executionControl: this.services.executionControl,
            }),
            ...(workspace?.path !== undefined && { cwd: workspace.path }),
            steerQueue: this.steerQueue,
            followUpQueue: this.followUpQueue,
            authResolver: this.services.authResolver ?? null,
        };

        return createLLMService(
            llmConfig,
            this.services.toolManager,
            this.services.systemPromptManager,
            this.conversationStore,
            this.eventBus,
            this.id,
            this.services.resourceManager,
            this.logger,
            options,
            this.services.languageModelFactory
        );
    }

    
    private async saveBlockedInteraction(
        userInput: string,
        errorMessage: string,
        _imageData?: { image: string; mimeType: string },
        _fileData?: { data: string; mimeType: string; filename?: string }
    ): Promise<void> {
        const timestamp = Date.now();

        const userMessage: InternalMessage = {
            id: randomUUID(),
            role: 'user',
            timestamp,
            content: [{ type: 'text', text: '[Blocked by content policy: input redacted]' }],
        };

        const errorContent = `Error: ${errorMessage}`;
        const assistantMessageId = randomUUID();
        const assistantMessage: InternalMessage = {
            id: assistantMessageId,
            role: 'assistant',
            assistantOutput: { status: 'complete' },
            timestamp: timestamp + 1,
            content: [{ type: 'text', text: errorContent }],
        };

        await this.conversationStore.saveMessage({ sessionId: this.id, message: userMessage });
        await this.conversationStore.saveMessage({ sessionId: this.id, message: assistantMessage });

        const llmConfig = this.services.stateManager.getLLMConfig(this.id);
        this.eventBus.emit('interaction:blocked', {
            content: errorContent,
            provider: llmConfig.provider,
            model: llmConfig.model,
            displayName: getModelDisplayName(llmConfig.model),
            messageId: assistantMessageId,
        });
        this.eventBus.emit('run:complete', {
            finishReason: 'stop',
            stepCount: 0,
            durationMs: 0,
        });
    }

    private normalizeContent(content: ContentInput): ContentPart[] {
        return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    }

    private async prepareTurnInput(
        content: ContentInput,
        signal: AbortSignal,
        runContext?: AgentRunContext
    ): Promise<ContentPart[]> {
        const parts = this.normalizeContent(content);

        const textParts = parts.filter(
            (p): p is { type: 'text'; text: string } => p.type === 'text'
        );
        const imageParts = parts.filter((p) => p.type === 'image');
        const fileParts = parts.filter((p) => p.type === 'file');

        this.logger.debug(
            `Streaming session ${this.id} | textParts=${textParts.length} | images=${imageParts.length} | files=${fileParts.length}`
        );

        const textContent = textParts.map((p) => p.text).join('\n');
        const firstImage = imageParts[0] as
            | { type: 'image'; image: string; mimeType?: string }
            | undefined;
        const firstFile = fileParts[0] as
            | { type: 'file'; data: string; mimeType: string; filename?: string }
            | undefined;

        const beforeLLMPayload: BeforeLLMRequestPayload = {
            text: textContent,
            ...(firstImage && {
                imageData: {
                    image: typeof firstImage.image === 'string' ? firstImage.image : '[binary]',
                    mimeType: firstImage.mimeType || 'image/jpeg',
                },
            }),
            ...(firstFile && {
                fileData: {
                    data: typeof firstFile.data === 'string' ? firstFile.data : '[binary]',
                    mimeType: firstFile.mimeType,
                    ...(firstFile.filename && { filename: firstFile.filename }),
                },
            }),
            sessionId: this.id,
        };

        const modifiedBeforePayload = await this.services.hookManager.executeHooks(
            'beforeLLMRequest',
            beforeLLMPayload,
            {
                sessionManager: this.services.sessionManager,
                mcpManager: this.services.mcpManager,
                toolManager: this.services.toolManager,
                stateManager: this.services.stateManager,
                ...(runContext !== undefined && { runContext }),
                sessionId: this.id,
                abortSignal: signal,
            }
        );

        if (modifiedBeforePayload.text === textContent || textParts.length === 0) {
            return parts;
        }

        return [
            { type: 'text', text: modifiedBeforePayload.text },
            ...parts.filter((p) => p.type !== 'text'),
        ];
    }

    private async applyBeforeResponseHooks(
        content: string,
        signal: AbortSignal,
        runContext?: AgentRunContext
    ): Promise<string> {
        const llmConfig = this.services.stateManager.getLLMConfig(this.id);
        const beforeResponsePayload: BeforeResponsePayload = {
            content,
            provider: llmConfig.provider,
            model: llmConfig.model,
            sessionId: this.id,
        };

        const modifiedResponsePayload = await this.services.hookManager.executeHooks(
            'beforeResponse',
            beforeResponsePayload,
            {
                sessionManager: this.services.sessionManager,
                mcpManager: this.services.mcpManager,
                toolManager: this.services.toolManager,
                stateManager: this.services.stateManager,
                ...(runContext !== undefined && { runContext }),
                sessionId: this.id,
                abortSignal: signal,
            }
        );

        return modifiedResponsePayload.content;
    }

    
    public async stream(
        content: ContentInput,
        options?: {
            signal?: AbortSignal;
            runContext?: AgentRunContext;
        }
    ): Promise<{ text: string }> {
        const parts = this.normalizeContent(content);

        if (this.isBusy()) {
            throw SessionError.busy(this.id);
        }

        this.currentRunController = new AbortController();
        const signal = options?.signal
            ? this.combineSignals(options.signal, this.currentRunController.signal)
            : this.currentRunController.signal;
        const detachForwarders = this.attachRunEventForwarders(options?.runContext);

        try {
            const modifiedParts = await this.prepareTurnInput(content, signal, options?.runContext);
            const streamResult = await this.llmService.stream(modifiedParts, {
                signal,
                ...(options?.runContext !== undefined && { runContext: options.runContext }),
            });
            return {
                text: await this.applyBeforeResponseHooks(
                    streamResult.text,
                    signal,
                    options?.runContext
                ),
            };
        } catch (error) {
            const aborted =
                (error instanceof Error && error.name === 'AbortError') ||
                (typeof error === 'object' && error !== null && (error as any).aborted === true);
            if (aborted) {
                this.eventBus.emit('llm:error', {
                    error: new Error('Run cancelled'),
                    context: 'user_cancelled',
                    recoverable: true,
                });

                try {
                    const history = await this.getHistory();
                    const lastAssistant = history.filter((m) => m.role === 'assistant').pop();
                    if (lastAssistant) {
                        if (typeof lastAssistant.content === 'string') {
                            return { text: lastAssistant.content };
                        }
                        if (Array.isArray(lastAssistant.content)) {
                            const text = lastAssistant.content
                                .filter(
                                    (part): part is { type: 'text'; text: string } =>
                                        part.type === 'text'
                                )
                                .map((part) => part.text)
                                .join('');
                            if (text) {
                                return { text };
                            }
                        }
                    }
                } catch {
                    this.logger.debug('Failed to retrieve partial response from history on cancel');
                }
                return { text: '' };
            }

            if (
                error instanceof FiusRuntimeError &&
                error.code === HookErrorCode.HOOK_BLOCKED_EXECUTION &&
                error.scope === ErrorScope.HOOK &&
                error.type === ErrorType.FORBIDDEN
            ) {
                const textContent = parts
                    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                    .map((p) => p.text)
                    .join('\n');
                try {
                    await this.saveBlockedInteraction(textContent, error.message);
                    this.logger.debug(
                        `ChatSession ${this.id}: Saved blocked interaction to history`
                    );
                } catch (saveError) {
                    this.logger.warn(
                        `Failed to save blocked interaction to history: ${
                            saveError instanceof Error ? saveError.message : String(saveError)
                        }`
                    );
                }

                return { text: error.message };
            }

            this.logger.error(
                `Error in ChatSession.stream: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        } finally {
            detachForwarders();
            this.currentRunController = null;
        }
    }

    public async createTurnDriver(input: ChatSessionTurnDriverInput): Promise<TurnDriver> {
        if (this.isBusy()) {
            throw SessionError.busy(this.id);
        }

        this.currentRunController = new AbortController();
        const signal = input.signal
            ? this.combineSignals(input.signal, this.currentRunController.signal)
            : this.currentRunController.signal;
        const detachForwarders = this.attachRunEventForwarders(input.runContext);

        try {
            if (input.kind === 'start') {
                this.logger.info('ChatSession turn input received', {
                    sessionId: this.id,
                    turnKind: input.kind,
                    streaming: input.streaming ?? true,
                    ...(input.runContext?.hostRuntime?.ids !== undefined && {
                        hostRuntimeIds: input.runContext.hostRuntime.ids,
                    }),
                    content: await describeContentInputForAudit(input.content),
                });
                const modifiedParts = await this.prepareTurnInput(input.content, signal, input.runContext);
                await this.llmService.getContextManager().addUserMessage(modifiedParts);
                this.logger.info('ChatSession turn input persisted', {
                    sessionId: this.id,
                    turnKind: input.kind,
                    ...(input.runContext?.hostRuntime?.ids !== undefined && {
                        hostRuntimeIds: input.runContext.hostRuntime.ids,
                    }),
                    content: await describeContentPartsForAudit(modifiedParts),
                });
            } else {
                this.logger.info('ChatSession turn resume requested', {
                    sessionId: this.id,
                    turnKind: input.kind,
                    streaming: input.streaming ?? true,
                    phase: input.state.phase,
                    stepCount: input.state.stepCount,
                    ...(input.runContext?.hostRuntime?.ids !== undefined && {
                        hostRuntimeIds: input.runContext.hostRuntime.ids,
                    }),
                });
            }

            const streaming = input.streaming ?? true;
            const driver = await this.llmService.createTurnDriver({
                signal,
                streaming,
                ...(input.runContext !== undefined && { runContext: input.runContext }),
                ...(input.kind === 'resume' ? { state: input.state } : {}),
            });

            return this.wrapTurnDriver(driver, signal, input.runContext, detachForwarders);
        } catch (error) {
            if (
                input.kind === 'start' &&
                error instanceof FiusRuntimeError &&
                error.code === HookErrorCode.HOOK_BLOCKED_EXECUTION &&
                error.scope === ErrorScope.HOOK &&
                error.type === ErrorType.FORBIDDEN
            ) {
                const textContent = this.normalizeContent(input.content)
                    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                    .map((p) => p.text)
                    .join('\n');
                await this.saveBlockedInteraction(textContent, error.message);
            }
            detachForwarders();
            this.currentRunController = null;
            throw error;
        }
    }

    private wrapTurnDriver(
        driver: TurnDriver,
        signal: AbortSignal,
        runContext: AgentRunContext | undefined,
        detachForwarders: () => void
    ): TurnDriver {
        let closed = false;
        const close = () => {
            if (closed) {
                return;
            }
            closed = true;
            detachForwarders();
            this.currentRunController = null;
        };

        return {
            prepareNextModelStep: () => driver.prepareNextModelStep(),
            runNextModelStep: () => driver.runNextModelStep(),
            executeToolCalls: () => driver.executeToolCalls(),
            decideNextStep: () => driver.decideNextStep(),
            finish: async () => {
                try {
                    const result = await driver.finish();
                    return {
                        ...result,
                        text: await this.applyBeforeResponseHooks(result.text, signal, runContext),
                    };
                } finally {
                    driver.dispose();
                    close();
                }
            },
            fail: async (error) => {
                try {
                    return await driver.fail(error);
                } finally {
                    driver.dispose();
                    close();
                }
            },
            getState: () => driver.getState(),
            checkpoint: () => {
                try {
                    return driver.checkpoint();
                } finally {
                    close();
                }
            },
            dispose: () => {
                if (closed) {
                    return;
                }
                try {
                    driver.dispose();
                } finally {
                    close();
                }
            },
        };
    }

    
    private combineSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
        const controller = new AbortController();

        const onAbort = () => controller.abort();

        signal1.addEventListener('abort', onAbort);
        signal2.addEventListener('abort', onAbort);

        if (signal1.aborted || signal2.aborted) {
            controller.abort();
        }

        return controller.signal;
    }

    
    public async getHistory() {
        return await this.conversationStore.listMessages({ sessionId: this.id });
    }

    
    public async reset(): Promise<void> {
        await this.llmService.getContextManager().resetConversation();

        this.services.agentEventBus.emit('session:reset', {
            sessionId: this.id,
        });
    }

    
    public getContextManager(): ContextManager<unknown> {
        return this.llmService.getContextManager();
    }

    
    public getLLMService(): VercelLLMService {
        return this.llmService;
    }

    
    public async switchLLM(newLLMConfig: ValidatedLLMConfig): Promise<void> {
        try {
            const runtimeConfig = this.services.stateManager.getRuntimeConfig(this.id);
            this.llmService = await this.createSessionLLMService(
                newLLMConfig,
                runtimeConfig.usageScopeId
            );

            this.logger.info(
                `ChatSession ${this.id}: LLM switched to ${newLLMConfig.provider}/${newLLMConfig.model}`
            );

            this.eventBus.emit('llm:switched', {
                newConfig: newLLMConfig,
                historyRetained: true,
            });
        } catch (error) {
            this.logger.error(
                `Error during ChatSession.switchLLM for session ${this.id}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    
    public async cleanup(): Promise<void> {
        try {
            this.dispose();

            this.logger.debug(
                `ChatSession ${this.id}: Memory cleanup completed (chat history preserved)`
            );

        } catch (error) {
            this.logger.error(
                `Error during ChatSession cleanup for session ${this.id}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    
    public dispose(): void {
        this.logger.debug(`Disposing session ${this.id} - cleaning up event listeners`);

        this.activeForwarderCleanup?.();
        this.activeForwarderCleanup = null;

        if (this.tokenAccumulatorListener) {
            this.eventBus.off('llm:response', this.tokenAccumulatorListener);
            this.tokenAccumulatorListener = null;
        }

        this.logger.debug(`Session ${this.id} disposed successfully`);
    }

    
    public isBusy(): boolean {
        return this.currentRunController !== null && !this.currentRunController.signal.aborted;
    }

    
    public async steer(
        message: UserMessageInput
    ): Promise<{ queued: true; position: number; id: string }> {
        return await this.llmService.getSteerQueue().enqueue(message);
    }

    
    public async followUp(
        message: UserMessageInput
    ): Promise<{ queued: true; position: number; id: string }> {
        return await this.llmService.getFollowUpQueue().enqueue(message);
    }

    
    public getSteerMessages(): QueuedMessage[] {
        return this.llmService.getSteerQueue().getAll();
    }

    
    public getFollowUpMessages(): QueuedMessage[] {
        return this.llmService.getFollowUpQueue().getAll();
    }

    
    public async removeSteerMessage(id: string): Promise<boolean> {
        return await this.llmService.getSteerQueue().remove(id);
    }

    
    public async removeFollowUpMessage(id: string): Promise<boolean> {
        return await this.llmService.getFollowUpQueue().remove(id);
    }

    
    public async clearSteerQueue(): Promise<number> {
        const queue = this.llmService.getSteerQueue();
        const count = queue.pendingCount();
        await queue.clear();
        return count;
    }

    
    public async clearFollowUpQueue(): Promise<number> {
        const queue = this.llmService.getFollowUpQueue();
        const count = queue.pendingCount();
        await queue.clear();
        return count;
    }

    
    public async clearPendingInput(): Promise<number> {
        const [steerCount, followUpCount] = await Promise.all([
            this.clearSteerQueue(),
            this.clearFollowUpQueue(),
        ]);
        return steerCount + followUpCount;
    }

    
    public cancel(): boolean {
        const controller = this.currentRunController;
        if (!controller || controller.signal.aborted) {
            return false;
        }
        try {
            controller.abort();
            return true;
        } catch {
            return false;
        }
    }
}
