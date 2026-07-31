import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { ToolErrorCode } from './error-codes.js';


export class ToolError {
    
    static notFound(toolName: string) {
        return new FiusRuntimeError(
            ToolErrorCode.TOOL_NOT_FOUND,
            ErrorScope.TOOLS,
            ErrorType.NOT_FOUND,
            `Tool '${toolName}' not found`,
            { toolName }
        );
    }

    
    static executionFailed(toolName: string, reason: string, sessionId?: string) {
        return new FiusRuntimeError(
            ToolErrorCode.EXECUTION_FAILED,
            ErrorScope.TOOLS,
            ErrorType.SYSTEM,
            `Tool '${toolName}' execution failed: ${reason}`,
            { toolName, reason, sessionId }
        );
    }

    
    static executionDenied(toolName: string, sessionId?: string, userMessage?: string) {
        const message = userMessage
            ? `Tool '${toolName}' was denied. ${userMessage}`
            : `Tool '${toolName}' execution was denied by the user`;
        return new FiusRuntimeError(
            ToolErrorCode.EXECUTION_DENIED,
            ErrorScope.TOOLS,
            ErrorType.FORBIDDEN,
            message,
            { toolName, sessionId, userMessage }
        );
    }

    
    static executionTimeout(toolName: string, timeoutMs: number, sessionId?: string) {
        const message =
            timeoutMs > 0
                ? `Tool '${toolName}' execution timed out after ${timeoutMs}ms`
                : `Tool '${toolName}' execution timed out`;
        return new FiusRuntimeError(
            ToolErrorCode.EXECUTION_TIMEOUT,
            ErrorScope.TOOLS,
            ErrorType.TIMEOUT,
            message,
            { toolName, timeoutMs, sessionId }
        );
    }

    
    static validationFailed(toolName: string, reason: string, context?: Record<string, unknown>) {
        return new FiusRuntimeError(
            ToolErrorCode.VALIDATION_FAILED,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Tool '${toolName}' validation failed: ${reason}`,
            { toolName, reason, ...context }
        );
    }

    
    static fileModifiedSincePreview(toolName: string, filePath: string) {
        return new FiusRuntimeError(
            ToolErrorCode.FILE_MODIFIED_SINCE_PREVIEW,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `File '${filePath}' was modified since the preview was generated. Please read the file again and retry the operation.`,
            {
                toolName,
                filePath,
                recovery:
                    'Read the file with read_file tool to get current content, then retry the edit.',
            }
        );
    }

    
    static unauthorized(toolName: string, sessionId?: string) {
        return new FiusRuntimeError(
            ToolErrorCode.TOOL_UNAUTHORIZED,
            ErrorScope.TOOLS,
            ErrorType.FORBIDDEN,
            `Unauthorized access to tool '${toolName}'`,
            { toolName, sessionId }
        );
    }

    
    static approvalHandlerMissing(toolName: string) {
        return new FiusRuntimeError(
            ToolErrorCode.APPROVAL_HANDLER_MISSING,
            ErrorScope.TOOLS,
            ErrorType.SYSTEM,
            `Approval handler missing for tool '${toolName}'`,
            { toolName }
        );
    }

    
    static approvalTimeout(toolName: string, timeoutMs: number, sessionId?: string) {
        return new FiusRuntimeError(
            ToolErrorCode.APPROVAL_TIMEOUT,
            ErrorScope.TOOLS,
            ErrorType.TIMEOUT,
            `Tool '${toolName}' approval timed out after ${timeoutMs}ms`,
            { toolName, timeoutMs, sessionId }
        );
    }

    
    static invalidName(toolName: string, reason: string) {
        return new FiusRuntimeError(
            ToolErrorCode.TOOL_INVALID_ARGS,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Invalid tool name '${toolName}': ${reason}`,
            { toolName, reason }
        );
    }

    
    static configInvalid(message: string) {
        return new FiusRuntimeError(
            ToolErrorCode.CONFIG_INVALID,
            ErrorScope.TOOLS,
            ErrorType.USER,
            message,
            {}
        );
    }

    
    static approvalCancelled(toolName: string, reason: string) {
        return new FiusRuntimeError(
            ToolErrorCode.APPROVAL_CANCELLED,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Tool approval for '${toolName}' was cancelled: ${reason}`,
            { toolName, reason }
        );
    }

    
    static featureDisabled(
        toolName: string,
        missingFeatures: string[],
        message: string
    ): FiusRuntimeError<{ toolName: string; missingFeatures: string[] }> {
        return new FiusRuntimeError(
            ToolErrorCode.FEATURE_DISABLED,
            ErrorScope.TOOLS,
            ErrorType.USER,
            message,
            { toolName, missingFeatures },
            [
                `Remove '${toolName}' from tools[].enabledTools (builtin-tools) in your agent config`,
                `Or enable required features: ${missingFeatures.map((f) => `${f}.enabled: true`).join(', ')}`,
            ]
        );
    }

    
    static unknownCustomToolFactory(type: string, availableTypes: string[]): FiusRuntimeError {
        return new FiusRuntimeError(
            ToolErrorCode.CUSTOM_TOOL_FACTORY_UNKNOWN,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Unknown custom tool factory: '${type}'`,
            { type, availableTypes },
            `Available types: ${availableTypes.length > 0 ? availableTypes.join(', ') : 'none'}`
        );
    }

    
    static customToolFactoryAlreadyRegistered(type: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ToolErrorCode.CUSTOM_TOOL_FACTORY_ALREADY_REGISTERED,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Custom tool factory '${type}' is already registered`,
            { type },
            `Use unregister() first if you want to replace it`
        );
    }
}
