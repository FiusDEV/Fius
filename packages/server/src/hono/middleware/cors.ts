import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';

export function createCorsMiddleware(): MiddlewareHandler {
    return cors({
        origin: (origin) => {
            if (!origin) {
                return null;
            }

            try {
                const originUrl = new URL(origin);
                const hostname = originUrl.hostname;

                if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
                    return origin;
                }

                const customOrigins = process.env.FIUS_ALLOWED_ORIGINS;
                if (customOrigins) {
                    const allowedList = customOrigins.split(',').map((o) => o.trim());
                    if (allowedList.includes(origin)) {
                        return origin;
                    }
                }

                return null;
            } catch {
                return null;
            }
        },
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
        allowHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
    });
}
