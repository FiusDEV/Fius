

import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import type {
    CodexRateLimitSnapshot,
    ToolDisplayData,
    ContentPart,
    McpConnectionStatus,
    McpServerType,
} from '@fius/core';
import type { LLMProvider, ReasoningVariant } from '@fius/llm';


export interface UpdateInfo {
    current: string;
    latest: string;
    updateCommand: string;
}


export interface StartupInfo {
    connectedServers: { count: number; names: string[] };
    failedConnections: string[];
    toolCount: number;
    logFile: string | null;
    
    updateInfo?: UpdateInfo | undefined;
    
    needsAgentSync?: boolean | undefined;
}


export type ToolStatus = 'pending' | 'pending_approval' | 'running' | 'finished';


export type StyledMessageType =
    | 'config'
    | 'stats'
    | 'help'
    | 'session-list'
    | 'session-history'
    | 'log-config'
    | 'run-summary'
    | 'prompts'
    | 'sysprompt'
    | 'shortcuts'
    | 'external-trigger';


export interface ConfigStyledData {
    configFilePath: string | null;
    provider: string;
    model: string;
    maxTokens: number | null;
    temperature: number | null;
    permissionsMode: string;
    maxSessions: string;
    sessionTTL: string;
    mcpServers: string[];
    promptsCount: number;
    hooksEnabled: string[];
}

export interface StatsStyledData {
    sessions: {
        total: number;
        inMemory: number;
        maxAllowed: number;
    };
    mcp: {
        connected: number;
        failed: number;
        toolCount: number;
    };
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        totalTokens: number;
    };
    estimatedCost?: number;
}

export interface HelpStyledData {
    commands: Array<{
        name: string;
        description: string;
        category: string;
    }>;
}

export interface SessionListStyledData {
    sessions: Array<{
        id: string;
        messageCount: number;
        lastActive: string;
        isCurrent: boolean;
    }>;
    total: number;
}

export interface SessionHistoryStyledData {
    sessionId: string;
    messages: Array<{
        role: string;
        content: string;
        timestamp: string;
    }>;
    total: number;
}

export interface RunSummaryStyledData {
    
    durationMs: number;
    
    totalTokens: number;
}

export interface ExternalTriggerStyledData {
    label: string;
    source: 'scheduler' | 'a2a' | 'api' | 'external';
    timestamp: Date | string;
}

export interface PromptsStyledData {
    mcpPrompts: Array<{
        name: string;
        title?: string;
        description?: string;
        args?: string[];
    }>;
    configPrompts: Array<{
        name: string;
        title?: string;
        description?: string;
    }>;
    customPrompts: Array<{
        name: string;
        title?: string;
        description?: string;
    }>;
    total: number;
}

export interface SysPromptStyledData {
    content: string;
}

export interface ShortcutsStyledData {
    categories: Array<{
        name: string;
        shortcuts: Array<{
            keys: string;
            description: string;
        }>;
    }>;
}

export type StyledData =
    | ConfigStyledData
    | StatsStyledData
    | HelpStyledData
    | SessionListStyledData
    | SessionHistoryStyledData
    | RunSummaryStyledData
    | ExternalTriggerStyledData
    | PromptsStyledData
    | SysPromptStyledData
    | ShortcutsStyledData;


export interface SubAgentProgress {
    
    task: string;
    
    agentId: string;
    
    runtimeAgentId?: string;
    
    subAgentLogFilePath?: string;
    
    toolsCalled: number;
    
    currentTool: string;
    
    currentArgs?: Record<string, unknown> | undefined;
    
    tokenUsage?: {
        input: number;
        output: number;
        total: number;
    };
}


export type TodoStatus = 'pending' | 'in_progress' | 'completed';


export interface TodoItem {
    id: string;
    sessionId: string;
    content: string;
    activeForm: string;
    status: TodoStatus;
    position: number;
    createdAt: Date | string;
    updatedAt: Date | string;
}


export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    
    reasoning?: string | undefined;
    timestamp: Date;
    isStreaming?: boolean;
    toolResult?: string; // Tool result preview (first 4-5 lines)
    toolStatus?: ToolStatus; // Status for tool messages (running/finished)
    isError?: boolean; // True if tool execution failed
    styledType?: StyledMessageType; // Type of styled rendering (if any)
    styledData?: StyledData; // Structured data for styled rendering
    
    isContinuation?: boolean;
    
    isQueued?: boolean;
    
    queuePosition?: number;
    
    toolDisplayData?: ToolDisplayData;
    
    toolContent?: ContentPart[];
    
    subAgentProgress?: SubAgentProgress;
}


export interface StreamingMessage {
    id: string;
    content: string;
}


export interface PendingImage {
    
    id: string;
    
    data: string;
    
    mimeType: string;
    
    placeholder: string;
}


export interface PastedBlock {
    
    id: string;
    
    number: number;
    
    fullText: string;
    
    lineCount: number;
    
    isCollapsed: boolean;
    
    placeholder: string;
}


export interface InputState {
    value: string;
    history: string[];
    historyIndex: number;
    draftBeforeHistory: string;
    
