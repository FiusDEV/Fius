import type { z } from 'zod';
import type {
    ToolApprovalMetadataSchema,
    CommandApprovalMetadataSchema,
    ElicitationMetadataSchema,
    CustomApprovalMetadataSchema,
    BaseApprovalRequestSchema,
    ToolApprovalRequestSchema,
    CommandApprovalRequestSchema,
    ElicitationRequestSchema,
    CustomApprovalRequestSchema,
    ApprovalRequestSchema,
    ApprovalRequestDetailsSchema,
    ToolApprovalResponseDataSchema,
    CommandApprovalResponseDataSchema,
    ElicitationResponseDataSchema,
    CustomApprovalResponseDataSchema,
    BaseApprovalResponseSchema,
    ToolApprovalResponseSchema,
    CommandApprovalResponseSchema,
    ElicitationResponseSchema,
    CustomApprovalResponseSchema,
    ApprovalResponseSchema,
} from './schemas.js';

export const APPROVAL_TYPES = [
    'tool_approval',
    'command_approval',
    'elicitation',
    'custom',
] as const;

export type ApprovalType = (typeof APPROVAL_TYPES)[number];

const ApprovalTypeValues = {
    TOOL_APPROVAL: 'tool_approval',

    COMMAND_APPROVAL: 'command_approval',

    ELICITATION: 'elicitation',

    CUSTOM: 'custom',
} as const satisfies Record<string, ApprovalType>;

export { ApprovalTypeValues as ApprovalType };

export const APPROVAL_STATUSES = ['approved', 'denied', 'cancelled'] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

const ApprovalStatusValues = {
    APPROVED: 'approved',
    DENIED: 'denied',
    CANCELLED: 'cancelled',
} as const satisfies Record<string, ApprovalStatus>;

export { ApprovalStatusValues as ApprovalStatus };

export const DENIAL_REASONS = [
    'user_denied',
    'system_denied',
    'timeout',
    'user_cancelled',
    'system_cancelled',
    'validation_failed',
    'elicitation_disabled',
] as const;

export type DenialReason = (typeof DENIAL_REASONS)[number];

const DenialReasonValues = {
    USER_DENIED: 'user_denied',
    SYSTEM_DENIED: 'system_denied',
    TIMEOUT: 'timeout',
    USER_CANCELLED: 'user_cancelled',
    SYSTEM_CANCELLED: 'system_cancelled',
    VALIDATION_FAILED: 'validation_failed',
    ELICITATION_DISABLED: 'elicitation_disabled',
} as const satisfies Record<string, DenialReason>;

export { DenialReasonValues as DenialReason };

export type ToolApprovalMetadata = z.output<typeof ToolApprovalMetadataSchema>;

export type CommandApprovalMetadata = z.output<typeof CommandApprovalMetadataSchema>;

export type ElicitationMetadata = z.output<typeof ElicitationMetadataSchema>;

export type CustomApprovalMetadata = z.output<typeof CustomApprovalMetadataSchema>;

export type BaseApprovalRequest<_TMetadata = unknown> = z.output<typeof BaseApprovalRequestSchema>;

export type ToolApprovalRequest = z.output<typeof ToolApprovalRequestSchema>;

export type CommandApprovalRequest = z.output<typeof CommandApprovalRequestSchema>;

export type ElicitationRequest = z.output<typeof ElicitationRequestSchema>;

export type CustomApprovalRequest = z.output<typeof CustomApprovalRequestSchema>;

export type ApprovalRequest = z.output<typeof ApprovalRequestSchema>;

export type ToolApprovalResponseData = z.output<typeof ToolApprovalResponseDataSchema>;

export type CommandApprovalResponseData = z.output<typeof CommandApprovalResponseDataSchema>;

export type ElicitationResponseData = z.output<typeof ElicitationResponseDataSchema>;

export type CustomApprovalResponseData = z.output<typeof CustomApprovalResponseDataSchema>;

export type BaseApprovalResponse<_TData = unknown> = z.output<typeof BaseApprovalResponseSchema>;

export type ToolApprovalResponse = z.output<typeof ToolApprovalResponseSchema>;

export type CommandApprovalResponse = z.output<typeof CommandApprovalResponseSchema>;

export type ElicitationResponse = z.output<typeof ElicitationResponseSchema>;

export type CustomApprovalResponse = z.output<typeof CustomApprovalResponseSchema>;

export type ApprovalResponse = z.output<typeof ApprovalResponseSchema>;

export type ApprovalRequestDetails = z.output<typeof ApprovalRequestDetailsSchema>;

export interface ApprovalHandler {
    (request: ApprovalRequest): Promise<ApprovalResponse>;

    cancel?(approvalId: string): void;

    cancelAll?(): void;

    getPending?(): string[];

    getPendingRequests?(): ApprovalRequest[];

    autoApprovePending?(
        predicate: (request: ApprovalRequest) => boolean,
        responseData?: Record<string, unknown>
    ): number;
}
