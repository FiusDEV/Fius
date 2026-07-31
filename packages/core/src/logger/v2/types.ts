export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silly';

export enum FiusLogComponent {
    AGENT = 'agent',
    LLM = 'llm',
    CONFIG = 'config',
    CONTEXT = 'context',
    SESSION = 'session',
    MCP = 'mcp',
    TOOLS = 'tools',
    STORAGE = 'storage',
    SYSTEM_PROMPT = 'system_prompt',
    RESOURCE = 'resource',
    PROMPT = 'prompt',
    MEMORY = 'memory',
    HOOK = 'hook',
    FILESYSTEM = 'filesystem',
    PROCESS = 'process',
    APPROVAL = 'approval',

    API = 'api',
    CLI = 'cli',
    EXECUTOR = 'executor',
}

export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: string;
    component: FiusLogComponent;
    agentId: string;
    sessionId?: string;
    context?: Record<string, unknown> | undefined;
}

export type Logger = {
    debug(message: string, context?: Record<string, unknown>): void;

    silly(message: string, context?: Record<string, unknown>): void;

    createChild(component: FiusLogComponent): Logger;

    createFileOnlyChild(component: FiusLogComponent): Logger;

    info(message: string, context?: Record<string, unknown>): void;

    warn(message: string, context?: Record<string, unknown>): void;

    error(message: string, context?: Record<string, unknown>): void;

    trackException(error: Error, context?: Record<string, unknown>): void;

    createChild(component: FiusLogComponent): Logger;

    setLevel(level: LogLevel): void;

    getLevel(): LogLevel;

    getLogFilePath(): string | null;

    destroy(): Promise<void>;
};

export type LoggerTransport = {
    write(entry: LogEntry): void | Promise<void>;

    destroy?(): void | Promise<void>;
};
