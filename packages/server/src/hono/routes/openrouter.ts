import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { BadRequestErrorResponse, InternalErrorResponse } from '../schemas/responses.js';
import type { OpenAPIRouteSchema } from '../types.js';

const ValidateModelParamsSchema = z
    .object({
        modelId: z
            .string()
            .min(1)
            .describe('OpenRouter model ID to validate (e.g., anthropic/claude-3.5-sonnet)'),
    })
    .describe('Path parameters for model validation');

const ValidateModelResponseSchema = z
    .object({
        valid: z.boolean().describe('Whether the model ID is valid'),
        modelId: z.string().describe('The model ID that was validated'),
        status: z
            .enum(['valid', 'invalid', 'unknown'])
            .describe('Validation status: valid, invalid, or unknown (cache empty)'),
        error: z.string().optional().describe('Error message if invalid'),
        info: z
            .object({
                contextLength: z.number().describe('Model context length in tokens'),
            })
            .optional()
            .describe('Model information if valid'),
    })
    .describe('Model validation response');

const RefreshSuccessResponseSchema = z
    .object({
        ok: z.literal(true).describe('Success indicator'),
        message: z.string().describe('Status message'),
    })
    .describe('OpenRouter cache refresh success response');

const validateRoute = createRoute({
    method: 'get',
    path: '/openrouter/validate/{modelId}',
    summary: 'Validate OpenRouter Model',
    description: 'Validates an OpenRouter model ID. Returns unknown since OpenRouter registry is disabled.',
    tags: ['openrouter'],
    request: {
        params: ValidateModelParamsSchema,
    },
    responses: {
        200: {
            description: 'Validation result',
            content: {
                'application/json': {
                    schema: ValidateModelResponseSchema,
                },
            },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const refreshRoute = createRoute({
    method: 'post',
    path: '/openrouter/refresh-cache',
    summary: 'Refresh OpenRouter Model Cache',
    description: 'No-op since OpenRouter registry is disabled in Fius.',
    tags: ['openrouter'],
    responses: {
        200: {
            description: 'Cache refreshed successfully',
            content: {
                'application/json': {
                    schema: RefreshSuccessResponseSchema,
                },
            },
        },
    },
});

export function createOpenRouterRouter() {
    const app = new OpenAPIHono();

    return app
        .openapi(validateRoute, async (ctx) => {
            const { modelId: encodedModelId } = ctx.req.valid('param');
            const modelId = decodeURIComponent(encodedModelId);

            return ctx.json(
                {
                    valid: false,
                    modelId,
                    status: 'unknown' as const,
                    error: 'OpenRouter model registry is disabled in Fius. Use models.dev to validate models.',
                },
                200
            );
        })
        .openapi(refreshRoute, async (ctx) => {
            return ctx.json(
                {
                    ok: true as const,
                    message: 'OpenRouter model registry is disabled in Fius. No cache to refresh.',
                },
                200
            );
        });
}

type ValidateRouteSchema = OpenAPIRouteSchema<
    typeof validateRoute,
    { param: z.input<typeof ValidateModelParamsSchema> }
>;
type RefreshRouteSchema = OpenAPIRouteSchema<typeof refreshRoute, {}>;

export type OpenRouterRouterSchema = ValidateRouteSchema | RefreshRouteSchema;
