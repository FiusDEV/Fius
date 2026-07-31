import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { MCPErrorCode } from './error-codes.js';


export class MCPError {
    
    static connectionFailed(serverName: string, reason: string) {
        return new FiusRuntimeError(
            MCPErrorCode.CONNECTION_FAILED,
            ErrorScope.MCP,
            ErrorType.THIRD_PARTY,
            `Failed to connect to MCP server '${serverName}': ${reason}`,
            { serverName, reason },
            'Check that the MCP server is running and accessible'
        );
    }

    
    static disconnectionFailed(serverName: string, reason: string) {
        return new FiusRuntimeError(
            MCPErrorCode.DISCONNECTION_FAILED,
            ErrorScope.MCP,
            ErrorType.SYSTEM,
            `Failed to disconnect MCP server '${serverName}': ${reason}`,
            { serverName, reason },
            'Try restarting the application if the server remains in an inconsistent state'
        );
    }

    
    static protocolError(message: string, details?: unknown) {
        return new FiusRuntimeError(
            MCPErrorCode.PROTOCOL_ERROR,
            ErrorScope.MCP,
            ErrorType.THIRD_PARTY,
            `MCP protocol error: ${message}`,
            details,
            'Check MCP server compatibility and protocol version'
        );
    }

    
    static authenticationRequired(serverName: string, reason?: string) {
        return new FiusRuntimeError(
            MCPErrorCode.AUTH_REQUIRED,
            ErrorScope.MCP,
            ErrorType.THIRD_PARTY,
            `Authentication required for MCP server '${serverName}'${reason ? `: ${reason}` : ''}`,
            { serverName, reason },
            'Authenticate with the MCP server using the CLI /mcp flow'
        );
    }

    
    static duplicateName(name: string, existingName: string) {
        return new FiusRuntimeError(
            MCPErrorCode.DUPLICATE_NAME,
            ErrorScope.MCP,
            ErrorType.USER,
            `Server name '${name}' conflicts with existing '${existingName}'`,
            { name, existingName },
            'Use a unique name for each MCP server'
        );
    }

    
    static serverNotFound(serverName: string, reason?: string) {
        return new FiusRuntimeError(
            MCPErrorCode.SERVER_NOT_FOUND,
            ErrorScope.MCP,
            ErrorType.NOT_FOUND,
            `MCP server '${serverName}' not found${reason ? `: ${reason}` : ''}`,
            { serverName, reason }
        );
    }

    
    static toolNotFound(toolName: string) {
        return new FiusRuntimeError(
            MCPErrorCode.TOOL_NOT_FOUND,
            ErrorScope.MCP,
            ErrorType.NOT_FOUND,
            `No MCP tool found: ${toolName}`,
            { toolName }
        );
    }

    
    static promptNotFound(promptName: string) {
        return new FiusRuntimeError(
            MCPErrorCode.PROMPT_NOT_FOUND,
            ErrorScope.MCP,
            ErrorType.NOT_FOUND,
            `No client found for prompt: ${promptName}`,
            { promptName }
        );
    }

    
    static resourceNotFound(resourceUri: string) {
        return new FiusRuntimeError(
            MCPErrorCode.RESOURCE_NOT_FOUND,
            ErrorScope.MCP,
            ErrorType.NOT_FOUND,
            `No client found for resource: ${resourceUri}`,
            { resourceUri }
        );
    }

    
    static clientNotConnected(context?: string) {
        return new FiusRuntimeError(
            MCPErrorCode.CONNECTION_FAILED,
            ErrorScope.MCP,
            ErrorType.SYSTEM,
            `MCP client is not connected${context ? `: ${context}` : ''}`,
            { context }
        );
    }

    
    static invalidToolSchema(toolName: string, reason: string) {
        return new FiusRuntimeError(
            MCPErrorCode.PROTOCOL_ERROR,
            ErrorScope.MCP,
            ErrorType.THIRD_PARTY,
            `Tool '${toolName}' has invalid schema: ${reason}`,
            { toolName, reason }
        );
    }
}
