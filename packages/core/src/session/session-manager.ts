import { randomUUID } from 'crypto';
import { ChatSession } from './chat-session.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { AgentEventBus } from '../events/index.js';
import type { Logger } from '../logger/v2/types.js';
import { FiusLogComponent } from '../logger/v2/types.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { HookManager } from '../hooks/manager.js';
import type { ApprovalManager } from '../approval/manager.js';
import { SessionError } from './errors.js';
import type { TokenUsage } from '@fiusdev/llm';
import { normalizeTokenUsageForAccounting } from '../llm/usage-metadata.js';
import type { LLMExecutionControl, LanguageModelFactory } from '../llm/services/types.js';
import type { LlmAuthResolver } from '../llm/auth/index.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import { ZodError } from 'zod';
import {
    SessionPromptContributorSchema,
    type SessionPromptContributor,
} from '../systemPrompt/schemas.js';
import type { SessionMessageQueueStore } from '../storage/message-queue/types.js';
import type { ConversationStore } from '../storage/conversation/types.js';
import type { SessionStore } from '../storage/sessions/types.js';
export type SessionLoggerFactory = (options: {
    baseLogger: Logger;
    agentId: string;
    sessionId: string;
}) => Logger;

function defaultSessionLoggerFactory(options: {
    baseLogger: Logger;
    agentId: string;
    sessionId: string;
}): Logger {
    return options.baseLogger.createChild(FiusLogComponent.SESSION);
}


export type SessionTokenUsage = Required<TokenUsage>;

export interface SessionUsageTracking {
    hasUntrackedChatGPTLoginUsage?: boolean;
}


export interface ModelStatistics {
    provider: string;
    model: string;
    messageCount: number;
    tokenUsage: SessionTokenUsage;
    estimatedCost: number;
    firstUsedAt: number;
    lastUsedAt: number;
}

export interface SessionMetadata {
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    title?: string;
    tokenUsage?: SessionTokenUsage;
    estimatedCost?: number;
    modelStats?: ModelStatistics[];
    workspaceId?: string;
    parentSessionId?: string;
    usageTracking?: SessionUsageTracking;
}

export interface SessionManagerConfig {
    sessionTTL?: number;
    
    sessionLoggerFactory?: SessionLoggerFactory;
    
    languageModelFactory?: LanguageModelFactory;
    
    authResolver?: LlmAuthResolver | null;
    
    executionControl?: LLMExecutionControl | undefined;
}

type PersistedLLMConfig = Omit<ValidatedLLMConfig, 'apiKey'>;

export interface SessionData {
    id: string;
    userId?: string;
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    metadata?: Record<string, any>;
    tokenUsage?: SessionTokenUsage;
    estimatedCost?: number;
    modelStats?: ModelStatistics[];
    workspaceId?: string;
    parentSessionId?: string;
    usageTracking?: SessionUsageTracking;
    
    llmOverride?: PersistedLLMConfig;
}


export class SessionManager {
    private sessions: Map<string, ChatSession> = new Map();
    private readonly maxSessions: number = Infinity;
    private readonly sessionTTL: number;
    private initialized = false;
    private cleanupInterval?: NodeJS.Timeout;
    private initializationPromise!: Promise<void>;
    private readonly pendingCreations = new Map<string, Promise<ChatSession>>();
    private readonly sessionDataLocks = new Map<string, Promise<void>>();
    private logger: Logger;
    private static readonly FORK_ID_GENERATION_MAX_ATTEMPTS = 5;
    private static readonly FORK_TITLE_PREFIX = 'Fork: ';
    private static readonly FORK_PARENT_ID_PREVIEW_LENGTH = 8;

    private readonly sessionLoggerFactory: SessionLoggerFactory;
    private readonly languageModelFactory: LanguageModelFactory | undefined;
    private readonly authResolver: LlmAuthResolver | null;
    private readonly executionControl: LLMExecutionControl | undefined;

