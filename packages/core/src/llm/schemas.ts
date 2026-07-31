import { LLMErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { FiusRuntimeError } from '../errors/index.js';
import { NonEmptyTrimmed, EnvExpandedString, OptionalURL } from '../utils/result.js';
import { z } from 'zod';
import {
    supportsBaseURL,
    acceptsAnyModel,
    supportsCustomModels,
    hasAllRegistryModelsSupport,
    getSupportedModels,
    getReasoningProfile,
    isValidProviderModel,
    supportsReasoningVariant,
} from '@fius/llm';
import { getMaxInputTokensForModel } from './registry/index.js';
import { LLM_PROVIDERS } from '@fius/llm';

const LLMConfigFields = {
    provider: z
        .string()
        .min(1)
        .describe("LLM provider (e.g., 'openai', 'anthropic', 'google', 'groq')"),

    model: z.string().trim().optional().default('').describe('Specific model name for the selected provider'),

    apiKey: EnvExpandedString()
        .optional()
        .describe('API key for provider; can be given directly or via $ENV reference'),

    maxIterations: z.coerce.number().int().positive().describe('Max iterations for agentic loops'),

    baseURL: OptionalURL.describe(
        'Base URL for provider (e.g., https://api.openai.com/v1). Only certain providers support this.'
    ),

    maxInputTokens: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max input tokens for history; required for unknown models'),

    maxOutputTokens: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max tokens for model output'),

    temperature: z.coerce
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Randomness: 0 deterministic, 1 creative'),

    allowedMediaTypes: z
        .array(z.string())
        .optional()
        .describe(
            'MIME type patterns for media expansion (e.g., "image/*", "application/pdf"). ' +
                'If omitted, uses model capabilities from registry. Supports wildcards.'
        ),

    reasoning: z
        .object({
            variant: NonEmptyTrimmed.describe(
                'Model/provider-native reasoning variant (resolved by reasoning profile for the selected model).'
            ),
            budgetTokens: z.coerce
                .number()
                .int()
                .positive()
                .optional()
                .describe(
                    'Advanced escape hatch for budget-based providers (e.g., Anthropic/Gemini/Bedrock/OpenRouter).'
                ),
        })
        .strict()
        .optional()
        .describe(
            'Reasoning configuration using model/provider-native variants (tuning only; display is controlled separately).'
        ),
} as const;

export const LLMConfigBaseSchema = z
    .object({
        provider: LLMConfigFields.provider,
        model: LLMConfigFields.model,
        apiKey: LLMConfigFields.apiKey,
        maxIterations: LLMConfigFields.maxIterations
            .optional()
            .describe('Max outer-loop tool-call iterations per agent turn'),
        baseURL: LLMConfigFields.baseURL,
        maxInputTokens: LLMConfigFields.maxInputTokens,
        maxOutputTokens: LLMConfigFields.maxOutputTokens,
        temperature: LLMConfigFields.temperature,
        allowedMediaTypes: LLMConfigFields.allowedMediaTypes,
        reasoning: LLMConfigFields.reasoning,
    })
    .strict();

export const LLMConfigSchema = LLMConfigBaseSchema.superRefine((data, ctx) => {
    const baseURLIsSet = data.baseURL != null && data.baseURL.trim() !== '';
    const maxInputTokensIsSet = data.maxInputTokens != null;

    if (!data.model) {
        return;
    }

    if (hasAllRegistryModelsSupport(data.provider) && !data.model.includes('/')) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['model'],
            message:
                `Provider '${data.provider}' requires OpenRouter-format model IDs (e.g. ` +
                `'openai/gpt-5-mini' or 'anthropic/claude-sonnet-4.5'). You provided '${data.model}'.`,
            params: {
                code: LLMErrorCode.MODEL_INCOMPATIBLE,
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
            },
        });
    }

    if (baseURLIsSet) {
        if (!supportsBaseURL(data.provider)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['provider'],
                message:
                    `Provider '${data.provider}' does not support baseURL.`,
                params: {
                    code: LLMErrorCode.BASE_URL_INVALID,
                    scope: ErrorScope.LLM,
                    type: ErrorType.USER,
                },
            });
        }
    }

    if (!baseURLIsSet || supportsBaseURL(data.provider)) {
        if (!acceptsAnyModel(data.provider) && !supportsCustomModels(data.provider)) {
            const supportedModelsList = getSupportedModels(data.provider);
            if (!isValidProviderModel(data.provider, data.model)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['model'],
                    message:
                        `Model '${data.model}' is not supported for provider '${data.provider}'. ` +
                        `Supported: ${supportedModelsList.join(', ')}`,
                    params: {
                        code: LLMErrorCode.MODEL_INCOMPATIBLE,
                        scope: ErrorScope.LLM,
                        type: ErrorType.USER,
                    },
                });
            }
        }

        if (
            maxInputTokensIsSet &&
            !acceptsAnyModel(data.provider) &&
            !supportsCustomModels(data.provider)
        ) {
            try {
                const cap = getMaxInputTokensForModel(data.provider, data.model);
                if (data.maxInputTokens! > cap) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['maxInputTokens'],
                        message:
                            `Max input tokens for model '${data.model}' is ${cap}. ` +
                            `You provided ${data.maxInputTokens}`,
                        params: {
                            code: LLMErrorCode.TOKENS_EXCEEDED,
                            scope: ErrorScope.LLM,
                            type: ErrorType.USER,
                        },
                    });
                }
            } catch (error: unknown) {
                if (
                    error instanceof FiusRuntimeError &&
                    error.code === LLMErrorCode.MODEL_UNKNOWN
                ) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['model'],
                        message: error.message,
                        params: {
                            code: error.code,
                            scope: error.scope,
                            type: error.type,
                        },
                    });
                } else {
                    const message =
                        error instanceof Error ? error.message : 'Unknown error occurred';
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['model'],
                        message,
                        params: {
                            code: LLMErrorCode.REQUEST_INVALID_SCHEMA,
                            scope: ErrorScope.LLM,
                            type: ErrorType.SYSTEM,
                        },
                    });
                }
            }
        }
    }

    if (data.reasoning) {
        const profile = getReasoningProfile(data.provider, data.model);
        const variant = data.reasoning.variant;
        const budgetTokens = data.reasoning.budgetTokens;

        if (!supportsReasoningVariant(profile, variant)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['reasoning', 'variant'],
                message:
                    `Reasoning variant '${variant}' is not supported for provider '${data.provider}' ` +
                    `model '${data.model}'. Supported: ${profile.variants.map((entry) => entry.id).join(', ')}`,
                params: {
                    code: LLMErrorCode.MODEL_INCOMPATIBLE,
                    scope: ErrorScope.LLM,
                    type: ErrorType.USER,
                },
            });
        }

        if (typeof budgetTokens === 'number' && !profile.supportsBudgetTokens) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['reasoning', 'budgetTokens'],
                message:
                    `Reasoning budgetTokens are not supported for provider '${data.provider}' ` +
                    `model '${data.model}'. Remove reasoning.budgetTokens to use provider defaults.`,
                params: {
                    code: LLMErrorCode.MODEL_INCOMPATIBLE,
                    scope: ErrorScope.LLM,
                    type: ErrorType.USER,
                },
            });
        }
    }
});

