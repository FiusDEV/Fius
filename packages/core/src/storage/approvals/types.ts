import { z } from 'zod';
import type { ApprovalRequest, ApprovalResponse } from '../../approval/types.js';

export const SessionApprovalStateSchema = z
    .object({
        approvedKeys: z.record(z.string(), z.enum(['session', 'once'])).default({}),
    })
    .strip();

export type SessionApprovalState = z.output<typeof SessionApprovalStateSchema>;

export interface ApprovalStore {
    
    createRequest(input: { request: ApprovalRequest }): Promise<ApprovalRequest>;
    getRequest(input: { approvalId: string }): Promise<ApprovalRequest | undefined>;
    listPending(input: { sessionId?: string }): Promise<ApprovalRequest[]>;
    
    saveResponse(input: {
        response: ApprovalResponse;
    }): Promise<{ response: ApprovalResponse; status: 'created' | 'replayed' }>;
    getResponse(input: { approvalId: string }): Promise<ApprovalResponse | undefined>;
    loadSessionState(input: { sessionId?: string }): Promise<SessionApprovalState>;
    saveSessionState(input: { sessionId?: string; state: SessionApprovalState }): Promise<void>;
    deleteSessionState(input: { sessionId?: string }): Promise<void>;
}
