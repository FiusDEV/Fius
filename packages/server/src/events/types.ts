import { AgentEventBus } from '@fius/core';

export interface EventSubscriber {
    subscribe(eventBus: AgentEventBus): void;
    cleanup?(): void;
}
