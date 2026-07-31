/**
 * Get the API URL for making requests.
 *
 * In production: WebUI is served from the same Hono server as the API (same-origin).
 * In development: Vite proxies /api/* requests to the API server (still same-origin from browser perspective).
 */
export function getApiUrl(): string {
    if (typeof window === 'undefined') {
        return 'http://localhost:3001';
    }

    const { protocol, hostname, port } = window.location;
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
}
