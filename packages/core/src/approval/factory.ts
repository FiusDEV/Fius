import { createHash, randomUUID } from 'crypto';
import type { ApprovalRequest, ApprovalRequestDetails } from './types.js';

type ApprovalId = ApprovalRequest['approvalId'];

export function createDeterministicApprovalId(key: string): ApprovalId {
    const hash = createHash('sha256').update(key).digest('hex');
    const variant = ((Number.parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
    const uuidHex = `${hash.slice(0, 12)}5${hash.slice(13, 16)}${variant}${hash.slice(17, 32)}`;
    const approvalId = [
        uuidHex.slice(0, 8),
        uuidHex.slice(8, 12),
        uuidHex.slice(12, 16),
        uuidHex.slice(16, 20),
        uuidHex.slice(20, 32),
    ].join('-');
    return approvalId as ApprovalId;
}

export function createApprovalRequest(
    details: ApprovalRequestDetails,
    approvalId: ApprovalId = randomUUID()
): ApprovalRequest {
    return {
        approvalId,
        type: details.type,
        sessionId: details.sessionId,
        hostRuntime: details.hostRuntime,
        timeout: details.timeout,
        timestamp: new Date(),
        metadata: details.metadata,
    } as ApprovalRequest;
}
