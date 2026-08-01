import { randomUUID } from 'crypto';
import { VercelMessageFormatter } from '../llm/formatters/vercel.js';
import type { LLMContext } from '@fiusdev/llm';
import type { InternalMessage, AssistantMessage, ToolCall } from './types.js';
import { isSystemMessage, isUserMessage, isAssistantMessage, isToolMessage } from './types.js';
import type { Logger } from '../logger/v2/types.js';
import { FiusLogComponent } from '../logger/v2/types.js';
import {
    expandBlobReferences,
    isLikelyBase64String,
    filterCompacted,
    estimateContextTokens,
    estimateMessagesTokens,
    isBinaryMediaMimeType,
} from './utils.js';
import type { SanitizedToolResult } from './types.js';
import { DynamicContributorContext } from '../systemPrompt/types.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import type { ConversationStore } from '../storage/conversation/types.js';
import { ContextError } from './errors.js';
import { ValidatedLLMConfig } from '../llm/schemas.js';
import type { ToolPresentationSnapshotV1 } from '../tools/types.js';
import type { ToolCallMetadata } from '../tools/tool-call-metadata.js';
import { getResourceKind } from './media-helpers.js';
import { describeContentPartsForAudit } from './content-audit.js';

export type PreparedHistoryResult = {
    preparedHistory: InternalMessage[];
    stats: {
        
        originalCount: number;
        
        filteredCount: number;
        
        prunedToolCount: number;
    };
};

function isVisibleInPreparedHistory(message: InternalMessage): boolean {
    if (message.role !== 'assistant') {
        return true;
    }

    return message.assistantOutput.status === 'complete';
}


export class ContextManager<TMessage = unknown> {
    private static readonly PROMPT_MEDIA_RETENTION_MESSAGES = 2;

    
    private llmConfig: ValidatedLLMConfig;

    
    private systemPromptManager: SystemPromptManager;

    
    private formatter: VercelMessageFormatter;

    
    private maxInputTokens: number;

    
    private lastActualInputTokens: number | null = null;

    
    private lastActualOutputTokens: number | null = null;

    
    private lastCallMessageCount: number | null = null;

    private conversationStore: ConversationStore;
    private readonly sessionId: string;

    
    private resourceManager: import('../resources/index.js').ResourceManager;

    private logger: Logger;

    private static deriveResourceKind(mimeType: string): import('./types.js').ResourcePart['kind'] {
        if (
            mimeType.startsWith('text/') ||
            mimeType === 'application/json' ||
            mimeType === 'application/xml'
        ) {
            return 'text';
        }

        return getResourceKind(mimeType);
    }

    private static hasRetainableMedia(message: InternalMessage): boolean {
        if (!Array.isArray(message.content)) {
            return false;
        }

        return message.content.some((part) => {
            if (part.type === 'resource') {
                return isBinaryMediaMimeType(part.mimeType);
            }
            if (part.type === 'image') {
                return typeof part.image === 'string' && part.image.startsWith('@blob:');
            }

            if (part.type === 'file') {
                return (
                    typeof part.data === 'string' &&
                    part.data.startsWith('@blob:') &&
                    isBinaryMediaMimeType(part.mimeType)
                );
            }

            return false;
        });
    }

