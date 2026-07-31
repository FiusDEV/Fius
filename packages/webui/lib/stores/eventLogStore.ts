/**
 * Event Log Store
 *
 * Stores activity events for debugging and monitoring.
 * Provides an audit trail of all events flowing through the event bus.
 */

import { create } from 'zustand';
import type { StreamingEventName } from '@fius/core';

export type EventCategory = 'agent' | 'tool' | 'system' | 'user' | 'approval';

/**
 * Activity event stored in the log
 */
export interface ActivityEvent {
    /**
     * Unique event ID
     */
    id: string;

    /**
     * Event name from SSE
     */
    name: StreamingEventName | string;

    /**
     * Event category
     */
    category: EventCategory;

    /**
     * Human-readable description
     */
    description: string;

    /**
     * Timestamp when event was logged
     */
    timestamp: number;

    /**
     * Session ID if event is session-scoped
     */
    sessionId?: string;

    /**
     * Additional metadata (full event payload)
     */
    metadata?: Record<string, unknown>;
}

interface EventLogStore {
    events: ActivityEvent[];

    maxEvents: number;

    addEvent: (event: Omit<ActivityEvent, 'id'>) => void;

    clearEvents: () => void;

    clearSessionEvents: (sessionId: string) => void;

    setMaxEvents: (max: number) => void;

    getEventsBySession: (sessionId: string) => ActivityEvent[];

    getEventsByCategory: (category: EventCategory) => ActivityEvent[];

    getRecentEvents: (limit: number) => ActivityEvent[];
}

export const useEventLogStore = create<EventLogStore>()((set, get) => ({
    events: [],
    maxEvents: 1000,

    addEvent: (event) => {
        const id = `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        set((state) => {
            const newEvents = [...state.events, { ...event, id }];

            if (newEvents.length > state.maxEvents) {
                return { events: newEvents.slice(-state.maxEvents) };
            }

            return { events: newEvents };
        });
    },

    clearEvents: () => {
        set({ events: [] });
    },

    clearSessionEvents: (sessionId) => {
        set((state) => ({
            events: state.events.filter((event) => event.sessionId !== sessionId),
        }));
    },

    setMaxEvents: (max) => {
        set((state) => {
            if (state.events.length > max) {
                return {
                    maxEvents: max,
                    events: state.events.slice(-max),
                };
            }
            return { maxEvents: max };
        });
    },

    getEventsBySession: (sessionId) => {
        return get().events.filter((event) => event.sessionId === sessionId);
    },

    getEventsByCategory: (category) => {
        return get().events.filter((event) => event.category === category);
    },

    getRecentEvents: (limit) => {
        const events = get().events;
        return events.slice(-limit);
    },
}));
