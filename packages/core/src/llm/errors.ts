import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { ErrorScope } from '../errors/types.js';
import { ErrorType } from '../errors/types.js';
import { LLMErrorCode } from './error-codes.js';
import { getSupportedProviders } from '@fiusdev/llm';
import type { LLMProvider } from '@fiusdev/llm';

export class LLMError {
    static unknownModel(provider: LLMProvider, model: string) {
        return new FiusRuntimeError(
            LLMErrorCode.MODEL_UNKNOWN,
            ErrorScope.LLM,
            ErrorType.USER,
            `Unknown model '${model}' for provider '${provider}'`,
            { provider, model }
        );
    }

    static baseUrlMissing(provider: LLMProvider) {
        return new FiusRuntimeError(
            LLMErrorCode.BASE_URL_MISSING,
            ErrorScope.LLM,
            ErrorType.USER,
            `Provider '${provider}' requires a baseURL (set config.baseURL or OPENAI_BASE_URL environment variable)`,
            { provider }
        );
    }

    static missingConfig(provider: LLMProvider, configName: string) {
        return new FiusRuntimeError(
            LLMErrorCode.CONFIG_MISSING,
            ErrorScope.LLM,
            ErrorType.USER,
            `Provider '${provider}' requires ${configName}`,
            { provider, configName }
        );
    }

    static unsupportedProvider(provider: string) {
        const availableProviders = getSupportedProviders();
        return new FiusRuntimeError(
            LLMErrorCode.PROVIDER_UNSUPPORTED,
            ErrorScope.LLM,
            ErrorType.USER,
            `Provider '${provider}' is not supported. Available providers: ${availableProviders.join(', ')}`,
            { provider, availableProviders }
        );
    }

    static apiKeyMissing(provider: LLMProvider, envVar: string) {
        return new FiusRuntimeError(
            LLMErrorCode.API_KEY_MISSING,
            ErrorScope.LLM,
            ErrorType.USER,
            `API key required for provider '${provider}'`,
            { provider, envVar },
            `Set the ${envVar} environment variable or configure it in Settings`
        );
    }

    static modelProviderUnknown(model: string) {
        const availableProviders = getSupportedProviders();
        return new FiusRuntimeError(
            LLMErrorCode.MODEL_UNKNOWN,
            ErrorScope.LLM,
            ErrorType.USER,
            `Unknown model '${model}' - could not infer provider. Available providers: ${availableProviders.join(', ')}`,
            { model, availableProviders },
            'Specify the provider explicitly or use a recognized model name'
        );
    }

    static rateLimitExceeded(provider: LLMProvider, retryAfter?: number) {
        return new FiusRuntimeError(
            LLMErrorCode.RATE_LIMIT_EXCEEDED,
            ErrorScope.LLM,
            ErrorType.RATE_LIMIT,
            `Rate limit exceeded for ${provider}`,
            {
                details: { provider, retryAfter },
                recovery: retryAfter
                    ? `Wait ${retryAfter} seconds before retrying`
                    : 'Wait before retrying or upgrade your plan',
            }
        );
    }

    static insufficientCredits(balance?: number) {
        const balanceStr = balance !== undefined ? `$${balance.toFixed(2)}` : 'low';
        return new FiusRuntimeError(
            LLMErrorCode.INSUFFICIENT_CREDITS,
            ErrorScope.LLM,
            ErrorType.FORBIDDEN,
            `Insufficient Fius credits. Balance: ${balanceStr}`,
            { balance },
            'Run `fius billing` to check your balance'
        );
    }

    static generationFailed(error: string, provider: LLMProvider, model: string) {
        return new FiusRuntimeError(
            LLMErrorCode.GENERATION_FAILED,
            ErrorScope.LLM,
            ErrorType.THIRD_PARTY,
            `Generation failed: ${error}`,
            { details: { error, provider, model } }
        );
    }

    static switchInputMissing() {
        return new FiusRuntimeError(
            LLMErrorCode.SWITCH_INPUT_MISSING,
            ErrorScope.LLM,
            ErrorType.USER,
            'At least model or provider must be specified for LLM switch',
            {},
            'Provide either a model name, provider, or both'
        );
    }
}
