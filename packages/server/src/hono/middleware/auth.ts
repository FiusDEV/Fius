import type { MiddlewareHandler } from 'hono';
import { logger } from '@fius/core';

const PUBLIC_ROUTES = ['/health', '/.well-known/agent-card.json', '/openapi.json'];

export function createAuthMiddleware(): MiddlewareHandler {
    const apiKey = process.env.FIUS_SERVER_API_KEY;
    const isProduction = process.env.NODE_ENV === 'production';
    const requireAuth = process.env.FIUS_SERVER_REQUIRE_AUTH === 'true';

    if (isProduction && !apiKey) {
        logger.warn(
            `⚠️  SECURITY WARNING: Running in production mode (NODE_ENV=production) without FIUS_SERVER_API_KEY. Fius Server API is UNPROTECTED. Set FIUS_SERVER_API_KEY environment variable to secure your API.`
        );
    }

    return async (ctx, next) => {
        const path = ctx.req.path;

        if (PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route))) {
            return next();
        }

        if (!isProduction && !requireAuth) {
            return next();
        }

        if (!apiKey) {
            return ctx.json(
                {
                    error: 'Configuration Error',
                    message: requireAuth
                        ? 'FIUS_SERVER_REQUIRE_AUTH=true but FIUS_SERVER_API_KEY not set. Set FIUS_SERVER_API_KEY environment variable.'
                        : 'NODE_ENV=production requires FIUS_SERVER_API_KEY. Set FIUS_SERVER_API_KEY environment variable to secure your API.',
                },
                500
            );
        }

        const authHeader = ctx.req.header('Authorization');
        const providedKey = authHeader?.replace(/^Bearer\s+/i, '');

        if (!providedKey || providedKey !== apiKey) {
            logger.warn('Unauthorized API access attempt', {
                path,
                hasKey: !!providedKey,
                origin: ctx.req.header('origin'),
                userAgent: ctx.req.header('user-agent'),
            });

            return ctx.json(
                {
                    error: 'Unauthorized',
                    message:
                        'Invalid or missing API key. Provide Authorization: Bearer <api-key> header.',
                },
                401
            );
        }

        await next();
    };
}
