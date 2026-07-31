/**
 * Approval Store
 *
 * Manages approval requests from the agent using Zustand.
 * Handles queueing when multiple approvals arrive simultaneously.
 *
 * Flow:
 * 1. approval:request event → addApproval() → sets pendingApproval or queues
 * 2. User responds via UI → sends response to agent
 * 3. approval:response event → processResponse() → clears and processes next
 */

import { create } from 'zustand';
import { ApprovalStatus } from '@fius/core';
import type { ApprovalRequest, ApprovalResponse } from '@fius/core';

export interface PendingApproval {
    request: ApprovalRequest;
    timestamp: number;
}

interface ApprovalStore {
    pendingApproval: ApprovalRequest | null;

    queue: ApprovalRequest[];

    addApproval: (request: ApprovalRequest) => void;
    processResponse: (response: ApprovalResponse) => void;
    clearApproval: () => void;
    clearAll: () => void;

    getPendingCount: () => number;
    getPendingForSession: (sessionId: string) => ApprovalRequest[];
    hasPendingApproval: () => boolean;
}

/**
 * Check if approval response status is terminal (ends the approval)
 */
function isTerminalStatus(status: ApprovalStatus): boolean {
    return (
        status === ApprovalStatus.APPROVED ||
        status === ApprovalStatus.DENIED ||
        status === ApprovalStatus.CANCELLED
    );
}

export const useApprovalStore = create<ApprovalStore>((set, get) => ({
    pendingApproval: null,
    queue: [],

    /**
     * Add a new approval request
     * If there's already a pending approval, queue it
     */
    addApproval: (request: ApprovalRequest) => {
        set((state) => {
            if (state.pendingApproval) {
                return {
                    queue: [...state.queue, request],
                };
            }
            return {
                pendingApproval: request,
            };
        });
    },

    /**
     * Process an approval response
     * If status is terminal (approved/denied/cancelled), clear pending and process next
     */
    processResponse: (response: ApprovalResponse) => {
        set((state) => {
            if (state.pendingApproval?.approvalId !== response.approvalId) {
                return state;
            }

            if (isTerminalStatus(response.status)) {
                const [next, ...rest] = state.queue;

                return {
                    pendingApproval: next ?? null,
                    queue: rest,
                };
            }

            return state;
        });
    },

    clearApproval: () => {
        set((state) => {
            const [next, ...rest] = state.queue;
            return {
                pendingApproval: next ?? null,
                queue: rest,
            };
        });
    },

    clearAll: () => {
        set({
            pendingApproval: null,
            queue: [],
        });
    },

    getPendingCount: () => {
        const state = get();
        return (state.pendingApproval ? 1 : 0) + state.queue.length;
    },

    getPendingForSession: (sessionId: string) => {
        const state = get();
        const results: ApprovalRequest[] = [];

        if (state.pendingApproval?.sessionId === sessionId) {
            results.push(state.pendingApproval);
        }

        results.push(...state.queue.filter((req) => req.sessionId === sessionId));

        return results;
    },

    hasPendingApproval: () => {
        return get().pendingApproval !== null;
    },
}));
