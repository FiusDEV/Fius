
export enum MCPErrorCode {
    SCHEMA_VALIDATION = 'mcp_schema_validation',
    COMMAND_MISSING = 'mcp_command_missing',
    DUPLICATE_NAME = 'mcp_duplicate_name',

    CONNECTION_FAILED = 'mcp_connection_failed',
    DISCONNECTION_FAILED = 'mcp_disconnection_failed',
    AUTH_REQUIRED = 'mcp_auth_required',

    PROTOCOL_ERROR = 'mcp_protocol_error',

    SERVER_NOT_FOUND = 'mcp_server_not_found',
    TOOL_NOT_FOUND = 'mcp_tool_not_found',
    PROMPT_NOT_FOUND = 'mcp_prompt_not_found',
    RESOURCE_NOT_FOUND = 'mcp_resource_not_found',
}