    private async persistContentPart(
        part: import('./types.js').ContentPart,
        source: 'user' | 'system'
    ): Promise<import('./types.js').ContentPart | null> {
        if (part.type === 'text') {
            return part.text.trim() ? { type: 'text', text: part.text } : null;
        }

        if (part.type === 'ui-resource') {
            return part;
        }

        if (part.type === 'resource') {
            return {
                ...part,
                uri: part.uri.startsWith('@blob:') ? part.uri.substring(1) : part.uri,
            };
        }

        if (part.type === 'image') {
            const mimeType = part.mimeType || 'image/jpeg';
            if (typeof part.image === 'string' && part.image.startsWith('@blob:')) {
                return {
                    type: 'resource',
                    uri: part.image.substring(1),
                    name: 'image',
                    mimeType,
                    kind: ContextManager.deriveResourceKind(mimeType),
                    metadata: { source: source === 'user' ? 'upload' : 'tool' },
                };
            }

            const processedImage = await this.processUserInput(part.image, {
                mimeType,
                source,
            });

            if (typeof processedImage === 'string' && processedImage.startsWith('@blob:')) {
                return {
                    type: 'resource',
                    uri: processedImage.substring(1),
                    name: 'image',
                    mimeType,
                    kind: ContextManager.deriveResourceKind(mimeType),
                    metadata: { source: source === 'user' ? 'upload' : 'tool' },
                };
            }

            return {
                type: 'image',
                image: processedImage,
                mimeType,
            };
        }

        const metadata: {
            mimeType: string;
            originalName?: string;
            source?: 'user' | 'system';
        } = {
            mimeType: part.mimeType,
            source,
        };
        if (part.filename) {
            metadata.originalName = part.filename;
        }

        if (typeof part.data === 'string' && part.data.startsWith('@blob:')) {
            return {
                type: 'resource',
                uri: part.data.substring(1),
                name: part.filename ?? 'file',
                mimeType: part.mimeType,
                kind: ContextManager.deriveResourceKind(part.mimeType),
                metadata: {
                    source: source === 'user' ? 'upload' : 'tool',
                },
            };
        }

        const processedData = await this.processUserInput(part.data, metadata);
        if (typeof processedData === 'string' && processedData.startsWith('@blob:')) {
            return {
                type: 'resource',
                uri: processedData.substring(1),
                name: part.filename ?? 'file',
                mimeType: part.mimeType,
                kind: ContextManager.deriveResourceKind(part.mimeType),
                metadata: {
                    source: source === 'user' ? 'upload' : 'tool',
                },
                ...(part.filename ? {} : {}),
            };
        }

        return {
            type: 'file',
            data: processedData,
            mimeType: part.mimeType,
            ...(part.filename && { filename: part.filename }),
        };
    }

    
    constructor(
        llmConfig: ValidatedLLMConfig,
        formatter: VercelMessageFormatter,
        systemPromptManager: SystemPromptManager,
        maxInputTokens: number,
        conversationStore: ConversationStore,
        sessionId: string,
        resourceManager: import('../resources/index.js').ResourceManager,
        logger: Logger
    ) {
        this.llmConfig = llmConfig;
        this.formatter = formatter;
        this.systemPromptManager = systemPromptManager;
        this.maxInputTokens = maxInputTokens;
        this.conversationStore = conversationStore;
        this.sessionId = sessionId;
        this.resourceManager = resourceManager;
        this.logger = logger.createChild(FiusLogComponent.CONTEXT);

        this.logger.debug(
            `ContextManager: Initialized for session ${sessionId} - history will be managed by ${conversationStore.constructor.name}`
        );
    }

    
    public getResourceManager(): import('../resources/index.js').ResourceManager {
        return this.resourceManager;
    }

    
    private async processUserInput(
        data: string | Uint8Array | Buffer | ArrayBuffer | URL,
        metadata: {
            mimeType: string;
            originalName?: string;
            source?: 'user' | 'system';
        }
    ): Promise<string | Uint8Array | Buffer | ArrayBuffer | URL> {
        const artifactStore = this.resourceManager.getArtifactStore();

        let shouldStoreAsBlob = false;
        let estimatedSize = 0;

        if (typeof data === 'string') {
            if (data.startsWith('data:')) {
                const commaIndex = data.indexOf(',');
                if (commaIndex !== -1) {
                    const base64Data = data.substring(commaIndex + 1);
                    estimatedSize = Math.floor((base64Data.length * 3) / 4);
                }
            } else if (data.length > 100 && data.match(/^[A-Za-z0-9+/=]+$/)) {
                estimatedSize = Math.floor((data.length * 3) / 4);
            } else {
                estimatedSize = Buffer.byteLength(data, 'utf8');
            }
        } else if (data instanceof Buffer || data instanceof Uint8Array) {
            estimatedSize = data.length;
        } else if (data instanceof ArrayBuffer) {
            estimatedSize = data.byteLength;
        } else if (data instanceof URL) {
            return data;
        }

        const isLikelyBinary =
            metadata.mimeType.startsWith('image/') ||
            metadata.mimeType.startsWith('audio/') ||
            metadata.mimeType.startsWith('video/') ||
            metadata.mimeType === 'application/pdf';

        shouldStoreAsBlob = isLikelyBinary || estimatedSize > 5 * 1024;

        if (shouldStoreAsBlob) {
            try {
                const blobInput =
                    typeof data === 'string' &&
                    !data.startsWith('data:') &&
                    !isLikelyBase64String(data) &&
                    !isLikelyBinary
                        ? Buffer.from(data, 'utf-8')
                        : data;

                const artifactRef = await artifactStore.store({
                    data: blobInput,
                    metadata: {
                        mimeType: metadata.mimeType,
                        ...(metadata.originalName !== undefined && {
                            originalName: metadata.originalName,
                        }),
                        source: metadata.source || 'user',
                    },
                });

                this.logger.info(
                    `Stored user input as artifact: ${artifactRef.uri} (${estimatedSize} bytes, ${metadata.mimeType})`
                );

                this.resourceManager.emitCacheInvalidated({
                    resourceUri: artifactRef.uri,
                    serverName: 'internal',
                    action: 'blob_stored',
                });

                return `@${artifactRef.uri}`;
            } catch (error) {
                this.logger.warn(`Failed to store user input as blob: ${String(error)}`);
                return data;
            }
        }

        return data;
    }

    
    getMaxInputTokens(): number {
        return this.maxInputTokens;
    }

    
    getLastActualInputTokens(): number | null {
        return this.lastActualInputTokens;
    }

    
    setLastActualInputTokens(tokens: number): void {
        this.lastActualInputTokens = tokens;
        this.logger.debug(`Updated lastActualInputTokens: ${tokens}`);
    }

    
    getLastActualOutputTokens(): number | null {
        return this.lastActualOutputTokens;
    }

    
    setLastActualOutputTokens(tokens: number): void {
        this.lastActualOutputTokens = tokens;
        this.logger.debug(`Updated lastActualOutputTokens: ${tokens}`);
    }

    
    getLastCallMessageCount(): number | null {
        return this.lastCallMessageCount;
    }

    
    async recordLastCallMessageCount(): Promise<void> {
        const history = await this.conversationStore.loadModelHistory({
            sessionId: this.sessionId,
        });
        this.lastCallMessageCount = history.messages.length;
        this.logger.debug(`Recorded lastCallMessageCount: ${this.lastCallMessageCount}`);
    }

    
    resetActualTokenTracking(): void {
        this.lastActualInputTokens = null;
        this.lastActualOutputTokens = null;
        this.lastCallMessageCount = null;
        this.logger.debug('Reset actual token tracking state (after compaction)');
    }