export type LLMConfig = z.input<typeof LLMConfigSchema>;
export type ValidatedLLMConfig = z.output<typeof LLMConfigSchema>;

export const LLMUpdatesSchema = z
    .object({
        ...LLMConfigFields,
        reasoning: LLMConfigFields.reasoning.nullable(),
    })
    .partial()
    .superRefine((data, ctx) => {
        if (!data.model && !data.provider) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'At least model or provider must be specified for LLM switch',
                path: [],
            });
        }

        if (
            data.reasoning &&
            data.reasoning !== null &&
            typeof data.provider === 'string' &&
            typeof data.model === 'string'
        ) {
            const profile = getReasoningProfile(data.provider, data.model);
            const variant = data.reasoning.variant;
            const budgetTokens = data.reasoning.budgetTokens;

            if (!supportsReasoningVariant(profile, variant)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['reasoning', 'variant'],
                    message:
                        `Reasoning variant '${variant}' is not supported for provider '${data.provider}' ` +
                        `model '${data.model}'. Supported: ${profile.variants.map((entry) => entry.id).join(', ')}`,
                    params: {
                        code: LLMErrorCode.MODEL_INCOMPATIBLE,
                        scope: ErrorScope.LLM,
                        type: ErrorType.USER,
                    },
                });
            }

            if (typeof budgetTokens === 'number' && !profile.supportsBudgetTokens) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['reasoning', 'budgetTokens'],
                    message:
                        `Reasoning budgetTokens are not supported for provider '${data.provider}' ` +
                        `model '${data.model}'. Remove reasoning.budgetTokens to use provider defaults.`,
                    params: {
                        code: LLMErrorCode.MODEL_INCOMPATIBLE,
                        scope: ErrorScope.LLM,
                        type: ErrorType.USER,
                    },
                });
            }
        }
    });
export type LLMUpdates = z.input<typeof LLMUpdatesSchema>;
export type { LLMUpdateContext } from '@fius/llm';
