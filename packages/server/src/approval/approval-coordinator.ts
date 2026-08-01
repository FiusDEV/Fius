import { EventEmitter } from 'node:events';
import type { ApprovalRequest, ApprovalResponse } from '@fiusdev/core';

export class ApprovalCoordinator extends EventEmitter {
    private approvalContexts = new Map<
        string,
        Pick<ApprovalRequest, 'sessionId' | 'hostRuntime'>
    >();

    public emitRequest(request: ApprovalRequest): void {
        this.approvalContexts.set(request.approvalId, {
            sessionId: request.sessionId,
            hostRuntime: request.hostRuntime,
        });
        this.emit('approval:request', request);
    }

    public emitResponse(response: ApprovalResponse): void {
        this.emit('approval:response', response);
    }

    public clearContext(approvalId: string): void {
        this.approvalContexts.delete(approvalId);
    }

    public getSessionId(approvalId: string): string | undefined {
        return this.approvalContexts.get(approvalId)?.sessionId;
    }

    public getHostRuntime(approvalId: string): ApprovalRequest['hostRuntime'] | undefined {
        return this.approvalContexts.get(approvalId)?.hostRuntime;
    }

    public onRequest(
        handler: (request: ApprovalRequest) => void,
        options?: { signal?: AbortSignal }
    ): void {
        const listener = (request: ApprovalRequest) => handler(request);
        this.on('approval:request', listener);

        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.off('approval:request', listener);
            });
        }
    }

    public onResponse(
        handler: (response: ApprovalResponse) => void,
        options?: { signal?: AbortSignal }
    ): void {
        const listener = (response: ApprovalResponse) => handler(response);
        this.on('approval:response', listener);

        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.off('approval:response', listener);
            });
        }
    }
}