    constructor(
        private services: {
            stateManager: AgentStateManager;
            systemPromptManager: SystemPromptManager;
            toolManager: ToolManager;
            approvalManager: ApprovalManager;
            agentEventBus: AgentEventBus;
            sessionStore: SessionStore;
            conversationStore: ConversationStore;
            resourceManager: import('../resources/index.js').ResourceManager;
            hookManager: HookManager;
            mcpManager: import('../mcp/manager.js').MCPManager;
            steerQueueStore: SessionMessageQueueStore;
            followUpQueueStore: SessionMessageQueueStore;
            compactionStrategy: CompactionStrategy | null;
            workspaceManager?: import('../workspace/manager.js').WorkspaceManager;
        },
        config: SessionManagerConfig = {},
        logger: Logger
    ) {
        this.sessionTTL = config.sessionTTL ?? 3600000;
        this.sessionLoggerFactory = config.sessionLoggerFactory ?? defaultSessionLoggerFactory;
        this.languageModelFactory = config.languageModelFactory;
        this.authResolver = config.authResolver ?? null;
        this.executionControl = config.executionControl;
        this.logger = logger.createChild(FiusLogComponent.SESSION);
    }

    private getChatSessionServices(): ConstructorParameters<typeof ChatSession>[0] {
        return {
            ...this.services,
            sessionManager: this,
            ...(this.languageModelFactory !== undefined && {
                languageModelFactory: this.languageModelFactory,
            }),
            authResolver: this.authResolver,
            ...(this.executionControl !== undefined && {
                executionControl: this.executionControl,
            }),
        };
    }

    
    public async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        await this.restoreSessionsFromStorage();

        const cleanupIntervalMs = Math.min(this.sessionTTL / 4, 15 * 60 * 1000);
        this.cleanupInterval = setInterval(
            () =>
                this.cleanupExpiredSessions().catch((err) =>
                    this.logger.error(`Periodic session cleanup failed: ${err}`)
                ),
            cleanupIntervalMs
        );

