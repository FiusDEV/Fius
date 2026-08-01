import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { BadRequestErrorResponse, InternalErrorResponse } from '../schemas/responses.js';
import {
    getProviderKeyStatus,
    saveProviderApiKey,
    resolveApiKeyForProvider,
} from '@fiusdev/agent-management';
import type { OpenAPIRouteSchema } from '../types.js';

function maskApiKey(key: string): string {
    if (!key) return '';
    if (key.length < 12) {
        return key.slice(0, 4) + '...' + key.slice(-4);
    }
    return key.slice(0, 7) + '...' + key.slice(-4);
}

const GetKeyParamsSchema = z
    .object({
        provider: z.string().min(1).describe('LLM provider identifier'),
    })
    .describe('Path parameters for API key operations');

const SaveKeySchema = z
    .object({
        provider: z
            .string()
            .min(1)
            .describe('LLM provider identifier (e.g., openai, anthropic)'),
        apiKey: z
            .string()
            .min(1, 'API key is required')
            .describe('API key for the provider (writeOnly - never returned in responses)')
            .openapi({ writeOnly: true }),
    })
    .describe('Request body for saving a provider API key');

const GetKeyResponseSchema = z
    .object({
        provider: z.string().describe('Provider identifier'),
        envVar: z.string().describe('Environment variable name'),
        hasKey: z.boolean().describe('Whether API key is configured'),
        keyValue: z
            .string()
            .optional()
            .describe('Masked API key value if configured (e.g., sk-proj...xyz4)'),
    })
    .strict()
    .describe('API key status response');

const SaveKeyResponseSchema = z
    .object({
        ok: z.literal(true).describe('Operation success indicator'),
        provider: z.string().describe('Provider for which the key was saved'),
        envVar: z.string().describe('Environment variable name where key was stored'),
    })
    .strict()
    .describe('API key save response');

const getKeyRoute = createRoute({
    method: 'get',
    path: '/llm/key/{provider}',
    summary: 'Get Provider API Key Status',
    description:
        'Retrieves the API key status for a provider. Returns a masked key value (e.g., sk-proj...xyz4) for UI display purposes.',
    tags: ['llm'],
    request: { params: GetKeyParamsSchema },
    responses: {
        200: {
            description: 'API key status and value',
            content: {
                'application/json': {
                    schema: GetKeyResponseSchema,
                },
            },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const saveKeyRoute = createRoute({
    method: 'post',
    path: '/llm/key',
    summary: 'Save Provider API Key',
    description: 'Stores an API key for a provider in .env and makes it available immediately',
    tags: ['llm'],
    request: { body: { content: { 'application/json': { schema: SaveKeySchema } } } },
    responses: {
        200: {
            description: 'API key saved',
            content: {
                'application/json': {
                    schema: SaveKeyResponseSchema,
                },
            },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

export function createKeyRouter() {
    const app = new OpenAPIHono();

    return app
        .openapi(getKeyRoute, (ctx) => {
            const { provider } = ctx.req.valid('param');
            const keyStatus = getProviderKeyStatus(provider);
            const apiKey = resolveApiKeyForProvider(provider);
            const maskedKey = apiKey ? maskApiKey(apiKey) : undefined;

            return ctx.json(
                {
                    provider,
                    envVar: keyStatus.envVar,
                    hasKey: keyStatus.hasApiKey,
                    ...(maskedKey && { keyValue: maskedKey }),
                },
                200
            );
        })
        .openapi(saveKeyRoute, async (ctx) => {
            const { provider, apiKey } = ctx.req.valid('json');
            const meta = await saveProviderApiKey(provider, apiKey);
            return ctx.json({ ok: true as const, provider, envVar: meta.envVar }, 200);
        });
}

type GetKeyRouteSchema = OpenAPIRouteSchema<
    typeof getKeyRoute,
    { param: z.input<typeof GetKeyParamsSchema> }
>;
type SaveKeyRouteSchema = OpenAPIRouteSchema<
    typeof saveKeyRoute,
    { json: z.input<typeof SaveKeySchema> }
>;

export type KeyRouterSchema = GetKeyRouteSchema | SaveKeyRouteSchema;
