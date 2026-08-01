import { Result, hasErrors, splitIssues, ok, fail, zodToIssues } from '../utils/result.js';
import { Issue, ErrorScope, ErrorType } from '../errors/types.js';
import { LLMErrorCode } from './error-codes.js';

import { type ValidatedLLMConfig, type LLMUpdates, type LLMConfig } from './schemas.js';
import { LLMConfigSchema } from './schemas.js';
import {
    getDefaultModelForProvider,
    acceptsAnyModel,
    isValidProviderModel,
    supportsBaseURL,
    supportsCustomModels,
    hasAllRegistryModelsSupport,
    getProviderFromModel,
} from '@fiusdev/llm';
import { getEffectiveMaxInputTokens } from './registry/index.js';
import {
    lookupOpenRouterModel,
} from './providers/model-registry.js';
import type { LLMUpdateContext } from '@fiusdev/llm';
import { resolveApiKeyForProvider } from '../utils/api-key-resolver.js';
import type { Logger } from '../logger/v2/types.js';

export async function resolveAndValidateLLMConfig(
    previous: ValidatedLLMConfig,
    updates: LLMUpdates,
    logger: Logger
): Promise<Result<ValidatedLLMConfig, LLMUpdateContext>> {
    const { candidate, warnings } = await resolveLLMConfig(previous, updates, logger);

    if (hasErrors(warnings)) {
        const { errors } = splitIssues(warnings);
        return fail<ValidatedLLMConfig, LLMUpdateContext>(errors);
    }
    const result = validateLLMConfig(candidate, warnings, logger);
    return result;
}

