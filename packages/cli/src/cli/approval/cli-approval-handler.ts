import type {
    ApprovalHandler,
    ApprovalRequest,
    ApprovalResponse,
    AgentEventMap,
    EventArgs,
    EventListener,
} from '@fiusdev/core';
import { ApprovalStatus, DenialReason } from '@fiusdev/core';

type ApprovalEventBus = {
    on: <K extends keyof AgentEventMap>(
        event: K,
        listener: EventListener<AgentEventMap[K]>,
        options?: { signal?: AbortSignal }
    ) => void;
    emit: <K extends keyof AgentEventMap>(
        event: K,
        ...args: EventArgs<AgentEventMap[K]>
    ) => boolean;
};

export function createCLIApprovalHandler(eventBus: ApprovalEventBus): ApprovalHandler {
    const pendingApprovals = new Map<
        string,
        {
            cleanup: () => void;
            resolve: (response: ApprovalResponse) => void;
            request: ApprovalRequest;
        }
    >();

    const handleApproval = (request: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise<ApprovalResponse>((resolve) => {
            const effectiveTimeout = request.timeout;

            let timer: NodeJS.Timeout | undefined;
            if (effectiveTimeout !== undefined) {
                timer = setTimeout(() => {
                    cleanup();
                    pendingApprovals.delete(request.approvalId);

                    const timeoutResponse: ApprovalResponse = {
                        approvalId: request.approvalId,
                        status: ApprovalStatus.CANCELLED,
                        sessionId: request.sessionId,
                        hostRuntime: request.hostRuntime,
                        reason: DenialReason.TIMEOUT,
                        message: `Approval request timed out after ${effectiveTimeout}ms`,
                        timeoutMs: effectiveTimeout,
                    };

                    eventBus.emit('approval:response', timeoutResponse);

                    resolve(timeoutResponse);
                }, effectiveTimeout);
            }

            const controller = new AbortController();
            const cleanup = () => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
                controller.abort();
            };

            const listener = (res: ApprovalResponse) => {
                if (res.approvalId === request.approvalId) {
                    cleanup();
                    pendingApprovals.delete(request.approvalId);
                    resolve(res);
                }
            };

            eventBus.on('approval:response', listener, { signal: controller.signal });

            pendingApprovals.set(request.approvalId, {
                cleanup,
                resolve,
                request,
            });

            eventBus.emit('approval:request', request);
        });
    };

    const handler: ApprovalHandler = Object.assign(handleApproval, {
        cancel: (approvalId: string): void => {
            const pending = pendingApprovals.get(approvalId);
            if (pending) {
                pending.cleanup();
                pendingApprovals.delete(approvalId);

                const cancelResponse: ApprovalResponse = {
                    approvalId,
                    status: ApprovalStatus.CANCELLED,
                    sessionId: pending.request.sessionId,
                    hostRuntime: pending.request.hostRuntime,
                    reason: DenialReason.SYSTEM_CANCELLED,
                    message: 'Approval request was cancelled',
                };

                eventBus.emit('approval:response', cancelResponse);

                pending.resolve(cancelResponse);
            }
        },

        cancelAll: (): void => {
            for (const [approvalId] of pendingApprovals) {
                handler.cancel?.(approvalId);
            }
        },

        getPending: (): string[] => {
            return Array.from(pendingApprovals.keys());
        },

        getPendingRequests: (): ApprovalRequest[] => {
            return Array.from(pendingApprovals.values()).map((p) => p.request);
        },

        /**
         * Auto-approve pending requests that match a predicate.
         * Used when a pattern is remembered to auto-approve other parallel requests
         * that would now match the same pattern.
         */
        autoApprovePending: (
            predicate: (request: ApprovalRequest) => boolean,
            responseData?: Record<string, unknown>
        ): number => {
            let count = 0;

            for (const [approvalId, pending] of pendingApprovals) {
                if (predicate(pending.request)) {
                    pending.cleanup();
                    pendingApprovals.delete(approvalId);

                    const autoApproveResponse: ApprovalResponse = {
                        approvalId,
                        status: ApprovalStatus.APPROVED,
                        sessionId: pending.request.sessionId,
                        hostRuntime: pending.request.hostRuntime,
                        message: 'Auto-approved due to matching remembered pattern',
                        data: responseData,
                    };

                    eventBus.emit('approval:response', autoApproveResponse);

                    pending.resolve(autoApproveResponse);
                    count++;
                }
            }

            return count;
        },
    });

    return handler;
}
