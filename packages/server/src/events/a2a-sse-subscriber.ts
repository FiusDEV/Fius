import { setMaxListeners } from 'events';
import { AgentEventBus } from '@fius/core';
import { logger } from '@fius/core';

interface SSEConnection {
    taskId: string;
    controller: ReadableStreamDefaultController;
    abortController: AbortController;
    connectedAt: number;
}

export class A2ASseEventSubscriber {
    private connections: Map<string, SSEConnection> = new Map();
    private eventBus?: AgentEventBus;
    private globalAbortController?: AbortController;

    subscribe(eventBus: AgentEventBus): void {
        this.globalAbortController?.abort();

        this.globalAbortController = new AbortController();
        const { signal } = this.globalAbortController;

        const MAX_SHARED_SIGNAL_LISTENERS = 20;
        setMaxListeners(MAX_SHARED_SIGNAL_LISTENERS, signal);

        this.eventBus = eventBus;

        eventBus.on(
            'llm:thinking',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.thinking', {
                    taskId: payload.sessionId,
                });
            },
            { signal }
        );

        eventBus.on(
            'llm:chunk',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.chunk', {
                    taskId: payload.sessionId,
                    type: payload.chunkType,
                    content: payload.content,
                    isComplete: payload.isComplete,
                });
            },
            { signal }
        );

        eventBus.on(
            'llm:tool-call',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.toolCall', {
                    taskId: payload.sessionId,
                    toolName: payload.toolName,
                    args: payload.args,
                    callId: payload.callId,
                });
            },
            { signal }
        );

        eventBus.on(
            'llm:tool-result',
            (payload) => {
                const data: Record<string, unknown> = {
                    taskId: payload.sessionId,
                    toolName: payload.toolName,
                    callId: payload.callId,
                    success: payload.success,
                    sanitized: payload.sanitized,
                };
                if (payload.rawResult !== undefined) {
                    data.rawResult = payload.rawResult;
                }
                this.broadcastToTask(payload.sessionId, 'task.toolResult', data);
            },
            { signal }
        );

        eventBus.on(
            'llm:response',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.message', {
                    taskId: payload.sessionId,
                    message: {
                        role: 'agent',
                        content: [{ type: 'text', text: payload.content }],
                        timestamp: new Date().toISOString(),
                        ...(payload.messageId && { messageId: payload.messageId }),
                    },
                    tokenUsage: payload.tokenUsage,
                    provider: payload.provider,
                    model: payload.model,
                    ...(payload.messageId && { messageId: payload.messageId }),
                    ...(payload.usageScopeId && { usageScopeId: payload.usageScopeId }),
                    ...(payload.estimatedCost !== undefined && {
                        estimatedCost: payload.estimatedCost,
                    }),
                    ...(payload.costBreakdown && {
                        costBreakdown: payload.costBreakdown,
                    }),
                    ...(payload.pricingStatus && { pricingStatus: payload.pricingStatus }),
                });
            },
            { signal }
        );

        eventBus.on(
            'interaction:blocked',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.message', {
                    taskId: payload.sessionId,
                    message: {
                        role: 'agent',
                        content: [{ type: 'text', text: payload.content }],
                        timestamp: new Date().toISOString(),
                        messageId: payload.messageId,
                    },
                    provider: payload.provider,
                    model: payload.model,
                    messageId: payload.messageId,
                });
            },
            { signal }
        );

        eventBus.on(
            'llm:error',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.error', {
                    taskId: payload.sessionId,
                    error: {
                        message: payload.error.message,
                        recoverable: payload.recoverable,
                    },
                });
            },
            { signal }
        );

        eventBus.on(
            'session:reset',
            (payload) => {
                this.broadcastToTask(payload.sessionId, 'task.reset', {
                    taskId: payload.sessionId,
                });
            },
            { signal }
        );

        logger.debug('A2ASseEventSubscriber subscribed to agent events');
    }

    createStream(taskId: string): ReadableStream<Uint8Array> {
        const connectionId = `${taskId}-${Date.now()}`;

        return new ReadableStream({
            start: (controller) => {
                const connection: SSEConnection = {
                    taskId,
                    controller,
                    abortController: new AbortController(),
                    connectedAt: Date.now(),
                };

                this.connections.set(connectionId, connection);
                logger.debug(`SSE connection opened for task ${taskId}`);

                this.sendSSEEvent(controller, 'connected', {
                    taskId,
                    timestamp: new Date().toISOString(),
                });

                const keepaliveInterval = setInterval(() => {
                    try {
                        this.sendSSEComment(controller, 'keepalive');
                    } catch (_error) {
                        clearInterval(keepaliveInterval);
                    }
                }, 30000);

                connection.abortController.signal.addEventListener('abort', () => {
                    clearInterval(keepaliveInterval);
                });
            },

            cancel: () => {
                const connection = this.connections.get(connectionId);
                if (connection) {
                    connection.abortController.abort();
                    this.connections.delete(connectionId);
                    logger.debug(`SSE connection closed for task ${taskId}`);
                }
            },
        });
    }

    private broadcastToTask(
        taskId: string,
        eventName: string,
        data: Record<string, unknown>
    ): void {
        let sent = 0;
        for (const [connectionId, connection] of this.connections.entries()) {
            if (connection.taskId === taskId) {
                try {
                    this.sendSSEEvent(connection.controller, eventName, data);
                    sent++;
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logger.warn(`Failed to send SSE event to ${connectionId}: ${errorMessage}`);
                    connection.abortController.abort();
                    this.connections.delete(connectionId);
                }
            }
        }

        if (sent > 0) {
            logger.debug(`Broadcast ${eventName} to ${sent} SSE connection(s) for task ${taskId}`);
        }
    }

    private sendSSEEvent(
        controller: ReadableStreamDefaultController,
        eventName: string,
        data: Record<string, unknown>
    ): void {
        const event = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(event));
    }

    private sendSSEComment(controller: ReadableStreamDefaultController, comment: string): void {
        const line = `: ${comment}\n`;
        controller.enqueue(new TextEncoder().encode(line));
    }

    cleanup(): void {
        logger.debug(`Cleaning up ${this.connections.size} SSE connections`);

        for (const [_connectionId, connection] of this.connections.entries()) {
            connection.abortController.abort();
            try {
                connection.controller.close();
            } catch (_error) {
            }
        }

        this.connections.clear();
        this.globalAbortController?.abort();
    }

    getConnectionCount(): number {
        return this.connections.size;
    }

    getTaskConnectionCount(taskId: string): number {
        let count = 0;
        for (const connection of this.connections.values()) {
            if (connection.taskId === taskId) {
                count++;
            }
        }
        return count;
    }
}
