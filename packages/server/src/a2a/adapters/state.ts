import type { InternalMessage } from '@fius/core';
import type { TaskState, Message } from '../types.js';

export function deriveTaskState(messages: InternalMessage[]): TaskState {
    if (messages.length === 0) {
        return 'submitted';
    }

    const hasUserMessage = messages.some((m) => m.role === 'user');
    const hasAssistantMessage = messages.some((m) => m.role === 'assistant');

    if (hasUserMessage && hasAssistantMessage) {
        return 'completed';
    }

    if (hasUserMessage && !hasAssistantMessage) {
        return 'working';
    }

    return 'submitted';
}

export function deriveTaskStateFromA2A(messages: Message[]): TaskState {
    if (messages.length === 0) {
        return 'submitted';
    }

    const hasUserMessage = messages.some((m) => m.role === 'user');
    const hasAgentMessage = messages.some((m) => m.role === 'agent');

    if (hasUserMessage && hasAgentMessage) {
        return 'completed';
    }

    if (hasUserMessage && !hasAgentMessage) {
        return 'working';
    }

    return 'submitted';
}
