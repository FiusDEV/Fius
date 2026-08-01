import crypto from 'crypto';
import { setMaxListeners } from 'events';
import {
    AgentEventBus,
    INTEGRATION_EVENTS,
    type AgentEventMap,
    type AgentEventName,
} from '@fiusdev/core';
import { logger } from '@fiusdev/core';
import { EventSubscriber } from './types.js';
import {
    type WebhookConfig,
    type FiusWebhookEvent,
    type WebhookDeliveryResult,
    type WebhookDeliveryOptions,
} from './webhook-types.js';

const DEFAULT_DELIVERY_OPTIONS: Required<WebhookDeliveryOptions> = {
    maxRetries: 3,
    timeout: 10000,
    includeSignature: true,
};

export class WebhookEventSubscriber implements EventSubscriber {
    private webhooks: Map<string, WebhookConfig> = new Map();
    private abortController?: AbortController;
    private deliveryOptions: Required<WebhookDeliveryOptions>;
    private fetchFn: typeof globalThis.fetch;

    constructor({
        fetchFn,
        ...deliveryOptions
    }: WebhookDeliveryOptions & { fetchFn?: typeof globalThis.fetch } = {}) {
        this.deliveryOptions = { ...DEFAULT_DELIVERY_OPTIONS, ...deliveryOptions };
        this.fetchFn = fetchFn || fetch;
        logger.debug('WebhookEventSubscriber initialized');
    }

    subscribe(eventBus: AgentEventBus): void {
        this.abortController?.abort();

        this.abortController = new AbortController();
        const { signal } = this.abortController;

        const MAX_SHARED_SIGNAL_LISTENERS = 50;
        setMaxListeners(MAX_SHARED_SIGNAL_LISTENERS, signal);

        INTEGRATION_EVENTS.forEach((eventName) => {
            eventBus.on(
                eventName,
                (payload) => {
                    this.deliverEvent(eventName, payload);
                },
                { signal }
            );
        });

        logger.debug(`Webhook subscriber active with ${this.webhooks.size} registered webhooks`);
    }

    addWebhook(webhook: WebhookConfig): void {
        this.webhooks.set(webhook.id, webhook);
        logger.debug(`Webhook registered: ${webhook.id} -> ${webhook.url}`);
    }

    removeWebhook(webhookId: string): boolean {
        const removed = this.webhooks.delete(webhookId);
        if (removed) {
            logger.debug(`Webhook removed: ${webhookId}`);
        } else {
            logger.warn(`Attempted to remove non-existent webhook: ${webhookId}`);
        }
        return removed;
    }

    getWebhooks(): WebhookConfig[] {
        return Array.from(this.webhooks.values());
    }

    getWebhook(webhookId: string): WebhookConfig | undefined {
        return this.webhooks.get(webhookId);
    }

    async testWebhook(webhookId: string): Promise<WebhookDeliveryResult> {
        const webhook = this.webhooks.get(webhookId);
        if (!webhook) {
            throw new Error(`Webhook not found: ${webhookId}`);
        }

        const testEvent: FiusWebhookEvent<'tools:available-updated'> = {
            id: `evt_test_${Date.now()}`,
            type: 'tools:available-updated',
            data: {
                tools: ['test-tool'],
                source: 'mcp',
            },
            created: new Date().toISOString(),
            apiVersion: '2025-07-03',
        };

        return this.deliverToWebhook(webhook, testEvent);
    }

    cleanup(): void {
        if (this.abortController) {
            this.abortController.abort();
            delete (this as any).abortController;
        }

        this.webhooks.clear();
        logger.debug('Webhook event subscriber cleaned up');
    }