    private static readonly PRUNED_TOOL_PLACEHOLDER = '[Old tool result content cleared]';

    
    async prepareHistory(): Promise<PreparedHistoryResult> {
        const fullHistory = await this.conversationStore.listMessages({
            sessionId: this.sessionId,
        });
        return this.prepareVisibleHistory({
            history: filterCompacted(fullHistory),
            originalCount: fullHistory.length,
            source: 'prepareHistory',
        });
    }

    
    async prepareModelHistory(): Promise<PreparedHistoryResult> {
        const modelHistory = await this.conversationStore.loadModelHistory({
            sessionId: this.sessionId,
        });
        return this.prepareVisibleHistory({
            history: modelHistory.messages,
            originalCount:
                modelHistory.stats.returnedMessages + modelHistory.stats.skippedPreSummaryMessages,
            source: 'prepareModelHistory',
        });
    }

    async getModelHistory(): Promise<Readonly<InternalMessage[]>> {
        const modelHistory = await this.conversationStore.loadModelHistory({
            sessionId: this.sessionId,
        });
        return modelHistory.messages;
    }

    private prepareVisibleHistory(input: {
        history: InternalMessage[];
        originalCount: number;
        source: string;
    }): PreparedHistoryResult {
        const visibleToolCallIds = new Set<string>();
        let history = input.history.filter((message) => {
            const isVisible = isVisibleInPreparedHistory(message);
            if (isVisible && message.role === 'assistant') {
                for (const toolCall of message.toolCalls ?? []) {
                    visibleToolCallIds.add(toolCall.id);
                }
            }
            return isVisible;
        });

        history = history.filter((message) => {
            return message.role !== 'tool' || visibleToolCallIds.has(message.toolCallId);
        });
        const filteredCount = history.length;

        if (filteredCount < input.originalCount) {
            this.logger.debug(
                `${input.source}: reduced from ${input.originalCount} to ${filteredCount} model-visible messages`
            );
        }

        let prunedToolCount = 0;
        history = history.map((msg) => {
            if (msg.role === 'tool' && msg.compactedAt) {
                prunedToolCount++;
                return {
                    ...msg,
                    content: [
                        { type: 'text' as const, text: ContextManager.PRUNED_TOOL_PLACEHOLDER },
                    ],
                };
            }
            return msg;
        });

        if (prunedToolCount > 0) {
            this.logger.debug(
                `${input.source}: Transformed ${prunedToolCount} pruned tool messages to placeholders`
            );
        }

        return {
            preparedHistory: history,
            stats: {
                originalCount: input.originalCount,
                filteredCount,
                prunedToolCount,
            },
        };
    }

    
    async getSystemPrompt(context: DynamicContributorContext): Promise<string> {
        const prompt = await this.systemPromptManager.build(context);
        this.logger.debug(`[SystemPrompt] Built system prompt:\n${prompt}`);
        return prompt;
    }

    
    async getHistory(): Promise<Readonly<InternalMessage[]>> {
        const history = await this.conversationStore.listMessages({ sessionId: this.sessionId });
        return [...history];
    }

    
    async flush(): Promise<void> {
        await this.conversationStore.flush({ sessionId: this.sessionId });
    }

    
    async clearContext(): Promise<void> {
        const clearMarker: InternalMessage = {
            id: `clear-${Date.now()}`,
            role: 'assistant',
            assistantOutput: { status: 'complete' },
            content: [{ type: 'text', text: '[Context cleared]' }],
            timestamp: Date.now(),
            metadata: {
                isSummary: true,
                clearedAt: Date.now(),
            },
        };

        await this.addMessage(clearMarker);
        this.resetActualTokenTracking();
        this.logger.debug(`Context cleared for session: ${this.sessionId}`);
    }

    
    async appendAssistantText(messageId: string, text: string): Promise<void> {
        const history = await this.conversationStore.listMessages({ sessionId: this.sessionId });
        const messageIndex = history.findIndex((m) => m.id === messageId);

        if (messageIndex === -1) {
            throw ContextError.messageNotFound(messageId);
        }

        const message = history[messageIndex];
        if (!message) {
            throw ContextError.messageNotFound(messageId);
        }

        if (message.role !== 'assistant') {
            throw ContextError.messageNotAssistant(messageId);
        }

        if (message.content === null) {
            message.content = [{ type: 'text', text }];
        } else if (Array.isArray(message.content)) {
            const lastPart = message.content[message.content.length - 1];
            if (lastPart && lastPart.type === 'text') {
                lastPart.text += text;
            } else {
                message.content.push({ type: 'text', text });
            }
        }

        await this.conversationStore.updateMessage({ sessionId: this.sessionId, message });
    }

    
    async addToolCall(messageId: string, toolCall: ToolCall): Promise<void> {
        const history = await this.conversationStore.listMessages({ sessionId: this.sessionId });
        const messageIndex = history.findIndex((m) => m.id === messageId);

        if (messageIndex === -1) {
            throw ContextError.messageNotFound(messageId);
        }

        const message = history[messageIndex];
        if (!message) {
            throw ContextError.messageNotFound(messageId);
        }

        if (message.role !== 'assistant') {
            throw ContextError.messageNotAssistant(messageId);
        }

        if (!message.toolCalls) {
            message.toolCalls = [];
        }

        message.toolCalls.push(toolCall);
        await this.conversationStore.updateMessage({ sessionId: this.sessionId, message });
    }

    
    async updateAssistantMessage(
        messageId: string,
        updates: Partial<InternalMessage>
    ): Promise<void> {
        const history = await this.conversationStore.listMessages({ sessionId: this.sessionId });
        const messageIndex = history.findIndex((m) => m.id === messageId);

        if (messageIndex === -1) {
            throw ContextError.messageNotFound(messageId);
        }

        const message = history[messageIndex];
        if (!message) {
            throw ContextError.messageNotFound(messageId);
        }

        if (message.role !== 'assistant') {
            throw ContextError.messageNotAssistant(messageId);
        }

        Object.assign(message, updates);
        await this.conversationStore.updateMessage({ sessionId: this.sessionId, message });
    }

    
    async markMessagesAsCompacted(messageIds: string[]): Promise<number> {
        if (messageIds.length === 0) {
            return 0;
        }

        const history = await this.conversationStore.listMessages({ sessionId: this.sessionId });
        const timestamp = Date.now();
        let markedCount = 0;

        for (const messageId of messageIds) {
            const message = history.find((m) => m.id === messageId);

            if (!message) {
                this.logger.warn(`markMessagesAsCompacted: Message ${messageId} not found`);
                continue;
            }

            if (message.role !== 'tool') {
                this.logger.warn(
                    `markMessagesAsCompacted: Message ${messageId} is not a tool message (role=${message.role})`
                );
                continue;
            }

            if (message.compactedAt) {
                continue;
            }

            message.compactedAt = timestamp;
            await this.conversationStore.updateMessage({ sessionId: this.sessionId, message });
            markedCount++;
        }

        if (markedCount > 0) {
            this.logger.debug(
                `markMessagesAsCompacted: Marked ${markedCount} messages as compacted`
            );
        }

        return markedCount;
    }

    
    async addMessage(message: InternalMessage): Promise<InternalMessage> {
        switch (message.role) {
            case 'user':
                if (!Array.isArray(message.content) || message.content.length === 0) {
                    throw ContextError.userMessageContentInvalid();
                }
                break;

            case 'assistant':
                if (
                    message.content === null &&
                    (!message.toolCalls || message.toolCalls.length === 0)
                ) {
                    throw ContextError.assistantMessageContentOrToolsRequired();
                }
                if (message.toolCalls) {
                    if (
                        !Array.isArray(message.toolCalls) ||
                        message.toolCalls.some(
                            (tc) => !tc.id || !tc.function?.name || !tc.function?.arguments
                        )
                    ) {
                        throw ContextError.assistantMessageToolCallsInvalid();
                    }
                }

                message.provider = this.llmConfig.provider;
                message.model = this.llmConfig.model;
                break;

            case 'tool':
                if (!message.toolCallId || !message.name || message.content === null) {
                    throw ContextError.toolMessageFieldsMissing();
                }
                break;

            case 'system': {
                this.logger.warn(
                    'ContextManager: Adding system message directly to history. Use SystemPromptManager instead.'
                );
                const textContent = message.content
                    ?.filter((p): p is import('./types.js').TextPart => p.type === 'text')
                    .map((p) => p.text)
                    .join('');
                if (!textContent || textContent.trim() === '') {
                    throw ContextError.systemMessageContentInvalid();
                }
                break;
            }
        }

        if (!message.id) {
            message.id = randomUUID();
        }
        if (!message.timestamp) {
            message.timestamp = Date.now();
        }

        this.logger.debug(
            `ContextManager: Adding message to conversation store: ${JSON.stringify(message, null, 2)}`
        );

        await this.conversationStore.saveMessage({ sessionId: this.sessionId, message });
        this.logger.debug('ContextManager: Message saved to conversation store', {
            messageId: message.id,
            role: message.role,
        });

        return message;
    }

    
    async addUserMessage(content: import('./types.js').ContentPart[]): Promise<void> {
        if (!Array.isArray(content) || content.length === 0) {
            throw ContextError.userMessageContentEmpty();
        }

        const hasText = content.some((p) => p.type === 'text' && p.text.trim() !== '');
        const hasAttachment = content.some(
            (p) => p.type === 'image' || p.type === 'file' || p.type === 'resource'
        );

        if (!hasText && !hasAttachment) {
            throw ContextError.userMessageContentEmpty();
        }

        const processedParts: InternalMessage['content'] = [];

        for (const part of content) {
            const persisted = await this.persistContentPart(part, 'user');
            if (persisted) {
                processedParts.push(persisted);
            }
        }

        this.logger.info('User message received', {
            ...(await describeContentPartsForAudit(processedParts)),
        });

        await this.addMessage({ role: 'user', content: processedParts });
    }

    
    async addAssistantMessage(
        content: string | null,
        toolCalls?: AssistantMessage['toolCalls'],
        metadata?: {
            tokenUsage?: AssistantMessage['tokenUsage'];
            reasoning?: string;
            estimatedCost?: AssistantMessage['estimatedCost'];
            pricingStatus?: AssistantMessage['pricingStatus'];
            usageScopeId?: AssistantMessage['usageScopeId'];
            assistantOutput?: AssistantMessage['assistantOutput'];
        }
    ): Promise<string> {
        if (content === null && (!toolCalls || toolCalls.length === 0)) {
            throw ContextError.assistantMessageContentOrToolsRequired();
        }
        const contentArray: InternalMessage['content'] =
            content !== null ? [{ type: 'text', text: content }] : null;
        const message = await this.addMessage({
            role: 'assistant' as const,
            content: contentArray,
            ...(toolCalls && toolCalls.length > 0 && { toolCalls }),
            ...(metadata?.tokenUsage && { tokenUsage: metadata.tokenUsage }),
            ...(metadata?.reasoning && { reasoning: metadata.reasoning }),
            ...(metadata?.estimatedCost !== undefined && {
                estimatedCost: metadata.estimatedCost,
            }),
            ...(metadata?.pricingStatus && { pricingStatus: metadata.pricingStatus }),
            ...(metadata?.usageScopeId && { usageScopeId: metadata.usageScopeId }),
            assistantOutput: metadata?.assistantOutput ?? { status: 'complete' },
        });

        if (message.id === undefined) {
            throw ContextError.assistantMessageIdMissing();
        }

        return message.id;
    }

    
    async addToolResult(
        toolCallId: string,
        name: string,
        sanitizedResult: SanitizedToolResult,
        metadata?: {
            requireApproval?: boolean;
            approvalStatus?: 'approved' | 'rejected';
            presentationSnapshot?: ToolPresentationSnapshotV1;
            meta?: ToolCallMetadata;
        }
    ): Promise<void> {
        if (!toolCallId || !name) {
            throw ContextError.toolCallIdNameRequired();
        }

        const summary = sanitizedResult.content
            .map((p) =>
                p.type === 'text'
                    ? `text(${p.text.length})`
                    : p.type === 'image'
                      ? `image(${p.mimeType || 'image'})`
                      : p.type === 'resource'
                        ? `resource(${p.uri})`
                        : p.type === 'ui-resource'
                          ? `ui-resource(${p.uri})`
                          : `file(${p.mimeType || 'file'})`
            )
            .join(', ');
        this.logger.debug(`ContextManager: Storing tool result (parts) for ${name}: [${summary}]`);

        const persistedContent: import('./types.js').ContentPart[] = [];
        for (const part of sanitizedResult.content) {
            const persisted = await this.persistContentPart(part, 'system');
            if (persisted) {
                persistedContent.push(persisted);
            }
        }

        await this.addMessage({
            role: 'tool',
            content: persistedContent,
            toolCallId,
            name,
            ...(metadata?.presentationSnapshot !== undefined && {
                presentationSnapshot: metadata.presentationSnapshot,
            }),
            ...(metadata?.meta !== undefined && {
                meta: metadata.meta,
            }),
            success: sanitizedResult.meta.success,
            ...(sanitizedResult.meta.display !== undefined && {
                displayData: sanitizedResult.meta.display,
            }),
            ...(metadata?.requireApproval !== undefined && {
                requireApproval: metadata.requireApproval,
            }),
            ...(metadata?.approvalStatus !== undefined && {
                approvalStatus: metadata.approvalStatus,
            }),
        });
    }

    
    async getFormattedMessages(
        contributorContext: DynamicContributorContext,
        llmContext: LLMContext,
        systemPrompt?: string | undefined,
        history?: InternalMessage[]
    ): Promise<TMessage[]> {
        let messageHistory: InternalMessage[] =
            history ?? (await this.conversationStore.listMessages({ sessionId: this.sessionId }));

        let allowedMediaTypes: string[] | undefined = this.llmConfig.allowedMediaTypes;
        if (!allowedMediaTypes) {
            try {
                const { getSupportedFileTypesForModel } = await import('@fiusdev/llm');
                const { fileTypesToMimePatterns } = await import('./utils.js');
                const supportedFileTypes = getSupportedFileTypesForModel(
                    llmContext.provider,
                    llmContext.model
                );
                allowedMediaTypes = fileTypesToMimePatterns(supportedFileTypes, this.logger);
                this.logger.debug(
                    `Using model capabilities for media filtering: ${allowedMediaTypes.join(', ')}`
                );
            } catch (error) {
                this.logger.warn(
                    `Could not determine model capabilities, allowing all media types: ${String(error)}`
                );
                allowedMediaTypes = undefined;
            }
        } else {
            this.logger.debug(
                `Using user-configured allowedMediaTypes: ${allowedMediaTypes.join(', ')}`
            );
        }

        this.logger.debug('Resolving blob references in message history before formatting');
        const retainedMediaMessageIndexes = new Set<number>();
        let retainedMediaMessages = 0;
        for (let index = messageHistory.length - 1; index >= 0; index--) {
            if (retainedMediaMessages >= ContextManager.PROMPT_MEDIA_RETENTION_MESSAGES) {
                break;
            }

            const message = messageHistory[index]!;
            if (
                (isUserMessage(message) || isToolMessage(message)) &&
                ContextManager.hasRetainableMedia(message)
            ) {
                retainedMediaMessageIndexes.add(index);
                retainedMediaMessages += 1;
            }
        }

        messageHistory = await Promise.all(
            messageHistory.map(async (message, index): Promise<InternalMessage> => {
                if (isSystemMessage(message) || isAssistantMessage(message)) {
                    return message;
                }
                const expandMatchingMedia = retainedMediaMessageIndexes.has(index);
                if (isUserMessage(message)) {
                    const expandedContent = await expandBlobReferences(
                        message.content,
                        this.resourceManager,
                        this.logger,
                        allowedMediaTypes,
                        expandMatchingMedia
                    );
                    return { ...message, content: expandedContent };
                }
                if (isToolMessage(message)) {
                    const expandToolMedia = retainedMediaMessageIndexes.has(index);
                    const expandedContent = await expandBlobReferences(
                        message.content,
                        this.resourceManager,
                        this.logger,
                        allowedMediaTypes,
                        expandToolMedia
                    );
                    return { ...message, content: expandedContent };
                }
                return message;
            })
        );

        const prompt = systemPrompt ?? (await this.getSystemPrompt(contributorContext));
        return this.formatter.format([...messageHistory], llmContext, prompt) as TMessage[];
    }

    
    async getFormattedMessagesForLLM(
        contributorContext: DynamicContributorContext,
        llmContext: LLMContext
    ): Promise<{
        formattedMessages: TMessage[];
        systemPrompt: string;
        preparedHistory: InternalMessage[];
    }> {
        const systemPrompt = await this.getSystemPrompt(contributorContext);

        const { preparedHistory } = await this.prepareModelHistory();

        const formattedMessages = await this.getFormattedMessages(
            contributorContext,
            llmContext,
            systemPrompt,
            preparedHistory
        );

        return {
            formattedMessages,
            systemPrompt,
            preparedHistory,
        };
    }

    
    async getContextTokenEstimate(
        contributorContext: DynamicContributorContext,
        tools: Record<string, { name?: string; description?: string; parameters?: unknown }>
    ): Promise<{
        
        estimated: number;
        
        actual: number | null;
        
        breakdown: {
            systemPrompt: number;
            tools: {
                total: number;
                perTool: Array<{ name: string; tokens: number }>;
            };
            messages: number;
        };
        
        stats: {
            originalMessageCount: number;
            filteredMessageCount: number;
            prunedToolCount: number;
        };
        
        calculationBasis?: {
            
            method: 'actuals' | 'estimate';
            
            lastInputTokens?: number;
            
            lastOutputTokens?: number;
            
            newMessagesEstimate?: number;
        };
    }> {
        const systemPrompt = await this.getSystemPrompt(contributorContext);

        const modelHistory = await this.conversationStore.loadModelHistory({
            sessionId: this.sessionId,
        });
        const { preparedHistory, stats } = this.prepareVisibleHistory({
            history: modelHistory.messages,
            originalCount:
                modelHistory.stats.returnedMessages + modelHistory.stats.skippedPreSummaryMessages,
            source: 'getContextTokenEstimate',
        });

        const lastInput = this.lastActualInputTokens;
        const lastOutput = this.lastActualOutputTokens;
        const lastMsgCount = this.lastCallMessageCount;
        const currentHistory = modelHistory.messages;

        const pureEstimate = estimateContextTokens(systemPrompt, preparedHistory, tools);

        let total: number;
        let calculationBasis: {
            method: 'actuals' | 'estimate';
            lastInputTokens?: number;
            lastOutputTokens?: number;
            newMessagesEstimate?: number;
        };

        if (lastInput !== null && lastOutput !== null && lastMsgCount !== null) {
            const newMessages = currentHistory.slice(lastMsgCount);
            const newMessagesEstimate = estimateMessagesTokens(newMessages);

            total = lastInput + lastOutput + newMessagesEstimate;

            calculationBasis = {
                method: 'actuals',
                lastInputTokens: lastInput,
                lastOutputTokens: lastOutput,
                newMessagesEstimate,
            };

            this.logger.info(
                `Context estimate (actuals-based): lastInput=${lastInput}, lastOutput=${lastOutput}, ` +
                    `newMsgs=${newMessagesEstimate} (${newMessages.length} messages), total=${total}`
            );
        } else {
            total = pureEstimate.total;

            calculationBasis = {
                method: 'estimate',
            };

            this.logger.debug(
                `Context estimate (pure estimate): total=${total} (no actuals available yet)`
            );
        }

        const systemPromptTokens = pureEstimate.breakdown.systemPrompt;
        const toolsTokens = pureEstimate.breakdown.tools;

        const messagesDisplay = Math.max(0, total - systemPromptTokens - toolsTokens.total);

        if (lastInput !== null) {
            const pureTotal = pureEstimate.total;
            const diff = pureTotal - lastInput;
            const diffPercent = lastInput > 0 ? ((diff / lastInput) * 100).toFixed(1) : '0.0';
            this.logger.info(
                `Context token calibration: pureEstimate=${pureTotal}, lastActual=${lastInput}, ` +
                    `diff=${diff} (${diffPercent}%)`
            );
        }

        return {
            estimated: total,
            actual: lastInput,
            breakdown: {
                systemPrompt: systemPromptTokens,
                tools: toolsTokens,
                messages: messagesDisplay,
            },
            stats: {
                originalMessageCount: stats.originalCount,
                filteredMessageCount: stats.filteredCount,
                prunedToolCount: stats.prunedToolCount,
            },
            calculationBasis,
        };
    }

    
    async getEstimatedNextInputTokens(
        systemPrompt: string,
        preparedHistory: readonly InternalMessage[],
        tools: Record<string, { name?: string; description?: string; parameters?: unknown }>
    ): Promise<number> {
        const lastInput = this.lastActualInputTokens;
        const lastOutput = this.lastActualOutputTokens;
        const lastMsgCount = this.lastCallMessageCount;

        if (lastInput !== null && lastOutput !== null && lastMsgCount !== null) {
            const modelHistory = await this.conversationStore.loadModelHistory({
                sessionId: this.sessionId,
            });
            const newMessages = modelHistory.messages.slice(lastMsgCount);
            const newMessagesEstimate = estimateMessagesTokens(newMessages);
            const total = lastInput + lastOutput + newMessagesEstimate;

            this.logger.debug(
                `Estimated next input (actuals-based): ${lastInput} + ${lastOutput} + ${newMessagesEstimate} = ${total}`
            );
            return total;
        }

        const pureEstimate = estimateContextTokens(systemPrompt, preparedHistory, tools);
        this.logger.debug(`Estimated next input (pure estimate): ${pureEstimate.total}`);
        return pureEstimate.total;
    }

    
    async getFormattedSystemPrompt(
        _context: DynamicContributorContext
    ): Promise<string | null | undefined> {
        return this.formatter.formatSystemPrompt?.();
    }

    
    async resetConversation(): Promise<void> {
        await this.conversationStore.clearMessages({ sessionId: this.sessionId });
        this.resetActualTokenTracking();
        this.logger.debug(
            `ContextManager: Conversation history cleared for session ${this.sessionId}`
        );
    }
}
