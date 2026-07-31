/**
 * Fius Client SDK
 * Lightweight type-safe client for Fius API built on Hono's typed client
 */

export { createFiusClient } from './client.js';
export { parseResponse } from 'hono/client';
export type { ClientResponse, InferResponseType } from 'hono/client';

export { stream, createStream, createMessageStream, SSEError } from './streaming.js';
export type { SSEEvent, MessageStreamEvent } from './streaming.js';

export type { ClientConfig } from './types.js';

export type { AppType } from '@fius/server';
