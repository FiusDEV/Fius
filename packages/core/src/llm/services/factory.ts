import { ToolManager } from '../../tools/tool-manager.js';
import { ValidatedLLMConfig } from '../schemas.js';
import { LLMError } from '../errors.js';
import { VercelLLMService } from './vercel.js';
import type { LanguageModel } from 'ai';
import { SessionEventBus } from '../../events/index.js';
import type { ConversationStore } from '../../storage/conversation/types.js';
import type { SystemPromptManager } from '../../systemPrompt/manager.js';
import type { Logger } from '../../logger/v2/types.js';
import type {
    CreateLLMServiceOptions,
    FiusProviderContext,
    LanguageModelFactory,
} from './types.js';
import { findFiusProjectRoot } from '../../utils/execution-context.js';
import { resolveApiKeyForProvider } from '../../utils/api-key-resolver.js';

const DEFAULT_FIUS_GATEWAY_BASE_URL = 'https://fius.dev/v1';

function trimTrailingSlash(value: string): string {
    return value.trim().replace(/\/$/, '');
}

function resolveFiusGatewayBaseURL(baseURL?: string): string {
    if (baseURL?.trim()) {
        return trimTrailingSlash(baseURL);
    }

    const envBaseURL = process.env.FIUS_API_URL?.trim();
    if (!envBaseURL) {
        return DEFAULT_FIUS_GATEWAY_BASE_URL;
    }

    const normalizedEnvBaseURL = trimTrailingSlash(envBaseURL);
    if (normalizedEnvBaseURL.endsWith('/v1')) {
        return normalizedEnvBaseURL;
    }

    return `${normalizedEnvBaseURL}/v1`;
}

function resolveProviderWorkingDirectory(explicitCwd?: string): string {
    if (explicitCwd && explicitCwd.trim().length > 0) {
        return explicitCwd;
    }

    return findFiusProjectRoot(process.cwd()) ?? process.cwd();
}

export async function createVercelModel(
    llmConfig: ValidatedLLMConfig,
    context?: FiusProviderContext
): Promise<LanguageModel> {
    const { model, apiKey, baseURL } = llmConfig;

    const isFiusGateway = !baseURL?.trim();
    const fiusBaseURL = isFiusGateway ? DEFAULT_FIUS_GATEWAY_BASE_URL : trimTrailingSlash(baseURL!);
    const resolvedApiKey = isFiusGateway
        ? (apiKey?.trim() || resolveApiKeyForProvider('fius-gateway') || undefined)
        : (apiKey?.trim() || undefined);

    const headers: Record<string, string> = {};
    if (context?.sessionId) {
        headers['X-Fius-Session-ID'] = context.sessionId;
    }
    if (process.env.FIUS_CLI_VERSION) {
        headers['X-Fius-Version'] = process.env.FIUS_CLI_VERSION;
    }

    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    const provider = createOpenAICompatible({
        name: isFiusGateway ? 'fius-gateway' : `custom-${model}`,
        baseURL: fiusBaseURL,
        headers,
        ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
    });

    const chatModel = provider.chatModel(model);
    if (
        !chatModel ||
        typeof chatModel !== 'object' ||
        (typeof (chatModel as any).doGenerate !== 'function' &&
            typeof (chatModel as any).doStream !== 'function')
    ) {
        throw LLMError.generationFailed(
            'Fius gateway returned an invalid language model instance',
            'fius-gateway',
            model
        );
    }
    return chatModel;
}

export async function createLLMService(
    config: ValidatedLLMConfig,
    toolManager: ToolManager,
    systemPromptManager: SystemPromptManager,
    conversationStore: ConversationStore,
    sessionEventBus: SessionEventBus,
    sessionId: string,
    resourceManager: import('../../resources/index.js').ResourceManager,
    logger: Logger,
    options: CreateLLMServiceOptions,
    languageModelFactory?: LanguageModelFactory
): Promise<VercelLLMService> {
    const { usageScopeId, compactionStrategy, executionControl, steerQueue, followUpQueue } =
        options;

    const providerContext: FiusProviderContext = {
        sessionId,
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        authResolver: options.authResolver ?? null,
        logger,
    };

    const model = await (languageModelFactory?.({
        config,
        context: providerContext,
        createDefaultLanguageModel: () => createVercelModel(config, providerContext),
    }) ?? createVercelModel(config, providerContext));

    return new VercelLLMService(
        toolManager,
        model,
        systemPromptManager,
        conversationStore,
        sessionEventBus,
        config,
        sessionId,
        resourceManager,
        logger,
        steerQueue,
        followUpQueue,
        usageScopeId,
        executionControl,
        compactionStrategy
    );
}
