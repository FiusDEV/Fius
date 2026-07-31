import { Hono } from 'hono';
import type { FiusAgent } from '@fius/core';
import { JsonRpcServer } from '../../a2a/jsonrpc/server.js';
import { A2AMethodHandlers } from '../../a2a/jsonrpc/methods.js';
import { logger } from '@fius/core';
import type { A2ASseEventSubscriber } from '../../events/a2a-sse-subscriber.js';
import { a2aToInternalMessage } from '../../a2a/adapters/message.js';
import type { Context } from 'hono';
type GetAgentFn = (ctx: Context) => FiusAgent | Promise<FiusAgent>;

export function createA2AJsonRpcRouter(getAgent: GetAgentFn, sseSubscriber: A2ASseEventSubscriber) {
    const app = new Hono();

    app.post('/jsonrpc', async (ctx) => {
        try {
            const agent = await getAgent(ctx);
            const requestBody = await ctx.req.json();

            const isStreamingRequest =
                !Array.isArray(requestBody) && requestBody.method === 'message/stream';

            if (isStreamingRequest) {
                logger.info('JSON-RPC streaming request: message/stream');

                const params = requestBody.params;
                if (!params?.message) {
                    return ctx.json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32602,
                            message: 'Invalid params: message is required',
                        },
                        id: requestBody.id,
                    });
                }

                const taskId = params.message.taskId;
                const session = await agent.createSession(taskId);

                const stream = sseSubscriber.createStream(session.id);

                const { text, image, file } = a2aToInternalMessage(params.message);
                agent.run(text, image, file, session.id).catch((error) => {
                    logger.error(`Error in streaming task ${session.id}: ${error}`);
                });

                logger.info(`JSON-RPC SSE stream opened for task ${session.id}`);

                return new Response(stream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                        'X-Accel-Buffering': 'no',
                    },
                });
            }

            const handlers = new A2AMethodHandlers(agent);
            const rpcServer = new JsonRpcServer({
                methods: handlers.getMethods(),
                onError: (error, request) => {
                    logger.error(`JSON-RPC error for method ${request?.method}: ${error.message}`, {
                        error,
                        request,
                    });
                },
            });

            logger.debug(`A2A JSON-RPC request received`, {
                method: Array.isArray(requestBody)
                    ? `batch(${requestBody.length})`
                    : requestBody.method,
            });

            const response = await rpcServer.handle(requestBody);
            return ctx.json(response);
        } catch (error) {
            logger.error(`Failed to process JSON-RPC request: ${error}`, { error });

            return ctx.json({
                jsonrpc: '2.0',
                error: {
                    code: -32700,
                    message: 'Parse error',
                    data: error instanceof Error ? error.message : String(error),
                },
                id: null,
            });
        }
    });

    app.get('/jsonrpc', async (ctx) => {
        const agent = await getAgent(ctx);
        const handlers = new A2AMethodHandlers(agent);

        return ctx.json({
            service: 'A2A JSON-RPC 2.0',
            version: '0.3.0',
            endpoint: '/jsonrpc',
            methods: Object.keys(handlers.getMethods()),
            usage: {
                method: 'POST',
                contentType: 'application/json',
                example: {
                    jsonrpc: '2.0',
                    method: 'agent.getInfo',
                    params: {},
                    id: 1,
                },
            },
        });
    });

    return app;
}