    images: PendingImage[];
    
    pastedBlocks: PastedBlock[];
    
    pasteCounter: number;
    
    editingQueuedFollowUp: boolean;
}

export interface InsufficientCreditsState {
    balanceUsd: number | null;
}


export type OverlayType =
    | 'none'
    | 'slash-autocomplete'
    | 'resource-autocomplete'
    | 'model-selector'
    | 'providers-selector'
    | 'reasoning'
    | 'custom-model-wizard'
    | 'session-selector'
    | 'mcp-server-list'
    | 'mcp-server-actions'
    | 'mcp-add-choice'
    | 'mcp-add-selector'
    | 'mcp-github-browser'
    | 'mcp-custom-type-selector'
    | 'mcp-custom-wizard'
    | 'stream-selector'
    | 'sounds-selector'
    | 'session-subcommand-selector'
    | 'api-key-input'
    | 'models-dev-browser'
    | 'chatgpt-usage-cap'
    | 'insufficient-credits'
    | 'login'
    | 'logout'
    | 'connect'
    | 'search'
    | 'approval'
    | 'tool-browser'
    | 'prompt-list'
    | 'prompt-add-choice'
    | 'prompt-add-wizard'
    | 'prompt-delete-selector'
    | 'session-rename'
    | 'context-stats'
    | 'export-wizard'
    | 'plugin-manager'
    | 'plugin-list'
    | 'plugin-actions'
    | 'plugin-github'
    | 'custom-plugin-install'
    | 'marketplace-browser'
    | 'marketplace-add'
    | 'command-output'
    | 'access-mode-selector'
    | 'build-mode-selector'
    | 'skills-list'
    | 'skill-actions';


export interface CommandOutputState {
    title: string;
    content: string;
}


export type McpWizardServerType = McpServerType | null;


export interface SelectedMcpServer {
    name: string;
    enabled: boolean;
    status: McpConnectionStatus;
    type: McpServerType;
}


export interface SelectedSkill {
    id: string;
    displayName: string;
    description?: string;
    enabled: boolean;
}


export interface PendingModelSwitch {
    provider: LLMProvider;
    model: string;
    displayName?: string;
    baseURL?: string;
    reasoningVariant?: ReasoningVariant;
}


export type PromptAddScope = 'agent' | 'shared';

export interface PromptAddWizardState {
    scope: PromptAddScope;
    step: 'name' | 'title' | 'description' | 'content';
    name: string;
    title: string;
    description: string;
    content: string;
}


export interface HistorySearchState {
    isActive: boolean;
    query: string;
    matchIndex: number; // Index into filtered matches (0 = most recent match)
    originalInput: string; // Cached input to restore on Escape
    lastMatch: string; // Last valid match (preserved when no results)
}


export interface UIState {
    isProcessing: boolean;
    isCancelling: boolean; // True when cancellation is in progress
    isThinking: boolean; // True when LLM is thinking (before streaming starts)
    isCompacting: boolean; // True when context is being compacted
    activeOverlay: OverlayType;
    
    showReasoning: boolean;
    exitWarningShown: boolean; // True when first Ctrl+C was pressed (pending second to exit)
    exitWarningTimestamp: number | null; // Timestamp of first Ctrl+C for timeout
    mcpWizardServerType: McpWizardServerType; // Server type for MCP custom wizard
    copyModeEnabled: boolean; // True when copy mode is active (mouse events disabled for text selection)
    pendingModelSwitch: PendingModelSwitch | null; // Pending model switch waiting for API key
    selectedMcpServer: SelectedMcpServer | null; // Selected server for MCP actions screen
    selectedSkill: SelectedSkill | null; // Selected skill for skill actions screen
    historySearch: HistorySearchState; // Ctrl+R reverse history search
    promptAddWizard: PromptAddWizardState | null; // Prompt add wizard state
    autoApproveEdits: boolean; // True when edit mode is on (auto-approve edit_file/write_file)
    bypassPermissions: boolean; // True when bypass permissions mode is on (auto-approve all approvals)
    buildMode: 'build' | 'plan'; // Build = execute, Plan = think only
    todoExpanded: boolean; // True when todo list is expanded (shows all tasks), false when collapsed (shows current task only)
    backgroundTasksRunning: number; // Count of running background tasks
    backgroundTasksExpanded: boolean; // True when background task list is expanded
    backgroundTasks: Array<{
        taskId: string;
        status: 'running' | 'completed' | 'failed' | 'cancelled';
        description?: string;
    }>; // Snapshot of background tasks
    
    chatgptRateLimitStatus: CodexRateLimitSnapshot | null;
    insufficientCredits: InsufficientCreditsState | null;
    commandOutput: CommandOutputState | null; // Command output modal state
}


export interface SessionState {
    id: string | null;
    hasActiveSession: boolean;
    modelName: string; // Current model name
}


export interface CLIState {
    // Input state
    input: InputState;

    // UI state
    ui: UIState;

    // Session state
    session: SessionState;

    // Approval state
    approval: ApprovalRequest | null;
    approvalQueue: ApprovalRequest[]; // Queue for pending approvals
}
