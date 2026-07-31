import { createFiusClient } from '@fius/client-sdk';
import { getApiUrl } from './api-url';

/**
 * Centralized typed API client for the Web UI.
 * Uses the Hono typed client from @fius/client-sdk.
 */
export const client: ReturnType<typeof createFiusClient> = createFiusClient({
    baseUrl: getApiUrl(),
});
