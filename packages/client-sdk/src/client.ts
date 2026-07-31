import { hc } from 'hono/client';
import type { AppType } from '@fius/server';
import type { ClientConfig } from './types.js';

/**
 * Create a type-safe Fius client using Hono's typed client
 *
 * @example
 * ```typescript
 * import { createFiusClient } from '@fius/client-sdk';
 *
 * const client = createFiusClient({
 *   baseUrl: 'http://localhost:3001',
 *   apiKey: 'optional-api-key'
 * });
 *
 * // Create a session
 * const session = await client.api.sessions.$post({
 *   json: { sessionId: 'my-session' }
 * });
 *
 * // Send a synchronous message
 * const response = await client.api['message-sync'].$post({
 *   json: { message: 'Hello!', sessionId: 'my-session' }
 * });
 * const { response: text } = await response.json();
 *
 * // Search messages
 * const searchResults = await client.api.search.messages.$get({
 *   query: { q: 'hello', limit: 10 }
 * });
 *
 * // Streaming responses with SSE
 * import { createMessageStream } from '@fius/client-sdk';
 *
 * const streamPromise = client.api['message-stream'].$post({
 *   json: { message: 'Tell me a story', sessionId: 'my-session' }
 * });
 *
 * // Parse SSE events using createMessageStream
 * const stream = createMessageStream(streamPromise);
 * for await (const event of stream) {
 *   if (event.name === 'llm:chunk') {
 *     process.stdout.write(event.content);
 *   }
 * }
 * ```
 */
export function createFiusClient(config: ClientConfig) {
    const options: { headers?: Record<string, string> } = {};

    if (config.apiKey) {
        options.headers = {
            Authorization: `Bearer ${config.apiKey}`,
        };
    }

    return hc<AppType>(config.baseUrl, options);
}

export * from './streaming.js';
