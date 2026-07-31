import { MCPManager } from '../mcp/manager.js';
import type { SessionPromptContributor } from './schemas.js';
import type { WorkspaceContext } from '../workspace/types.js';

export type EnvironmentContext = {
    cwd?: string;
    platform?: string;
    shell?: string;
    isGitRepo?: boolean;
};

export type SessionContext = {
    id: string;
    systemPromptContributors?: SessionPromptContributor[];
};

export interface DynamicContributorContext {
    mcpManager: MCPManager;
    workspace?: WorkspaceContext | null;
    environment?: EnvironmentContext;
    session?: SessionContext | null;
    buildMode?: 'build' | 'plan';
}

export type DynamicContributorContextOverrides = Partial<DynamicContributorContext>;
export type DynamicContributorContextFactory = () =>
    | DynamicContributorContextOverrides
    | Promise<DynamicContributorContextOverrides>;

export interface SystemPromptContributor {
    id: string;
    priority: number;
    getContent(context: DynamicContributorContext): Promise<string>;
}
