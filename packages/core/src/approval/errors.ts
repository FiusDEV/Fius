import { FiusRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import { ApprovalErrorCode } from './error-codes.js';
import type { ApprovalType, DenialReason } from './types.js';


export interface ApprovalValidationContext {
    approvalId?: string;
    type?: ApprovalType;
    field?: string;
    reason?: string;
}


export interface ApprovalTimeoutContext {
    approvalId: string;
    type: ApprovalType;
    timeout: number;
    sessionId?: string;
}


export interface ApprovalCancellationContext {
    approvalId?: string;
    type?: ApprovalType;
    reason?: string;
}


export interface ElicitationValidationContext {
    approvalId: string;
    serverName: string;
    errors: string[];
}


export class ApprovalError {
    
    static invalidRequest(
        reason: string,
        context?: ApprovalValidationContext
    ): FiusRuntimeError<ApprovalValidationContext> {
        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_INVALID_REQUEST,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Invalid approval request: ${reason}`,
            context,
            ['Check the approval request structure', 'Ensure all required fields are provided']
        );
    }

    
    static invalidResponse(
        reason: string,
        context?: ApprovalValidationContext
    ): FiusRuntimeError<ApprovalValidationContext> {
        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_INVALID_RESPONSE,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Invalid approval response: ${reason}`,
            context,
            [
                'Check the approval response structure',
                'Ensure approvalId matches the request',
                'Verify status is valid',
            ]
        );
    }

    
    static invalidMetadata(
        type: ApprovalType,
        reason: string
    ): FiusRuntimeError<ApprovalValidationContext> {
        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_INVALID_METADATA,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Invalid metadata for ${type}: ${reason}`,
            { type, reason },
            ['Check the metadata structure for this approval type']
        );
    }

    
    static invalidSchema(reason: string): FiusRuntimeError<ApprovalValidationContext> {
        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_INVALID_SCHEMA,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Invalid elicitation schema: ${reason}`,
            { reason },
            ['Ensure the schema is a valid JSON Schema', 'Check MCP server implementation']
        );
    }

    
    static timeout(
        approvalId: string,
        type: ApprovalType,
        timeout: number,
        sessionId?: string
    ): FiusRuntimeError<ApprovalTimeoutContext> {
        const context: ApprovalTimeoutContext = {
            approvalId,
            type,
            timeout,
        };

        if (sessionId !== undefined) {
            context.sessionId = sessionId;
        }

        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_TIMEOUT,
            ErrorScope.TOOLS,
            ErrorType.TIMEOUT,
            `Approval request timed out after ${timeout}ms`,
            context,
            [
                'Increase the timeout value',
                'Respond to approval requests more quickly',
                'Check if approval UI is functioning',
            ]
        );
    }

    
    static cancelled(
        approvalId: string,
        type: ApprovalType,
        reason?: string
    ): FiusRuntimeError<ApprovalCancellationContext> {
        const message = reason
            ? `Approval request cancelled: ${reason}`
            : 'Approval request was cancelled';

        const context: ApprovalCancellationContext = {
            approvalId,
            type,
        };

        if (reason !== undefined) {
            context.reason = reason;
        }

        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_CANCELLED,
            ErrorScope.TOOLS,
            ErrorType.USER,
            message,
            context
        );
    }

    
    static cancelledAll(reason?: string): FiusRuntimeError<ApprovalCancellationContext> {
        const message = reason
            ? `All approval requests cancelled: ${reason}`
            : 'All approval requests were cancelled';

        const context: ApprovalCancellationContext = {};

        if (reason !== undefined) {
            context.reason = reason;
        }

        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_CANCELLED_ALL,
            ErrorScope.TOOLS,
            ErrorType.USER,
            message,
            context
        );
    }

    
    static providerNotConfigured(): FiusRuntimeError<Record<string, never>> {
        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_PROVIDER_NOT_CONFIGURED,
            ErrorScope.TOOLS,
            ErrorType.SYSTEM,
            'Approval provider not configured',
            {},
            [
                'Configure an approval provider in your agent configuration',
                'Check approval.mode in agent.yml',
            ]
        );
    }

    
    static providerError(message: string, cause?: Error): FiusRuntimeError<{ cause?: string }> {
        const context: { cause?: string } = {};

        if (cause?.message !== undefined) {
            context.cause = cause.message;
        }

        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_PROVIDER_ERROR,
            ErrorScope.TOOLS,
            ErrorType.SYSTEM,
            `Approval provider error: ${message}`,
            context,
            ['Check approval provider implementation', 'Review system logs for details']
        );
    }

    
    static notFound(approvalId: string): FiusRuntimeError<{ approvalId: string }> {
        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_NOT_FOUND,
            ErrorScope.TOOLS,
            ErrorType.NOT_FOUND,
            `Approval request not found: ${approvalId}`,
            { approvalId },
            [
                'Verify the approvalId is correct',
                'Check if the approval has already been resolved or timed out',
            ]
        );
    }

    
    static toolApprovalDenied(
        toolName: string,
        reason?: DenialReason,
        customMessage?: string,
        sessionId?: string
    ): FiusRuntimeError<{ toolName: string; reason?: DenialReason; sessionId?: string }> {
        let message: string;
        let suggestions: string[];

        switch (reason) {
            case 'user_denied':
                message = customMessage ?? `Tool execution denied by user: ${toolName}`;
                suggestions = ['Tool was denied by user'];
                break;
            case 'system_denied':
                message = customMessage ?? `Tool execution denied by system policy: ${toolName}`;
                suggestions = [
                    'Tool was blocked by host policy',
                    'Check permissions.toolPolicies in agent configuration',
                ];
                break;
            case 'timeout':
                message = customMessage ?? `Tool approval timed out: ${toolName}`;
                suggestions = [
                    'Increase the timeout value',
                    'Respond to approval requests more quickly',
                ];
                break;
            default:
                message = customMessage ?? `Tool execution denied: ${toolName}`;
                suggestions = ['Approve the tool in the approval dialog', 'Check tool permissions'];
        }

        const context: { toolName: string; reason?: DenialReason; sessionId?: string } = {
            toolName,
        };
        if (reason) context.reason = reason;
        if (sessionId) context.sessionId = sessionId;

        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_TOOL_APPROVAL_DENIED,
            ErrorScope.TOOLS,
            ErrorType.FORBIDDEN,
            message,
            context,
            suggestions
        );
    }

    
    static elicitationDenied(
        serverName: string,
        reason?: DenialReason,
        customMessage?: string,
        sessionId?: string
    ): FiusRuntimeError<{ serverName: string; reason?: DenialReason; sessionId?: string }> {
        let message: string;
        let suggestions: string[];

        switch (reason) {
            case 'user_denied':
                message =
                    customMessage ??
                    `Elicitation request denied by user from MCP server: ${serverName}`;
                suggestions = [
                    'User clicked deny on the form',
                    'The agent cannot proceed without this input',
                ];
                break;
            case 'user_cancelled':
                message =
                    customMessage ??
                    `Elicitation request cancelled by user from MCP server: ${serverName}`;
                suggestions = [
                    'User cancelled the form',
                    'The agent cannot proceed without this input',
                ];
                break;
            case 'system_cancelled':
                message =
                    customMessage ?? `Elicitation request cancelled from MCP server: ${serverName}`;
                suggestions = ['Session may have ended', 'Try again'];
                break;
            case 'timeout':
                message =
                    customMessage ?? `Elicitation request timed out from MCP server: ${serverName}`;
                suggestions = [
                    'Increase the timeout value',
                    'Respond to elicitation requests more quickly',
                ];
                break;
            case 'elicitation_disabled':
                message =
                    customMessage ??
                    `Elicitation is disabled. Cannot request input from MCP server: ${serverName}`;
                suggestions = [
                    'Enable elicitation in your agent configuration',
                    'Set elicitation.enabled: true in agent.yml',
                ];
                break;
            case 'validation_failed':
                message =
                    customMessage ??
                    `Elicitation form validation failed from MCP server: ${serverName}`;
                suggestions = ['Check the form inputs match the schema requirements'];
                break;
            default:
                message =
                    customMessage ?? `Elicitation request denied from MCP server: ${serverName}`;
                suggestions = ['Complete the requested form', 'Check MCP server requirements'];
        }

        const context: { serverName: string; reason?: DenialReason; sessionId?: string } = {
            serverName,
        };
        if (reason) context.reason = reason;
        if (sessionId) context.sessionId = sessionId;

        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_ELICITATION_DENIED,
            ErrorScope.TOOLS,
            ErrorType.FORBIDDEN,
            message,
            context,
            suggestions
        );
    }

    
    static elicitationValidationFailed(
        serverName: string,
        errors: string[],
        approvalId: string
    ): FiusRuntimeError<ElicitationValidationContext> {
        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_ELICITATION_VALIDATION_FAILED,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Elicitation form validation failed: ${errors.join(', ')}`,
            { approvalId, serverName, errors },
            ['Check the form inputs match the schema requirements', 'Review validation errors']
        );
    }

    
    static invalidConfig(reason: string): FiusRuntimeError<{ reason: string }> {
        return new FiusRuntimeError(
            ApprovalErrorCode.APPROVAL_CONFIG_INVALID,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Invalid approval configuration: ${reason}`,
            { reason },
            ['Check approval configuration in agent.yml', 'Review approval.mode and related fields']
        );
    }
}
