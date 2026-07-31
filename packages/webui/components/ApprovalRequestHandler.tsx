import { useEffect, useCallback } from 'react';
import { useSubmitApproval } from './hooks/useApprovals';
import type { ApprovalRequest } from '@fius/core';
import { ApprovalStatus } from '@fius/core';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { useApprovalStore } from '@/lib/stores/approvalStore';
import { useChatContext } from './hooks/ChatContext';

export type ApprovalEvent = ApprovalRequest;

interface ApprovalRequestHandlerProps {
    onApprove?: (formData?: Record<string, unknown>, rememberChoice?: boolean) => void;
    onDeny?: () => void;
    onHandlersReady?: (handlers: ApprovalHandlers) => void;
}

export interface ApprovalHandlers {
    onApprove: (formData?: Record<string, unknown>, rememberChoice?: boolean) => void;
    onDeny: () => void;
}

/**
 * WebUI component for handling approval requests
 * Uses approvalStore for state management (no DOM events)
 * Sends responses back through API via useSubmitApproval
 */
export function ApprovalRequestHandler({
    onApprove: externalOnApprove,
    onDeny: externalOnDeny,
    onHandlersReady,
}: ApprovalRequestHandlerProps) {
    const currentSessionId = useSessionStore((s) => s.currentSessionId);
    const pendingApproval = useApprovalStore((s) => s.pendingApproval);
    const { ensureSessionEventStream } = useChatContext();
    const { mutateAsync: submitApproval } = useSubmitApproval();

    const currentApproval = pendingApproval || null;

    const sendResponse = useCallback(
        async (approved: boolean, formData?: Record<string, unknown>, rememberChoice?: boolean) => {
            if (!currentApproval) return;

            const { approvalId } = currentApproval;

            const sessionId = currentApproval.sessionId || currentSessionId;
            if (!sessionId) {
                console.error('[WebUI] Cannot submit approval without sessionId');
                return;
            }

            try {
                await ensureSessionEventStream(sessionId);
                await submitApproval({
                    approvalId,
                    sessionId,
                    status: approved ? ApprovalStatus.APPROVED : ApprovalStatus.DENIED,
                    ...(approved && formData ? { formData } : {}),
                    ...(approved && rememberChoice !== undefined ? { rememberChoice } : {}),
                });
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[WebUI] Failed to send approval response: ${message}`);
                return;
            }
        },
        [currentApproval, currentSessionId, submitApproval, ensureSessionEventStream]
    );

    const handleApprove = useCallback(
        (formData?: Record<string, unknown>, rememberChoice?: boolean) => {
            sendResponse(true, formData, rememberChoice);
            externalOnApprove?.(formData, rememberChoice);
        },
        [sendResponse, externalOnApprove]
    );

    const handleDeny = useCallback(() => {
        sendResponse(false);
        externalOnDeny?.();
    }, [sendResponse, externalOnDeny]);

    useEffect(() => {
        if (onHandlersReady) {
            onHandlersReady({
                onApprove: handleApprove,
                onDeny: handleDeny,
            });
        }
    }, [handleApprove, handleDeny, onHandlersReady]);

    return null;
}
