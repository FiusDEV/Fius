import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { InternalErrorResponse } from '../schemas/responses.js';
import type { GetAgentFn, OpenAPIRouteSchema } from '../types.js';
import { readFileSync, existsSync } from 'fs';
import { getFiusGlobalPath } from '@fiusdev/core';

const FiusAuthStatusResponseSchema = z
    .object({
        enabled: z.boolean().describe('Whether fius auth feature is enabled'),
        authenticated: z.boolean().describe('Whether user is authenticated with fius'),
        canUse: z.boolean().describe('Whether user can use fius (authenticated AND has API key)'),
        plan: z.string().optional().describe('User plan (free, pro, team)'),
        email: z.string().optional().describe('User email'),
    })
    .describe('Fius auth status response');

function readFiusApiKey(): string | null {
    try {
        const authPath = getFiusGlobalPath('', 'auth.json');
        if (!existsSync(authPath)) return null;
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
        return auth.fiusApiKey || null;
    } catch {
        return null;
    }
}

function readEmail(): string {
    try {
        const authPath = getFiusGlobalPath('', 'auth.json');
        if (!existsSync(authPath)) return '';
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
        return auth.email || '';
    } catch {
        return '';
    }
}

async function fetchPlan(): Promise<string> {
    try {
        const apiKey = readFiusApiKey();
        if (!apiKey) return 'free';
        const baseUrl = process.env.FIUS_PLATFORM_URL || process.env.FIUS_API_URL || 'https://fius.dev';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(`${baseUrl}/api/cli/user`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok) return 'free';
        const data = await resp.json();
        return data.plan || 'free';
    } catch {
        return 'free';
    }
}

const statusRoute = createRoute({
    method: 'get',
    path: '/fius-auth/status',
    summary: 'Fius Auth Status',
    description:
        'Returns fius authentication status. Used by Web UI to check if user can use fius features.',
    tags: ['auth'],
    responses: {
        200: {
            description: 'Fius auth status',
            content: {
                'application/json': {
                    schema: FiusAuthStatusResponseSchema,
                },
            },
        },
        500: InternalErrorResponse,
    },
});

export function createFiusAuthRouter(_getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    return app.openapi(statusRoute, async (c) => {
        const email = readEmail();
        const plan = await fetchPlan();
        return c.json(
            {
                enabled: true,
                authenticated: true,
                canUse: true,
                plan,
                email,
            },
            200
        );
    });
}

type StatusRouteSchema = OpenAPIRouteSchema<typeof statusRoute, {}>;

export type FiusAuthRouterSchema = StatusRouteSchema;
