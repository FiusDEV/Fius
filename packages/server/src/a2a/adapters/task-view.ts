import type { ChatSession } from '@fius/core';
import type { Task, TaskStatus } from '../types.js';
import { internalMessagesToA2A } from './message.js';
import { deriveTaskState } from './state.js';

export class TaskView {
    constructor(private session: ChatSession) {}

    async toA2ATask(): Promise<Task> {
        const history = await this.session.getHistory();

        const a2aMessages = internalMessagesToA2A(history, this.session.id, this.session.id);

        const state = deriveTaskState(history);

        const status: TaskStatus = {
            state,
            timestamp: new Date().toISOString(),
        };

        const task: Task = {
            id: this.session.id,
            contextId: this.session.id,
            status,
            history: a2aMessages,
            kind: 'task',
            metadata: {
                fius: {
                    sessionId: this.session.id,
                },
            },
        };

        return task;
    }

    get sessionId(): string {
        return this.session.id;
    }

    get session_(): ChatSession {
        return this.session;
    }
}

export async function createTaskView(
    sessionId: string,
    agent: { createSession(id: string): Promise<ChatSession> }
): Promise<TaskView> {
    const session = await agent.createSession(sessionId);
    return new TaskView(session);
}
