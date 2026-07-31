import type { ApprovalHandler, ApprovalRequest, ApprovalResponse } from '@fius/core';
import { ApprovalStatus, DenialReason } from '@fius/core';
import type { ApprovalCoordinator } from './approval-coordinator.js';

export function createManualApprovalHandler(coordinator: ApprovalCoordinator): ApprovalHandler {
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
                    coordinator.emitResponse(timeoutResponse);
                    resolve(timeoutResponse);
                }, effectiveTimeout);
            }

            let cleanupListener: (() => void) | null = null;
            const cleanup = () => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
                if (cleanupListener) {
                    cleanupListener();
                    cleanupListener = null;
                }
            };

            const listener = (res: ApprovalResponse) => {
                if (res.approvalId === request.approvalId) {
                    cleanup();
                    pendingApprovals.delete(request.approvalId);
                    resolve(res);
                }
            };

            coordinator.on('approval:response', listener);
            cleanupListener = () => coordinator.off('approval:response', listener);

            pendingApprovals.set(request.approvalId, {
                cleanup,
                resolve,
                request,
            });

            coordinator.emitRequest(request);
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

                coordinator.emitResponse(cancelResponse);
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

                    coordinator.emitResponse(autoApproveResponse);
                    pending.resolve(autoApproveResponse);
                    count++;
                }
            }

            return count;
        },
    });

    return handler;
}
