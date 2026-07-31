import type { JSONSchema7 } from 'json-schema';
import type { z, ZodTypeAny } from 'zod';
import type { ToolDisplayData } from './display-types.js';
import type { WorkspaceContext } from '../workspace/types.js';
import type { ApprovalManager } from '../approval/manager.js';
import type { FiusAgent } from '../agent/FiusAgent.js';
import type { ToolStateStore } from '../storage/index.js';
import type { MCPManager } from '../mcp/manager.js';
import type { PromptManager } from '../prompts/prompt-manager.js';
import type { ResourceManager } from '../resources/manager.js';
import type { SearchService } from '../search/search-service.js';
import type { Logger } from '../logger/v2/types.js';
import type { HostRuntimeContext } from '../runtime/index.js';
import type { AgentRunContext } from '../runtime/run-context.js';
import type { SkillManager } from '../skills/index.js';
import type { WorkspaceManager } from '../workspace/index.js';


export interface TaskForker {
    fork(options: {
        task: string;
        instructions: string;
        agentId?: string;
        autoApprove?: boolean;
        toolCallId?: string;
        sessionId?: string;
    }): Promise<{
        success: boolean;
        response?: string;
        error?: string;
    }>;
}

export type TaskForkOptions = Parameters<TaskForker['fork']>[0];

export interface ToolServices {
    approval: ApprovalManager;
    search: SearchService;
    resources: ResourceManager;
    prompts: PromptManager;
    skills: SkillManager;
    mcp: MCPManager;
    taskForker: TaskForker | null;
    workspaceManager: WorkspaceManager;
}


export interface ToolExecutionContextBase {
    
    sessionId?: string | undefined;
    
    runContext?: AgentRunContext | undefined;
    
    workspaceId?: string | undefined;
    
    workspace?: WorkspaceContext | undefined;
    
    abortSignal?: AbortSignal | undefined;
    
    toolCallId?: string | undefined;
    
    hostRuntime?: HostRuntimeContext | undefined;

    
    logger: Logger;
}

export interface ToolExecutionContext extends ToolExecutionContextBase {
    
    agent?: FiusAgent | undefined;

    
    toolState?: ToolStateStore | undefined;

    
    services?: ToolServices | undefined;
}

export interface ToolExecutionResult {
    result: unknown;
    
    presentationSnapshot?: ToolPresentationSnapshotV1;
    
    meta?: import('./tool-call-metadata.js').ToolCallMetadata;
    
    requireApproval?: boolean;
    
    approvalStatus?: 'approved' | 'rejected';
}

export type ToolPresentationSnapshotV1 = {
    version: 1;

    
    source?: {
        type: 'local' | 'mcp';
        mcpServerName?: string;
    };

    
    header?: {
        title?: string;
        
        argsText?: string;
    };

    
    chips?: Array<{
        kind: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
        text: string;
    }>;

    
    args?: {
        summary?: Array<{
            label: string;
            display: string;
            kind?: 'path' | 'command' | 'url' | 'text' | 'json';
            sensitive?: boolean;
        }>;

        groups?: Array<{
            id: string;
            label: string;
            collapsedByDefault?: boolean;
            items: Array<{
                label: string;
                display: string;
                kind?: 'path' | 'command' | 'url' | 'text' | 'json';
                sensitive?: boolean;
            }>;
        }>;
    };

    
    capabilities?: string[];

    
    approval?: {
        actions?: Array<
            | {
                  id: string;
                  label: string;
                  kind?: 'primary' | 'secondary' | 'danger';
                  responseData?: Record<string, unknown>;
                  uiEffects?: UiEffect[];
              }
            | {
                  id: string;
                  label: string;
                  kind?: 'danger';
                  denyWithFeedback?: {
                      placeholder?: string;
                      messageTemplate?: string;
                  };
              }
        >;
    };

    
    result?: {
        summaryText?: string;
        uiEffects?: UiEffect[];
    };
};


export type UiEffect =
    | {
          type: 'setFlag';
          flag: 'autoApproveEdits';
          value: boolean;
      }
    | {
          type: 'toast';
          kind: 'info' | 'warning' | 'success' | 'error';
          message: string;
    };

export interface Tool<TSchema extends ZodTypeAny = ZodTypeAny> {
    
    id: string;

    
    description: string;

    
    getDescription?: ((context: ToolExecutionContext) => Promise<string> | string) | undefined;

    
    inputSchema: TSchema;

    
    execute(input: z.output<TSchema>, context: ToolExecutionContext): Promise<unknown> | unknown;

    
    needsApproval?: ToolNeedsApproval<TSchema> | undefined;

    
    presentation?: ToolPresentation<TSchema> | undefined;

    
    aliases?: string[] | undefined;
}

export type ToolApprovalDecision = boolean | string | null;

export type ToolNeedsApproval<TSchema extends ZodTypeAny = ZodTypeAny> =
    | ToolApprovalDecision
    | ((
          input: z.output<TSchema>,
          context: ToolExecutionContext
      ) => Promise<ToolApprovalDecision> | ToolApprovalDecision);

export interface ToolPresentation<TSchema extends ZodTypeAny = ZodTypeAny> {
    
    preview?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ): Promise<ToolDisplayData | null> | ToolDisplayData | null;

    
    describeHeader?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ):
        | Promise<ToolPresentationSnapshotV1['header'] | null>
        | ToolPresentationSnapshotV1['header']
        | null;

    
    describeArgs?(
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ):
        | Promise<ToolPresentationSnapshotV1['args'] | null>
        | ToolPresentationSnapshotV1['args']
        | null;

    
    describeResult?(
        result: unknown,
        input: z.output<TSchema>,
        context: ToolExecutionContext
    ):
        | Promise<ToolPresentationSnapshotV1['result'] | null>
        | ToolPresentationSnapshotV1['result']
        | null;
}


export interface ToolSet {
    [key: string]: {
        name?: string;
        description?: string;
        parameters: JSONSchema7;
        _meta?: Record<string, unknown>;
    };
}

export interface ToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
}


export interface ToolProvider {
    getTools(): Promise<ToolSet>;
    callTool(
        toolName: string,
        args: Record<string, unknown>,
        context?: Pick<ToolExecutionContextBase, 'sessionId' | 'runContext'>
    ): Promise<unknown>;
}
