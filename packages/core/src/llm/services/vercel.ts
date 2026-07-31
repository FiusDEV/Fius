import { LanguageModel, type ModelMessage } from 'ai';
import { ToolManager } from '../../tools/tool-manager.js';
import type { CreateTurnDriverOptions, LLMExecutionControl, LLMServiceConfig } from './types.js';
import type { Logger } from '../../logger/v2/types.js';
import { FiusLogComponent } from '../../logger/v2/types.js';
import { ToolSet } from '../../tools/types.js';
import { ContextManager } from '../../context/manager.js';
import { getEffectiveMaxInputTokens, getMaxInputTokensForModel } from '../registry/index.js';
import type { ModelLimits } from '../../context/compaction/overflow.js';
import { ContentPart } from '../../context/types.js';
import type { SessionEventBus } from '../../events/index.js';
import type { ConversationStore } from '../../storage/conversation/types.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';
import { VercelMessageFormatter } from '../formatters/vercel.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import { TurnExecutor, type TurnDriver } from '../executor/turn-executor.js';
import { MessageQueueService } from '../../session/message-queue.js';
import type { ResourceManager } from '../../resources/index.js';
import { FiusRuntimeError } from '../../errors/FiusRuntimeError.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { LLMErrorCode } from '../error-codes.js';
import type { ContentInput } from '../../agent/types.js';
import type { AgentRunContext } from '../../runtime/run-context.js';
import { getModelDisplayName } from '../../utils/model-display-names.js';

export function ensureRunContextMatchesServiceSession(
    serviceSessionId: string,
    runContext?: AgentRunContext
): string {
    if (runContext !== undefined && runContext.sessionId !== serviceSessionId) {
        throw new FiusRuntimeError(
            LLMErrorCode.GENERATION_FAILED,
            ErrorScope.LLM,
            ErrorType.SYSTEM,
            `Run context session '${runContext.sessionId}' does not match LLM service session '${serviceSessionId}'`,
            {
                serviceSessionId,
                runContextSessionId: runContext.sessionId,
            }
        );
    }

    return serviceSessionId;
}

export class VercelLLMService {
    private model: LanguageModel;
    private config: ValidatedLLMConfig;
    private toolManager: ToolManager;
    private contextManager: ContextManager<ModelMessage>;
    private sessionEventBus: SessionEventBus;
    private readonly sessionId: string;
    private logger: Logger;
    private resourceManager: ResourceManager;
    private steerQueue: MessageQueueService;
    private followUpQueue: MessageQueueService;
    private compactionStrategy:
        | import('../../context/compaction/types.js').CompactionStrategy
        | null;
    private modelLimits?: ModelLimits;
    private readonly usageScopeId: string | undefined;
    private readonly executionControl: LLMExecutionControl | undefined;

    private getModelId(): string {
        return typeof this.model === 'string' ? this.model : this.model.modelId;
    }

    constructor(
        toolManager: ToolManager,
        model: LanguageModel,
        systemPromptManager: SystemPromptManager,
        conversationStore: ConversationStore,
        sessionEventBus: SessionEventBus,
        config: ValidatedLLMConfig,
        sessionId: string,
        resourceManager: ResourceManager,
        logger: Logger,
        steerQueue: MessageQueueService,
        followUpQueue: MessageQueueService,
        usageScopeId?: string,
        executionControl?: LLMExecutionControl,
        compactionStrategy?: import('../../context/compaction/types.js').CompactionStrategy | null
    ) {
        this.logger = logger.createChild(FiusLogComponent.LLM);
        this.model = model;
        this.config = config;
        this.toolManager = toolManager;
        this.sessionEventBus = sessionEventBus;
        this.sessionId = sessionId;
        this.resourceManager = resourceManager;
        this.usageScopeId = usageScopeId;
        this.executionControl = executionControl;
        this.compactionStrategy = compactionStrategy ?? null;

        this.steerQueue = steerQueue;
        this.followUpQueue = followUpQueue;

        const formatter = new VercelMessageFormatter(this.logger);
        const maxInputTokens = getEffectiveMaxInputTokens(config, this.logger);

        if (this.compactionStrategy) {
            this.modelLimits = this.compactionStrategy.getModelLimits(maxInputTokens);
        }

        this.contextManager = new ContextManager<ModelMessage>(
            config,
            formatter,
            systemPromptManager,
            maxInputTokens,
            conversationStore,
            sessionId,
            resourceManager,
            this.logger
        );

        this.logger.debug(
            `[VercelLLMService] Initialized for model: ${this.getModelId()}, provider: ${this.config.provider}, temperature: ${this.config.temperature}, maxOutputTokens: ${this.config.maxOutputTokens}`
        );
    }

