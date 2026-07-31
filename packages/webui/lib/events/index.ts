/**
 * Client Event Bus
 *
 * Centralized event system for the WebUI.
 *
 * @example
 * ```typescript
 * import { eventBus, loggingMiddleware } from '@/lib/events';
 *
 * // Configure middleware
 * eventBus.use(loggingMiddleware);
 *
 * // Subscribe to events
 * eventBus.on('llm:chunk', (event) => {
 *   console.log('Chunk:', event.content);
 * });
 *
 * // Dispatch events
 * eventBus.dispatch({ name: 'llm:thinking', sessionId: 'abc' });
 * ```
 */

export { ClientEventBus, eventBus } from './EventBus.js';

export type {
    StreamingEvent,
    StreamingEventName,
    EventByName,
    ClientEvent,
    ClientEventName,
    EventMiddleware,
    EventHandler,
    EventSubscription,
    ConnectionStatusEvent,
} from './types.js';

export { isEventType, isConnectionStatusEvent } from './types.js';

export {
    loggingMiddleware,
    createLoggingMiddleware,
    configureLogging,
    resetLoggingConfig,
    activityMiddleware,
    notificationMiddleware,
    type LoggingConfig,
} from './middleware/index.js';

export { registerHandlers, getHandler, setupEventHandlers } from './handlers.js';

export { useEventDispatch } from './useEventDispatch.js';
