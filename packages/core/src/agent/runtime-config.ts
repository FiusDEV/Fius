import type { LLMConfig, ValidatedLLMConfig } from '../llm/schemas.js';
import type { ServersConfig, ValidatedServersConfig } from '../mcp/schemas.js';
import type { MemoriesConfig, ValidatedMemoriesConfig } from '../memory/schemas.js';
import type { ResourcesConfig, ValidatedResourcesConfig } from '../resources/schemas.js';
import type { SessionConfig, ValidatedSessionConfig } from '../session/schemas.js';
import type { SystemPromptConfig, ValidatedSystemPromptConfig } from '../systemPrompt/schemas.js';
import type {
    ElicitationConfig,
    PermissionsConfig,
    ValidatedPermissionsConfig,
    ValidatedElicitationConfig,
} from '../tools/schemas.js';
import type { PromptsConfig, ValidatedPromptsConfig } from '../prompts/schemas.js';
import type { AgentCard, ValidatedAgentCard } from './schemas.js';


export interface AgentRuntimeSettings {
    systemPrompt: ValidatedSystemPromptConfig;
    llm: ValidatedLLMConfig;

    agentCard?: ValidatedAgentCard | undefined;
    greeting?: string | undefined;
    memories?: ValidatedMemoriesConfig | undefined;

    agentId: string;
    mcpServers: ValidatedServersConfig;
    sessions: ValidatedSessionConfig;

    permissions: ValidatedPermissionsConfig;
    elicitation: ValidatedElicitationConfig;

    resources: ValidatedResourcesConfig;
    prompts: ValidatedPromptsConfig;
    usageScopeId?: string | undefined;
}


export interface FiusAgentConfigInput {
    systemPrompt: SystemPromptConfig;
    llm: LLMConfig;

    agentCard?: AgentCard | undefined;
    greeting?: string | undefined;
    memories?: MemoriesConfig | undefined;

    agentId: string;
    mcpServers?: ServersConfig | undefined;
    sessions?: SessionConfig | undefined;

    permissions?: PermissionsConfig | undefined;
    elicitation?: ElicitationConfig | undefined;

    resources?: ResourcesConfig | undefined;
    prompts?: PromptsConfig | undefined;
    usageScopeId?: string | undefined;
}