export async function resolveLLMConfig(
    previous: ValidatedLLMConfig,
    updates: LLMUpdates,
    logger: Logger
): Promise<{ candidate: LLMConfig; warnings: Issue<LLMUpdateContext>[] }> {
    const warnings: Issue<LLMUpdateContext>[] = [];

    const provider: string =
        updates.provider ??
        (updates.model && !updates.model.includes('/')
            ? (() => {
                  try {
                      return getProviderFromModel(updates.model) ?? previous.provider;
                  } catch {
                      return previous.provider;
                  }
              })()
            : previous.provider);

    const envKey = resolveApiKeyForProvider(provider);
    const apiKey =
        updates.apiKey ?? (provider !== previous.provider ? envKey : previous.apiKey) ?? '';

    if (!apiKey) {
        warnings.push({
            code: LLMErrorCode.API_KEY_CANDIDATE_MISSING,
            message: 'API key not provided or found in environment',
            severity: 'warning',
            scope: ErrorScope.LLM,
            type: ErrorType.USER,
            context: { provider },
        });
    } else if (typeof apiKey === 'string' && apiKey.length < 10) {
        warnings.push({
            code: LLMErrorCode.API_KEY_INVALID,
            message: 'API key looks unusually short',
            severity: 'warning',
            scope: ErrorScope.LLM,
            type: ErrorType.USER,
            context: { provider },
        });
    }

    let model = updates.model ?? previous.model;
    if (
        provider !== previous.provider &&
        !acceptsAnyModel(provider) &&
        !supportsCustomModels(provider) &&
        !isValidProviderModel(provider, model)
    ) {
        model = getDefaultModelForProvider(provider) ?? previous.model;
        warnings.push({
            code: LLMErrorCode.MODEL_INCOMPATIBLE,
            message: `Model set to default '${model}' for provider '${provider}'`,
            severity: 'warning',
            scope: ErrorScope.LLM,
            type: ErrorType.USER,
            context: { provider, model },
        });
    }

    if (
        provider !== previous.provider &&
        updates.model == null &&
        hasAllRegistryModelsSupport(provider) &&
        !model.includes('/')
    ) {
        const defaultGatewayModel = getDefaultModelForProvider(provider);
        if (defaultGatewayModel) {
            model = defaultGatewayModel;
            warnings.push({
                code: LLMErrorCode.MODEL_INCOMPATIBLE,
                message: `Model set to default '${model}' for provider '${provider}'`,
                severity: 'warning',
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
                context: { provider, model },
            });
        }
    }

    let baseURL: string | undefined;
    if (provider !== previous.provider) {
        baseURL = updates.baseURL?.trim() || undefined;
    } else if (updates.baseURL) {
        baseURL = updates.baseURL;
    } else if (supportsBaseURL(provider)) {
        baseURL = previous.baseURL;
    } else {
        baseURL = undefined;
    }

    if (provider === 'vertex') {
        const projectId = process.env.GOOGLE_VERTEX_PROJECT;
        if (!projectId || !projectId.trim()) {
            warnings.push({
                code: LLMErrorCode.CONFIG_MISSING,
                message:
                    'GOOGLE_VERTEX_PROJECT environment variable is required for Vertex AI. ' +
                    'Set it to your GCP project ID and ensure ADC is configured via `gcloud auth application-default login`',
                severity: 'error',
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
                context: { provider, model },
            });
        }
    }

    if (provider === 'bedrock') {
        const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
        if (!region || !region.trim()) {
            warnings.push({
                code: LLMErrorCode.CONFIG_MISSING,
                message:
                    'AWS_REGION environment variable is required for Amazon Bedrock. ' +
                    'Also set either AWS_BEARER_TOKEN_BEDROCK (API key) or ' +
                    'AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (IAM credentials).',
                severity: 'error',
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
                context: { provider, model },
            });
        }
    }

    if (provider === 'openrouter') {
    }

    const didProviderOrModelChange = provider !== previous.provider || model !== previous.model;

    const nextReasoning = (() => {
        if (!Object.prototype.hasOwnProperty.call(updates, 'reasoning')) {
            return didProviderOrModelChange ? undefined : previous.reasoning;
        }

        const updateReasoning = updates.reasoning;
        if (updateReasoning === null) return undefined;
        if (updateReasoning === undefined) return previous.reasoning;
        return updateReasoning;
    })();

    return {
        candidate: {
            provider: provider ?? previous.provider,
            model,
            apiKey,
            baseURL,
            maxIterations: updates.maxIterations ?? previous.maxIterations,
            maxInputTokens: updates.maxInputTokens,
            maxOutputTokens: updates.maxOutputTokens ?? previous.maxOutputTokens,
            temperature: updates.temperature ?? previous.temperature,
            reasoning: nextReasoning,
            allowedMediaTypes: updates.allowedMediaTypes ?? previous.allowedMediaTypes,
        },
        warnings,
    };
}

export function validateLLMConfig(
    candidate: LLMConfig,
    warnings: Issue<LLMUpdateContext>[],
    logger: Logger
): Result<ValidatedLLMConfig, LLMUpdateContext> {
    const parsed = LLMConfigSchema.safeParse(candidate);
    if (!parsed.success) {
        return fail<ValidatedLLMConfig, LLMUpdateContext>(zodToIssues(parsed.error, 'error'));
    }

    const maxInputTokens =
        parsed.data.maxInputTokens ??
        getEffectiveMaxInputTokens(
            {
                provider: parsed.data.provider,
                model: parsed.data.model,
                baseURL: parsed.data.baseURL,
            },
            logger
        );

    if (parsed.data.apiKey && parsed.data.apiKey.length < 10) {
        warnings.push({
            code: LLMErrorCode.API_KEY_INVALID,
            message: 'API key seems too short - please verify it is correct',
            path: ['apiKey'],
            severity: 'warning',
            scope: ErrorScope.LLM,
            type: ErrorType.USER,
            context: {
                provider: candidate.provider,
                model: candidate.model ?? '',
            },
        });
    }

    return ok<ValidatedLLMConfig, LLMUpdateContext>({ ...parsed.data, maxInputTokens }, warnings);
}
