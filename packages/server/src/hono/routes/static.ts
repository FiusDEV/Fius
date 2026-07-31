import { Hono } from 'hono';
import type { NotFoundHandler } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface WebUIRuntimeConfig {
    analytics?: {
        distinctId: string;
        posthogKey: string;
        posthogHost: string;
        appVersion: string;
    } | null;
}

export function createStaticRouter(webRoot: string) {
    const app = new Hono();

    app.use('/assets/*', serveStatic({ root: webRoot }));

    app.use('/logos/*', serveStatic({ root: webRoot }));

    app.use('/favicon.ico', serveStatic({ root: webRoot }));
    app.use('/favicon.png', serveStatic({ root: webRoot }));

    return app;
}

function buildInjectionScript(config: WebUIRuntimeConfig): string {
    const scripts: string[] = [];

    if (config.analytics) {
        const safeJson = JSON.stringify(config.analytics).replace(/</g, '\\u003c');
        scripts.push(`window.__FIUS_ANALYTICS__ = ${safeJson};`);
    }

    if (scripts.length === 0) return '';
    return `<script>${scripts.join('\n')}</script>`;
}

export function createSpaFallbackHandler(
    webRoot: string,
    runtimeConfig?: WebUIRuntimeConfig,
    apiPrefix = '/api'
): NotFoundHandler {
    const injectionScript = runtimeConfig ? buildInjectionScript(runtimeConfig) : '';

    return async (c) => {
        const path = c.req.path;
        const normalizedApiPrefix = apiPrefix === '' ? '/' : apiPrefix.replace(/\/+$/, '') || '/';
        const isApiRoute =
            normalizedApiPrefix === '/'
                ? true
                : path === normalizedApiPrefix || path.startsWith(`${normalizedApiPrefix}/`);

        if (isApiRoute) {
            return c.json({ error: 'Not Found', path }, 404);
        }

        if (/\.[a-zA-Z0-9]+$/.test(path)) {
            return c.json({ error: 'Not Found', path }, 404);
        }

        try {
            let html = await readFile(join(webRoot, 'index.html'), 'utf-8');

            if (injectionScript) {
                html = html.replace('</head>', `${injectionScript}</head>`);
            }

            return c.html(html);
        } catch {
            return c.html(
                `<!DOCTYPE html>
<html>
<head><title>Fius API Server</title></head>
<body>
<h1>Fius API Server</h1>
<p>WebUI is not available. API endpoints are accessible at <code>/api/*</code></p>
</body>
</html>`,
                200
            );
        }
    };
}
