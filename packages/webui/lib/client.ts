import { createFiusClient } from '@fiusdev/client-sdk';
import { getApiUrl } from './api-url';

/**
 * Centralized typed API client for the Web UI.
 * Uses the Hono typed client from @fiusdev/client-sdk.
 */
export const client: ReturnType<typeof createFiusClient> = createFiusClient({
    baseUrl: getApiUrl(),
});
