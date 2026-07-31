import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { GetAgentFn } from '../types.js';

export function createHealthRouter(_getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const route = createRoute({
        method: 'get',
        path: '/',
        summary: 'Health Check',
        description: 'Returns server health status',
        tags: ['system'],
        responses: {
            200: {
                description: 'Server health',
                content: { 'text/plain': { schema: z.string().openapi({ example: 'OK' }) } },
            },
        },
    });
    return app.openapi(route, (c) => c.text('OK'));
}
