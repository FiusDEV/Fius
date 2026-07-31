import type { AgentEventMap, AgentEventName } from '@fius/core';

export interface WebhookConfig {
    id: string;
    url: string;
    secret?: string;
    createdAt: Date;
    description?: string;
}

export interface FiusWebhookEvent<T extends AgentEventName = AgentEventName> {
    id: string;
    type: T;
    data: AgentEventMap[T];
    created: string;
    apiVersion: string;
}

export interface WebhookDeliveryResult {
    success: boolean;
    statusCode?: number;
    error?: string;
    responseTime: number;
    attempt: number;
}

export interface WebhookRegistrationRequest {
    url: string;
    secret?: string;
    description?: string;
}

export interface WebhookTestEvent extends FiusWebhookEvent<'tools:available-updated'> {
    test: true;
}

export type WebhookHandler<T extends AgentEventName = AgentEventName> = (
    event: FiusWebhookEvent<T>
) => Promise<void> | void;

export type WebhookEventHandlers = {
    [K in AgentEventName]?: WebhookHandler<K>;
};

export interface WebhookDeliveryOptions {
    maxRetries?: number;
    timeout?: number;
    includeSignature?: boolean;
}