    getAllTools(): Promise<ToolSet> {
        return this.toolManager.getAllTools();
    }

    getEnabledTools(): Promise<ToolSet> {
        return this.toolManager
            .getAllTools()
            .then((tools) => this.toolManager.filterToolsForSession(tools, this.sessionId));
    }

    async createTurnDriver(options: CreateTurnDriverOptions = {}): Promise<TurnDriver> {
        const sessionId = ensureRunContextMatchesServiceSession(this.sessionId, options.runContext);
        const executor = this.createTurnExecutor(options.signal, options.runContext);
        const contributorContext = await this.toolManager.buildContributorContext({ sessionId });
        const streaming = options.streaming ?? true;
        return executor.createDriver(contributorContext, {
            streaming,
            ...(options.state !== undefined ? { state: options.state } : {}),
        });
    }

    private createTurnExecutor(
        externalSignal?: AbortSignal,
        runContext?: AgentRunContext
    ): TurnExecutor {
        return new TurnExecutor(
            this.model,
            this.toolManager,
            this.contextManager,
            this.sessionEventBus,
            this.resourceManager,
            this.sessionId,
            {
                maxSteps: this.config.maxIterations,
                maxOutputTokens: this.config.maxOutputTokens,
                temperature: this.config.temperature,
                baseURL: this.config.baseURL,
                usageScopeId: this.usageScopeId,
                ...(this.executionControl !== undefined && {
                    executionControl: this.executionControl,
                }),
                reasoning: this.config.reasoning,
            },
            { provider: this.config.provider, model: this.getModelId(), displayName: getModelDisplayName(this.getModelId()) },
            this.logger,
            this.steerQueue,
            this.followUpQueue,
            this.modelLimits,
            externalSignal,
            this.compactionStrategy,
            runContext
        );
    }

    public static StreamResult: { text: string };

    async stream(
        content: ContentInput,
        options?: {
            signal?: AbortSignal;
            runContext?: AgentRunContext;
        }
    ): Promise<{ text: string }> {
        const sessionId = ensureRunContextMatchesServiceSession(
            this.sessionId,
            options?.runContext
        );

        const parts: ContentPart[] =
            typeof content === 'string' ? [{ type: 'text', text: content }] : content;

        await this.contextManager.addUserMessage(parts);

        const executor = this.createTurnExecutor(options?.signal, options?.runContext);

        const contributorContext = await this.toolManager.buildContributorContext({
            sessionId,
        });
        const result = await executor.execute(contributorContext, true);

        return {
            text: result.text ?? '',
        };
    }

    getConfig(): LLMServiceConfig {
        const configuredMaxTokens = this.contextManager.getMaxInputTokens();
        let modelMaxInputTokens: number;

        try {
            modelMaxInputTokens = getMaxInputTokensForModel(
                this.config.provider,
                this.getModelId(),
                this.logger
            );
        } catch (error) {
            if (error instanceof FiusRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
                modelMaxInputTokens = configuredMaxTokens;
                this.logger.debug(
                    `Could not find model ${this.getModelId()} in LLM registry to get max tokens. Using configured max tokens: ${configuredMaxTokens}.`
                );
            } else {
                throw error;
            }
        }
        return {
            provider: this.config.provider,
            model: this.model,
            configuredMaxInputTokens: configuredMaxTokens,
            modelMaxInputTokens: modelMaxInputTokens,
        };
    }

    getContextManager(): ContextManager<unknown> {
        return this.contextManager;
    }

    getSteerQueue(): MessageQueueService {
        return this.steerQueue;
    }

    getFollowUpQueue(): MessageQueueService {
        return this.followUpQueue;
    }

    getCompactionStrategy(): import('../../context/compaction/types.js').CompactionStrategy | null {
        return this.compactionStrategy;
    }

    getLanguageModel(): LanguageModel {
        return this.model;
    }
}