    unsubscribe(): void {
        if (this.abortController) {
            const controller = this.abortController;
            delete this.abortController;
            try {
                controller.abort();
            } catch (error) {
                logger.debug(
                    `Error aborting controller during unsubscribe: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    {
                        location: 'WebhookEventSubscriber.unsubscribe',
                        ...(error instanceof Error
                            ? { stack: error.stack }
                            : { value: String(error) }),
                    }
                );
            }
        }
    }

    private async deliverEvent<T extends AgentEventName>(
        eventType: T,
        eventData: AgentEventMap[T]
    ): Promise<void> {
        if (this.webhooks.size === 0) {
            return;
        }

        const webhookEvent: FiusWebhookEvent<T> = {
            id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            type: eventType,
            data: eventData,
            created: new Date().toISOString(),
            apiVersion: '2025-07-03',
        };

        logger.debug(`Delivering webhook event: ${eventType} to ${this.webhooks.size} webhooks`);

        const deliveryPromises = Array.from(this.webhooks.values()).map((webhook) => ({
            webhook,
            promise: this.deliverToWebhook(webhook, webhookEvent),
        }));

        const handleSettled = (results: PromiseSettledResult<WebhookDeliveryResult>[]) => {
            results.forEach((result, i) => {
                if (result.status === 'rejected') {
                    const webhook = deliveryPromises[i]?.webhook;
                    if (webhook) {
                        logger.error(
                            `Webhook delivery failed for ${webhook.id}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
                        );
                    }
                }
            });
        };

        if (process.env.NODE_ENV === 'test') {
            const results = await Promise.allSettled(deliveryPromises.map((p) => p.promise));
            handleSettled(results);
        } else {
            Promise.allSettled(deliveryPromises.map((p) => p.promise)).then(handleSettled);
        }
    }

    private async deliverToWebhook(
        webhook: WebhookConfig,
        event: FiusWebhookEvent
    ): Promise<WebhookDeliveryResult> {
        const startTime = Date.now();
        let lastError: Error | undefined;
        let lastStatusCode: number | undefined;

        for (let attempt = 1; attempt <= this.deliveryOptions.maxRetries; attempt++) {
            try {
                const result = await this.sendWebhookRequest(webhook, event, attempt);
                if (result.success) {
                    return result;
                }
                lastError = new Error(result.error || `HTTP ${result.statusCode}`);
                lastStatusCode = result.statusCode;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                logger.warn(
                    `Webhook delivery attempt ${attempt}/${this.deliveryOptions.maxRetries} failed for ${webhook.id}: ${lastError.message}`
                );
            }

            if (attempt < this.deliveryOptions.maxRetries) {
                const baseDelay = process.env.NODE_ENV === 'test' ? 1 : 1000;
                const exp = baseDelay * Math.pow(2, attempt - 1);
                const jitter = exp * 0.2 * Math.random();
                const backoffMs = Math.min(exp + jitter, 10000);
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
        }

        const totalTime = Date.now() - startTime;
        const result: WebhookDeliveryResult = {
            success: false,
            error: lastError?.message || 'Unknown error',
            responseTime: totalTime,
            attempt: this.deliveryOptions.maxRetries,
            ...(lastStatusCode !== undefined && { statusCode: lastStatusCode }),
        };

        logger.error(
            `Webhook delivery failed after ${this.deliveryOptions.maxRetries} attempts for ${webhook.id}: ${result.error}`
        );

        return result;
    }

    private async sendWebhookRequest(
        webhook: WebhookConfig,
        event: FiusWebhookEvent,
        attempt: number
    ): Promise<WebhookDeliveryResult> {
        const startTime = Date.now();
        const payload = JSON.stringify(event);

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'FiusAgent/1.0',
            'X-Fius-Event-Type': event.type,
            'X-Fius-Event-Id': event.id,
            'X-Fius-Delivery-Attempt': attempt.toString(),
        };

        if (webhook.secret && this.deliveryOptions.includeSignature) {
            const signature = this.generateSignature(payload, webhook.secret);
            headers['X-Fius-Signature-256'] = signature;
        }

        try {
            const response = await this.fetchFn(webhook.url, {
                method: 'POST',
                headers,
                body: payload,
                signal: AbortSignal.timeout(this.deliveryOptions.timeout),
            });

            const responseTime = Date.now() - startTime;
            const success = response.ok;

            const result: WebhookDeliveryResult = {
                success,
                statusCode: response.status,
                responseTime,
                attempt,
            };

            if (!success) {
                result.error = `HTTP ${response.status}: ${response.statusText}`;
            }

            logger.debug(
                `Webhook delivery ${success ? 'succeeded' : 'failed'} for ${webhook.id}: ${response.status} in ${responseTime}ms`
            );

            return result;
        } catch (error) {
            const responseTime = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            return {
                success: false,
                error: errorMessage,
                responseTime,
                attempt,
            };
        }
    }

    private generateSignature(payload: string, secret: string): string {
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(payload, 'utf8');
        return `sha256=${hmac.digest('hex')}`;
    }
}
