import type { FiusAgent } from '@fiusdev/core';
import type {
    Task,
    MessageSendParams,
    TaskQueryParams,
    ListTasksParams,
    ListTasksResult,
    TaskIdParams,
} from '../types.js';
import { TaskView } from '../adapters/task-view.js';
import { a2aToInternalMessage } from '../adapters/message.js';

type MethodMap = {
    'message/send': (params: MessageSendParams) => Promise<Task>;
    'message/stream': (params: MessageSendParams) => Promise<{ taskId: string }>;
    'tasks/get': (params: TaskQueryParams) => Promise<Task>;
    'tasks/list': (params?: ListTasksParams) => Promise<ListTasksResult>;
    'tasks/cancel': (params: TaskIdParams) => Promise<Task>;
};

export class A2AMethodHandlers {
    constructor(private agent: FiusAgent) {}

    async messageSend(params: MessageSendParams): Promise<Task> {
        if (!params?.message) {
            throw new Error('message is required');
        }

        const { message } = params;

        const taskId = message.taskId;

        const session = await this.agent.createSession(taskId);

        const { text, image, file } = a2aToInternalMessage(message);
        await this.agent.run(text, image, file, session.id);

        const taskView = new TaskView(session);
        const task = await taskView.toA2ATask();

        return task;
    }

    async tasksGet(params: TaskQueryParams): Promise<Task> {
        if (!params?.id) {
            throw new Error('id is required');
        }

        const session = await this.agent.getSession(params.id);
        if (!session) {
            throw new Error(`Task not found: ${params.id}`);
        }

        const taskView = new TaskView(session);
        return await taskView.toA2ATask();
    }

    async tasksList(params?: ListTasksParams): Promise<ListTasksResult> {
        const sessionIds = await this.agent.listSessions();

        const allTasks: Task[] = [];
        for (const sessionId of sessionIds) {
            const session = await this.agent.getSession(sessionId);
            if (!session) {
                continue;
            }

            const taskView = new TaskView(session);
            const task = await taskView.toA2ATask();

            if (params?.status && task.status.state !== params.status) {
                continue;
            }

            if (params?.contextId && task.contextId !== params.contextId) {
                continue;
            }

            allTasks.push(task);
        }

        const pageSize = Math.min(params?.pageSize ?? 50, 100);
        const offset = 0;
        const paginatedTasks = allTasks.slice(offset, offset + pageSize);

        return {
            tasks: paginatedTasks,
            totalSize: allTasks.length,
            pageSize,
            nextPageToken: '',
        };
    }

    async tasksCancel(params: TaskIdParams): Promise<Task> {
        if (!params?.id) {
            throw new Error('id is required');
        }

        const session = await this.agent.getSession(params.id);
        if (!session) {
            throw new Error(`Task not found: ${params.id}`);
        }

        session.cancel();

        const taskView = new TaskView(session);
        return await taskView.toA2ATask();
    }

    async messageStream(params: MessageSendParams): Promise<{ taskId: string }> {
        if (!params?.message) {
            throw new Error('message is required');
        }

        const { message } = params;

        const taskId = message.taskId;

        const session = await this.agent.createSession(taskId);

        return { taskId: session.id };
    }

    getMethods(): MethodMap {
        return {
            'message/send': this.messageSend.bind(this),
            'message/stream': this.messageStream.bind(this),
            'tasks/get': this.tasksGet.bind(this),
            'tasks/list': this.tasksList.bind(this),
            'tasks/cancel': this.tasksCancel.bind(this),
        };
    }
}
