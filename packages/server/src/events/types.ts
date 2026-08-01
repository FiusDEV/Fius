import { AgentEventBus } from '@fiusdev/core';

export interface EventSubscriber {
    subscribe(eventBus: AgentEventBus): void;
    cleanup?(): void;
}
