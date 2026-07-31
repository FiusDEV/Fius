
export { toError } from './utils/error-conversion.js';
export { zodToIssues } from './utils/result.js';
export { EnvExpandedString } from './utils/result.js';
export { ErrorScope, ErrorType } from './errors/types.js';

export type { Issue, Severity, FiusErrorCode } from './errors/types.js';

export type {
    InternalMessage,
    SystemMessage,
    UserMessage,
    AssistantMessage,
    ToolMessage,
    TextPart,
    FilePart,
    ImageData,
    FileData,
    UIResourcePart,
    ContentPart,
    ToolCall,
    ToolApprovalStatus,
    } from './context/types.js';

export {
    isSystemMessage,
    isUserMessage,
    isAssistantMessage,
    isToolMessage,
    isTextPart,
    isImagePart,
    isFilePart,
    isUIResourcePart,
    } from './context/types.js';

export { getFileMediaKind, getResourceKind } from './context/media-helpers.js';

export type { LLMProvider } from '@fius/llm';
export { LLM_PROVIDERS } from '@fius/llm';

export type { McpServerType, McpConnectionMode } from './mcp/schemas.js';
export {
    MCP_SERVER_TYPES,
    MCP_CONNECTION_MODES,
    DEFAULT_MCP_CONNECTION_MODE,
    } from './mcp/schemas.js';

export { StorageErrorCode } from './storage/error-codes.js';

export type { PermissionsMode, AllowedToolsStorageType } from './tools/schemas.js';
export {
    PERMISSIONS_MODES,
    ALLOWED_TOOLS_STORAGE_TYPES,
    DEFAULT_PERMISSIONS_MODE,
    DEFAULT_ALLOWED_TOOLS_STORAGE,
    } from './tools/schemas.js';

export {
    APPROVAL_TYPES,
    APPROVAL_STATUSES,
    DENIAL_REASONS,
    ApprovalStatus,
    ApprovalType,
    DenialReason,
} from './approval/types.js';
export type { ApprovalRequest, ApprovalResponse } from './approval/types.js';

export type { SessionMetadata } from './session/session-manager.js';

export type { WorkspaceContext, SetWorkspaceInput } from './workspace/types.js';

export { PROMPT_GENERATOR_SOURCES } from './systemPrompt/registry.js';
export type { ContributorConfig, SystemPromptConfig } from './systemPrompt/schemas.js';

export type {
    SearchOptions,
    SearchResult,
    SessionSearchResult,
    SearchResponse,
    SessionSearchResponse,
    } from './search/types.js';

export type { AgentEventMap, SessionEventMap } from './events/index.js';
export type { ToolCallMetadata } from './tools/tool-call-metadata.js';
export type { HostRuntimeContext, HostRuntimeIds } from './runtime/host-runtime.js';

export type { ModelInfo, ProviderInfo } from '@fius/llm';
export type { SupportedFileType } from '@fius/llm';

export type { ResourceMetadata } from './resources/types.js';
export type { ResourceReference } from './resources/reference-parser.js';
export {
    parseResourceReferences,
    resolveResourceReferences,
} from './resources/reference-parser.js';