        this.initialized = true;
        this.logger.debug(
            `SessionManager initialized with periodic cleanup every ${Math.round(cleanupIntervalMs / 1000 / 60)} minutes`
        );
    }

    
    private async restoreSessionsFromStorage(): Promise<void> {
        try {
            const sessionIds = await this.services.sessionStore.listSessionIds();
            this.logger.debug(`Found ${sessionIds.length} persisted sessions to restore`);

            for (const sessionId of sessionIds) {
                const sessionData = await this.services.sessionStore.getSession({ sessionId });

                if (sessionData) {
                    const now = Date.now();
                    const lastActivity = sessionData.lastActivity;

                    if (now - lastActivity <= this.sessionTTL) {
                        this.logger.debug(`Session ${sessionId} restored from storage`);
                    } else {
                        await this.services.sessionStore.evictSession({ sessionId });
                        this.evictSessionInteractionState(sessionId);
                        this.logger.debug(
                            `Expired session ${sessionId} evicted during restore; durable history preserved`
                        );
                    }
                }
            }
        } catch (error) {
            this.logger.error(
                `Failed to restore sessions from storage: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    
    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            if (!this.initializationPromise) {
                this.initializationPromise = this.init();
            }
            await this.initializationPromise;
        }
    }

    
    public async createSession(sessionId?: string): Promise<ChatSession> {
        await this.ensureInitialized();

        const id = sessionId ?? randomUUID();

        if (this.pendingCreations.has(id)) {
            return await this.pendingCreations.get(id)!;
        }

        if (this.sessions.has(id)) {
            await this.updateSessionActivity(id);
            return this.sessions.get(id)!;
        }

        const creationPromise = this.createSessionInternal(id);
        this.pendingCreations.set(id, creationPromise);

        try {
            const session = await creationPromise;
            return session;
        } finally {
            this.pendingCreations.delete(id);
        }
    }

    
    public async forkSession(parentSessionId: string): Promise<ChatSession> {
        await this.ensureInitialized();

        const parentSessionData = await this.services.sessionStore.getSession({
            sessionId: parentSessionId,
        });
        if (!parentSessionData) {
            throw SessionError.notFound(parentSessionId);
        }

        const activeSessionIds = await this.services.sessionStore.listSessionIds();

        const childSessionId = await this.generateForkSessionId();
        const now = Date.now();

        const childTitle = this.buildForkTitle(parentSessionData, parentSessionId);
        const childSessionData: SessionData = {
            id: childSessionId,
            createdAt: now,
            lastActivity: now,
            messageCount: parentSessionData.messageCount,
            parentSessionId,
            ...(parentSessionData.metadata !== undefined
                ? {
                      metadata: {
                          ...parentSessionData.metadata,
                          title: childTitle,
                      },
                  }
                : {
                      metadata: {
                          title: childTitle,
                      },
                  }),
            ...(parentSessionData.workspaceId !== undefined && {
                workspaceId: parentSessionData.workspaceId,
            }),
            ...(parentSessionData.llmOverride !== undefined && {
                llmOverride: parentSessionData.llmOverride,
            }),
        };

        try {
            await this.services.sessionStore.saveSession({
                sessionId: childSessionId,
                session: childSessionData,
                ttlSeconds: this.sessionTTL / 1000,
            });
            await this.copySessionHistory(parentSessionId, childSessionId);

            const childSession = await this.createSession(childSessionId);
            this.logger.info(`Forked session '${parentSessionId}' into child '${childSessionId}'`);
            return childSession;
        } catch (error) {
            await Promise.allSettled([
                this.services.sessionStore.deleteSession({ sessionId: childSessionId }),
                this.services.conversationStore.clearMessages({ sessionId: childSessionId }),
            ]);

            const inMemorySession = this.sessions.get(childSessionId);
            if (inMemorySession) {
                try {
                    await inMemorySession.cleanup();
                } catch {
                }
                this.sessions.delete(childSessionId);
            }

            throw error;
        }
    }

    private buildForkTitle(parentSessionData: SessionData, parentSessionId: string): string {
        const rawParentTitle = parentSessionData.metadata?.title;
        const parentTitle = typeof rawParentTitle === 'string' ? rawParentTitle.trim() : '';
        const prefix = SessionManager.FORK_TITLE_PREFIX;

        const baseTitle =
            parentTitle.length > 0
                ? parentTitle.startsWith(prefix)
                    ? parentTitle.slice(prefix.length).trim() || parentTitle
                    : parentTitle
                : parentSessionId.slice(0, SessionManager.FORK_PARENT_ID_PREVIEW_LENGTH);

        return `${prefix}${baseTitle}`;
    }

    private async generateForkSessionId(): Promise<string> {
        for (let attempt = 0; attempt < SessionManager.FORK_ID_GENERATION_MAX_ATTEMPTS; attempt++) {
            const candidateId = randomUUID();
            if (this.sessions.has(candidateId) || this.pendingCreations.has(candidateId)) {
                continue;
            }

            const existing = await this.services.sessionStore.getSession({
                sessionId: candidateId,
            });
            if (!existing) {
                return candidateId;
            }
        }

        throw SessionError.initializationFailed(
            'fork',
            'failed to generate unique child session ID'
        );
    }

    private async copySessionHistory(
        parentSessionId: string,
        childSessionId: string
    ): Promise<void> {
        const messages = await this.services.conversationStore.listMessages({
            sessionId: parentSessionId,
        });

        for (const message of messages) {
            await this.services.conversationStore.saveMessage({
                sessionId: childSessionId,
                message,
            });
        }
    }

    
    private async createSessionInternal(id: string): Promise<ChatSession> {
        await this.cleanupExpiredSessions();

        const existingMetadata = await this.services.sessionStore.getSession({ sessionId: id });
        if (existingMetadata) {
            await this.updateSessionActivity(id);
            const runtimeConfig = this.services.stateManager.getRuntimeConfig();
            const agentId = runtimeConfig.agentCard?.name ?? runtimeConfig.agentId;
            const sessionLogger = this.sessionLoggerFactory({
                baseLogger: this.logger,
                agentId,
                sessionId: id,
            });

            const sessionData = await this.services.sessionStore.getSession({ sessionId: id });
            if (sessionData?.llmOverride) {
                const { resolveApiKeyForProvider } = await import('../utils/api-key-resolver.js');
                const apiKey = resolveApiKeyForProvider(sessionData.llmOverride.provider);
                if (!apiKey) {
                    this.logger.warn(
                        `Skipped LLM override restore for session ${id}: missing API key for provider ${sessionData.llmOverride.provider}`,
                        { sessionId: id, provider: sessionData.llmOverride.provider }
                    );
                } else {
                    const restoredConfig: ValidatedLLMConfig = {
                        ...sessionData.llmOverride,
                        apiKey,
                    };
                    this.services.stateManager.updateLLM(restoredConfig, id);
                }
            }

            const session = new ChatSession(this.getChatSessionServices(), id, sessionLogger);
            await session.init();
            await this.services.toolManager.restoreSessionState(id);
            await this.services.approvalManager.restoreSessionState(id);

            this.sessions.set(id, session);
            this.logger.info(`Restored session from storage: ${id}`);
            return session;
        }

        const activeSessionKeys = await this.services.sessionStore.listSessionIds();

        await this.deleteSessionInteractionState(id);

        const workspace = await this.services.workspaceManager?.getWorkspace();

        const sessionData: SessionData = {
            id,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            messageCount: 0,
            ...(workspace?.id !== undefined && { workspaceId: workspace.id }),
        };

        try {
            await this.services.sessionStore.saveSession({
                sessionId: id,
                session: sessionData,
                ttlSeconds: this.sessionTTL / 1000,
            });
        } catch (error) {
            this.logger.error(`Failed to store session metadata for ${id}:`, {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }

        let session: ChatSession;
        try {
            const runtimeConfig = this.services.stateManager.getRuntimeConfig();
            const agentId = runtimeConfig.agentCard?.name ?? runtimeConfig.agentId;
            const sessionLogger = this.sessionLoggerFactory({
                baseLogger: this.logger,
                agentId,
                sessionId: id,
            });
            session = new ChatSession(this.getChatSessionServices(), id, sessionLogger);
            await session.init();
            this.sessions.set(id, session);

            this.logger.info(`Created new session: ${id}`);
            return session;
        } catch (error) {
            this.logger.error(
                `Failed to initialize session ${id}: ${error instanceof Error ? error.message : String(error)}`
            );
            await this.services.sessionStore.deleteSession({ sessionId: id });
            const reason = error instanceof Error ? error.message : 'unknown error';
            throw SessionError.initializationFailed(id, reason);
        }
    }

    
    public async getSession(
        sessionId: string,
        restoreFromStorage: boolean = true
    ): Promise<ChatSession | undefined> {
        await this.ensureInitialized();

        if (this.pendingCreations.has(sessionId)) {
            return await this.pendingCreations.get(sessionId)!;
        }

        if (this.sessions.has(sessionId)) {
            return this.sessions.get(sessionId)!;
        }

        if (restoreFromStorage) {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });
            if (sessionData) {
                const runtimeConfig = this.services.stateManager.getRuntimeConfig();
                const agentId = runtimeConfig.agentCard?.name ?? runtimeConfig.agentId;
                const sessionLogger = this.sessionLoggerFactory({
                    baseLogger: this.logger,
                    agentId,
                    sessionId,
                });

                if (sessionData.llmOverride) {
                    const { resolveApiKeyForProvider } = await import(
                        '../utils/api-key-resolver.js'
                    );
                    const apiKey = resolveApiKeyForProvider(sessionData.llmOverride.provider);
                    if (!apiKey) {
                        this.logger.warn(
                            `Skipped LLM override restore for session ${sessionId}: missing API key for provider ${sessionData.llmOverride.provider}`,
                            { sessionId, provider: sessionData.llmOverride.provider }
                        );
                    } else {
                        const restoredConfig: ValidatedLLMConfig = {
                            ...sessionData.llmOverride,
                            apiKey,
                        };
                        this.services.stateManager.updateLLM(restoredConfig, sessionId);
                    }
                }

                const session = new ChatSession(
                    this.getChatSessionServices(),
                    sessionId,
                    sessionLogger
                );
                await session.init();
                await this.services.toolManager.restoreSessionState(sessionId);
                await this.services.approvalManager.restoreSessionState(sessionId);

                this.sessions.set(sessionId, session);
                return session;
            }
        }

        return undefined;
    }

    
    public async endSession(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        const session = this.sessions.get(sessionId);
        if (session) {
            await session.cleanup();
            this.sessions.delete(sessionId);
        }

        await this.services.sessionStore.evictSession({ sessionId });
        this.evictSessionInteractionState(sessionId);

        this.logger.debug(
            `Ended session (removed from memory, chat history preserved): ${sessionId}`
        );
    }

    
    public async deleteSession(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        const session = await this.getSession(sessionId);
        if (session) {
            await session.cleanup();
            this.sessions.delete(sessionId);
        }

        await this.services.sessionStore.deleteSession({ sessionId });
        await this.deleteSessionInteractionState(sessionId);
        await this.deleteSessionPendingInput(sessionId);
        await this.services.conversationStore.clearMessages({ sessionId });

        this.logger.debug(`Deleted session and conversation history: ${sessionId}`);
    }

    
    public async resetSession(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        const session = await this.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        await session.reset();
        await session.clearPendingInput();
        await Promise.all([
            this.services.toolManager.deleteSessionState(sessionId),
            this.services.approvalManager.deleteSessionState(sessionId),
        ]);

        if (this.services.stateManager.hasSessionLLMOverride(sessionId)) {
            this.services.stateManager.clearSessionOverride(sessionId);
            await session.switchLLM(this.services.stateManager.getRuntimeConfig().llm);
        }

        await this.runWithSessionDataLock(sessionId, async () => {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });
            if (!sessionData) {
                return;
            }

            sessionData.messageCount = 0;
            sessionData.lastActivity = Date.now();
            delete sessionData.llmOverride;
            await this.persistSessionData(sessionId, sessionData);
        });

        this.logger.debug(`Reset session conversation: ${sessionId}`);
    }

    
    public async listSessions(): Promise<string[]> {
        await this.ensureInitialized();
        return await this.services.sessionStore.listSessionIds();
    }

    
    public async getSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined> {
        await this.ensureInitialized();
        const sessionData = await this.services.sessionStore.getSession({ sessionId });
        if (!sessionData) return undefined;

        return {
            createdAt: sessionData.createdAt,
            lastActivity: sessionData.lastActivity,
            messageCount: sessionData.messageCount,
            title: sessionData.metadata?.title,
            ...(sessionData.tokenUsage && { tokenUsage: sessionData.tokenUsage }),
            ...(sessionData.estimatedCost !== undefined && {
                estimatedCost: sessionData.estimatedCost,
            }),
            ...(sessionData.modelStats && { modelStats: sessionData.modelStats }),
            ...(sessionData.workspaceId && { workspaceId: sessionData.workspaceId }),
            ...(sessionData.parentSessionId !== undefined && {
                parentSessionId: sessionData.parentSessionId,
            }),
            ...(sessionData.usageTracking && { usageTracking: sessionData.usageTracking }),
        };
    }

    public async getSessionSystemPromptContributors(
        sessionId: string
    ): Promise<SessionPromptContributor[]> {
        await this.ensureInitialized();
        const sessionData = await this.services.sessionStore.getSession({ sessionId });

        if (!sessionData) {
            throw SessionError.notFound(sessionId);
        }

        return this.parseSessionPromptContributors(sessionId, sessionData);
    }

    public async upsertSessionSystemPromptContributor(
        sessionId: string,
        contributor: SessionPromptContributor
    ): Promise<boolean> {
        await this.ensureInitialized();

        return await this.runWithSessionDataLock(sessionId, async () => {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });

            if (!sessionData) {
                throw SessionError.notFound(sessionId);
            }

            const existing = this.parseSessionPromptContributors(sessionId, sessionData);
            const next = existing.filter((entry) => entry.id !== contributor.id);
            const replaced = next.length !== existing.length;

            next.push(contributor);
            next.sort((left, right) => left.priority - right.priority);

            sessionData.metadata = sessionData.metadata || {};
            sessionData.metadata.systemPromptContributors = next;
            sessionData.lastActivity = Date.now();

            await this.persistSessionData(sessionId, sessionData);
            return replaced;
        });
    }

    public async removeSessionSystemPromptContributor(
        sessionId: string,
        contributorId: string
    ): Promise<boolean> {
        await this.ensureInitialized();

        return await this.runWithSessionDataLock(sessionId, async () => {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });

            if (!sessionData) {
                throw SessionError.notFound(sessionId);
            }

            const existing = this.parseSessionPromptContributors(sessionId, sessionData);
            const next = existing.filter((entry) => entry.id !== contributorId);
            const removed = next.length !== existing.length;

            if (!removed) {
                return false;
            }

            sessionData.metadata = sessionData.metadata || {};
            sessionData.metadata.systemPromptContributors = next;
            sessionData.lastActivity = Date.now();

            await this.persistSessionData(sessionId, sessionData);
            return true;
        });
    }

    private parseSessionPromptContributors(
        sessionId: string,
        sessionData: SessionData
    ): SessionPromptContributor[] {
        try {
            return SessionPromptContributorSchema.array().parse(
                sessionData.metadata?.systemPromptContributors ?? []
            );
        } catch (error) {
            if (error instanceof ZodError) {
                throw SessionError.storageFailed(sessionId, 'read', error.message);
            }

            throw error;
        }
    }

    public async markUntrackedChatGPTLoginUsage(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        await this.runWithSessionDataLock(sessionId, async () => {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });

            if (!sessionData || sessionData.usageTracking?.hasUntrackedChatGPTLoginUsage) {
                return;
            }

            sessionData.usageTracking = {
                ...(sessionData.usageTracking ?? {}),
                hasUntrackedChatGPTLoginUsage: true,
            };

            await this.persistSessionData(sessionId, sessionData);
        });
    }

    
    public getConfig(): SessionManagerConfig {
        return {
            sessionTTL: this.sessionTTL,
        };
    }

    
    private async updateSessionActivity(sessionId: string): Promise<void> {
        await this.runWithSessionDataLock(sessionId, async () => {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });

            if (!sessionData) {
                return;
            }

            sessionData.lastActivity = Date.now();
            await this.persistSessionData(sessionId, sessionData);
        });
    }

    
    public async incrementMessageCount(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        await this.runWithSessionDataLock(sessionId, async () => {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });

            if (!sessionData) {
                return;
            }

            sessionData.messageCount++;
            sessionData.lastActivity = Date.now();
            await this.persistSessionData(sessionId, sessionData);
        });
    }

    
    public async accumulateTokenUsage(
        sessionId: string,
        usage: TokenUsage,
        cost?: number,
        modelInfo?: { provider: string; model: string }
    ): Promise<void> {
        await this.ensureInitialized();

        await this.runWithSessionDataLock(sessionId, async () => {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });
            const normalizedUsage = normalizeTokenUsageForAccounting(usage);
            const finiteCost = typeof cost === 'number' && Number.isFinite(cost) ? cost : undefined;

            if (!sessionData) return;

            if (modelInfo) {
                this.updateModelStats(sessionData, normalizedUsage, finiteCost, modelInfo);
            }

            if (!sessionData.tokenUsage) {
                sessionData.tokenUsage = {
                    inputTokens: 0,
                    outputTokens: 0,
                    reasoningTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    totalTokens: 0,
                };
            }

            this.accumulateTokensInto(sessionData.tokenUsage, normalizedUsage);

            if (finiteCost !== undefined) {
                sessionData.estimatedCost = (sessionData.estimatedCost ?? 0) + finiteCost;
            }

            sessionData.lastActivity = Date.now();

            await this.persistSessionData(sessionId, sessionData);
        });
    }

    
    private accumulateTokensInto(target: SessionTokenUsage, usage: TokenUsage): void {
        target.inputTokens += usage.inputTokens ?? 0;
        target.outputTokens += usage.outputTokens ?? 0;
        target.reasoningTokens += usage.reasoningTokens ?? 0;
        target.cacheReadTokens += usage.cacheReadTokens ?? 0;
        target.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
        target.totalTokens += usage.totalTokens ?? 0;
    }

    
    private updateModelStats(
        sessionData: SessionData,
        usage: TokenUsage,
        cost: number | undefined,
        modelInfo: { provider: string; model: string }
    ): void {
        if (!sessionData.modelStats) {
            sessionData.modelStats = [];
        }

        let modelStat = sessionData.modelStats.find(
            (s) => s.provider === modelInfo.provider && s.model === modelInfo.model
        );

        if (!modelStat) {
            modelStat = {
                provider: modelInfo.provider,
                model: modelInfo.model,
                messageCount: 0,
                tokenUsage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    reasoningTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    totalTokens: 0,
                },
                estimatedCost: 0,
                firstUsedAt: Date.now(),
                lastUsedAt: Date.now(),
            };
            sessionData.modelStats.push(modelStat);
        }

        this.accumulateTokensInto(modelStat.tokenUsage, usage);

        if (cost !== undefined) {
            modelStat.estimatedCost += cost;
        }

        modelStat.messageCount += 1;

        modelStat.lastUsedAt = Date.now();
    }

    
    public async setSessionTitle(
        sessionId: string,
        title: string,
        opts: { ifUnsetOnly?: boolean } = {}
    ): Promise<void> {
        await this.ensureInitialized();

        const normalized = title.trim().slice(0, 80);
        await this.runWithSessionDataLock(sessionId, async () => {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });

            if (!sessionData) {
                throw SessionError.notFound(sessionId);
            }

            if (opts.ifUnsetOnly && sessionData.metadata?.title) {
                return;
            }

            sessionData.metadata = sessionData.metadata || {};
            sessionData.metadata.title = normalized;
            sessionData.lastActivity = Date.now();

            await this.persistSessionData(sessionId, sessionData);
        });
    }

    
    public async getSessionTitle(sessionId: string): Promise<string | undefined> {
        await this.ensureInitialized();
        const sessionData = await this.services.sessionStore.getSession({ sessionId });
        return sessionData?.metadata?.title;
    }

    
    private async cleanupExpiredSessions(): Promise<void> {
        const now = Date.now();
        const expiredSessions: string[] = [];

        for (const [sessionId, _session] of this.sessions.entries()) {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });

            if (sessionData && now - sessionData.lastActivity > this.sessionTTL) {
                expiredSessions.push(sessionId);
            }
        }

        for (const sessionId of expiredSessions) {
            const session = this.sessions.get(sessionId);
            if (session) {
                session.dispose();
                this.sessions.delete(sessionId);
                this.evictSessionInteractionState(sessionId);
                this.logger.debug(
                    `Removed expired session from memory: ${sessionId} (chat history preserved)`
                );
            }
        }

        if (expiredSessions.length > 0) {
            this.logger.debug(
                `Memory cleanup: removed ${expiredSessions.length} inactive sessions, chat history preserved`
            );
        }
    }

    
    public async switchLLMForAllSessions(
        newLLMConfig: ValidatedLLMConfig
    ): Promise<{ message: string; warnings: string[] }> {
        await this.ensureInitialized();

        const sessionIds = await this.listSessions();
        const failedSessions: string[] = [];

        for (const sId of sessionIds) {
            const session = await this.getSession(sId);
            if (session) {
                try {
                    await this.applySessionLLMSwitch(sId, session, newLLMConfig);
                } catch (error) {
                    failedSessions.push(sId);
                    this.logger.warn(
                        `Error switching LLM for session ${sId}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }

        this.services.agentEventBus.emit('llm:switched', {
            newConfig: newLLMConfig,
            historyRetained: true,
            sessionIds: sessionIds.filter((id) => !failedSessions.includes(id)),
        });

        const message =
            failedSessions.length > 0
                ? `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} (${failedSessions.length} sessions failed)`
                : `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} for all sessions`;

        const warnings =
            failedSessions.length > 0
                ? [`Failed to switch LLM for sessions: ${failedSessions.join(', ')}`]
                : [];

        return { message, warnings };
    }

    
    public async switchLLMForSpecificSession(
        newLLMConfig: ValidatedLLMConfig,
        sessionId: string
    ): Promise<{ message: string; warnings: string[] }> {
        const session = await this.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        await this.applySessionLLMSwitch(sessionId, session, newLLMConfig);

        this.services.stateManager.updateLLM(newLLMConfig);

        this.services.agentEventBus.emit('llm:switched', {
            newConfig: newLLMConfig,
            historyRetained: true,
            sessionIds: [sessionId],
        });

        const message = `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} for session ${sessionId}`;

        return { message, warnings: [] };
    }

    private async applySessionLLMSwitch(
        sessionId: string,
        session: ChatSession,
        newLLMConfig: ValidatedLLMConfig
    ): Promise<void> {
        const previousLLMConfig = this.services.stateManager.getRuntimeConfig(sessionId).llm;
        const previousHadOverride = this.services.stateManager.hasSessionLLMOverride(sessionId);
        const previousPersistedOverride = await this.getPersistedSessionLLMOverride(sessionId);

        await this.setPersistedSessionLLMOverride(
            sessionId,
            this.toPersistedLLMConfig(newLLMConfig)
        );

        try {
            this.services.stateManager.updateLLM(newLLMConfig, sessionId);
            await session.switchLLM(newLLMConfig);
        } catch (error) {
            await this.setPersistedSessionLLMOverride(sessionId, previousPersistedOverride);

            if (previousHadOverride) {
                this.services.stateManager.updateLLM(previousLLMConfig, sessionId);
            } else {
                this.services.stateManager.clearSessionOverride(sessionId);
            }

            try {
                await session.switchLLM(previousLLMConfig);
            } catch (rollbackError) {
                this.logger.error(
                    `Failed to roll back LLM switch for session ${sessionId}: ${
                        rollbackError instanceof Error
                            ? rollbackError.message
                            : String(rollbackError)
                    }`
                );
            }

            throw error;
        }
    }

    private async getPersistedSessionLLMOverride(
        sessionId: string
    ): Promise<PersistedLLMConfig | undefined> {
        const sessionData = await this.getSessionData(sessionId);
        return sessionData?.llmOverride;
    }

    private toPersistedLLMConfig(newLLMConfig: ValidatedLLMConfig): PersistedLLMConfig {
        const { apiKey: _apiKey, ...configWithoutApiKey } = newLLMConfig;
        return configWithoutApiKey;
    }

    private async setPersistedSessionLLMOverride(
        sessionId: string,
        llmOverride: PersistedLLMConfig | undefined
    ): Promise<void> {
        await this.runWithSessionDataLock(sessionId, async () => {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });
            if (!sessionData) {
                return;
            }

            if (llmOverride !== undefined) {
                sessionData.llmOverride = llmOverride;
            } else {
                delete sessionData.llmOverride;
            }
            await this.persistSessionData(sessionId, sessionData);
        });
    }

    private async deleteSessionInteractionState(sessionId: string): Promise<void> {
        this.services.stateManager.clearSessionOverride(sessionId);
        await Promise.all([
            this.services.toolManager.deleteSessionState(sessionId),
            this.services.approvalManager.deleteSessionState(sessionId),
        ]);
    }

    
    public async clearPersistedSessionLLMOverride(sessionId: string): Promise<void> {
        await this.runWithSessionDataLock(sessionId, async () => {
            const sessionData = await this.services.sessionStore.getSession({ sessionId });
            if (!sessionData) {
                return;
            }
            delete sessionData.llmOverride;
            await this.persistSessionData(sessionId, sessionData);
        });
        this.services.stateManager.clearSessionOverride(sessionId);
    }

    private async deleteSessionPendingInput(sessionId: string): Promise<void> {
        await Promise.all([
            this.services.steerQueueStore.clear({ sessionId }),
            this.services.followUpQueueStore.clear({ sessionId }),
        ]);
    }

    private evictSessionInteractionState(sessionId: string): void {
        this.services.toolManager.evictSessionState(sessionId);
        this.services.approvalManager.evictSessionState(sessionId);
    }

    private async runWithSessionDataLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
        const sessionKey = `session:${sessionId}`;
        const previousLock = this.sessionDataLocks.get(sessionKey) ?? Promise.resolve();
        const currentResult = previousLock.catch(() => {}).then(() => fn());
        const currentLock = currentResult.then(
            () => undefined,
            () => undefined
        );

        this.sessionDataLocks.set(sessionKey, currentLock);

        try {
            return await currentResult;
        } finally {
            if (this.sessionDataLocks.get(sessionKey) === currentLock) {
                this.sessionDataLocks.delete(sessionKey);
            }
        }
    }

    private async persistSessionData(sessionId: string, sessionData: SessionData): Promise<void> {
        await this.services.sessionStore.saveSession({
            sessionId,
            session: sessionData,
            ttlSeconds: this.sessionTTL / 1000,
        });
    }

    
    public async getSessionStats(): Promise<{
        totalSessions: number;
        inMemorySessions: number;
        maxSessions: number;
        sessionTTL: number;
    }> {
        await this.ensureInitialized();

        const totalSessions = (await this.listSessions()).length;
        const inMemorySessions = this.sessions.size;

        return {
            totalSessions,
            inMemorySessions,
            maxSessions: this.maxSessions,
            sessionTTL: this.sessionTTL,
        };
    }

    
    public async getSessionData(sessionId: string): Promise<SessionData | undefined> {
        await this.ensureInitialized();
        return await this.services.sessionStore.getSession({ sessionId });
    }

    
    public async cleanup(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            delete this.cleanupInterval;
            this.logger.debug('Periodic session cleanup stopped');
        }

        const sessionIds = Array.from(this.sessions.keys());
        for (const sessionId of sessionIds) {
            try {
                await this.endSession(sessionId);
            } catch (error) {
                this.logger.error(
                    `Failed to cleanup session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        this.sessions.clear();
        this.initialized = false;
        this.logger.debug('SessionManager cleanup completed');
    }
}
