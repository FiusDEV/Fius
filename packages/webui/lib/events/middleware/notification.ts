/**
 * Notification Middleware
 *
 * Converts significant events into toast notifications.
 * Respects notification suppression during history replay and session switches.
 */

import type { EventMiddleware, ClientEvent } from '../types.js';
import { useSessionStore } from '../../stores/sessionStore.js';
import { useNotificationStore, type Toast } from '../../stores/notificationStore.js';

/**
 * Convert an event to a toast notification
 * Returns null if the event should not generate a toast
 */
function eventToToast(
    event: ClientEvent,
    isCurrentSession: boolean
): Omit<Toast, 'id' | 'timestamp'> | null {
    switch (event.name) {
        case 'llm:error': {
            if (isCurrentSession) {
                return null; // Don't toast - shown inline via ErrorBanner
            }
            const sessionId = 'sessionId' in event ? event.sessionId : undefined;
            return {
                title: 'Error in background session',
                description: event.error?.message || 'An error occurred',
                intent: 'danger',
                sessionId,
            };
        }

        case 'llm:response':
        case 'interaction:blocked': {
            const sessionId = 'sessionId' in event ? event.sessionId : undefined;
            if (isCurrentSession) {
                return null; // Don't notify for current session
            }
            return {
                title: 'Response Ready',
                description: 'Agent completed in background session',
                intent: 'info',
                sessionId,
            };
        }

        default:
            return null;
    }
}

/**
 * Notification middleware
 *
 * Converts events into toast notifications based on:
 * - Event type (approval, error, response)
 * - Session context (current vs background)
 * - Notification suppression state (replay, switching)
 */
export const notificationMiddleware: EventMiddleware = (event, next) => {
    next(event);

    const { shouldSuppressNotifications, currentSessionId } = useSessionStore.getState();
    const { addToast } = useNotificationStore.getState();

    if (shouldSuppressNotifications()) {
        return;
    }

    const sessionId = 'sessionId' in event ? event.sessionId : undefined;
    const isCurrentSession = sessionId === currentSessionId;

    const toast = eventToToast(event, isCurrentSession);

    if (toast) {
        addToast(toast);
    }
};
