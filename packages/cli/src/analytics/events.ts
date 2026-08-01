import type { ExecutionContext } from '@fiusdev/agent-management';
import type { SharedAnalyticsEventMap } from '@fiusdev/analytics';

export interface BaseEventContext {
    app?: 'fius';
    app_version?: string;
    node_version?: string;
    os_platform?: NodeJS.Platform;
    os_release?: string;
    os_arch?: string;
    execution_context?: ExecutionContext;
    session_id?: string | null;
}

export interface CommandArgsMeta {
    argTypes: string[];
    positionalRaw?: string[];
    positionalCount?: number;
    optionKeys?: string[];
    options?: Record<string, SanitizedOptionValue>;
}

export type SanitizedOptionValue =
    | string
    | number
    | boolean
    | null
    | { type: 'array'; length: number }
    | { type: 'object' };

export type CliCommandPhase = 'start' | 'end' | 'timeout';

interface CliCommandBaseEvent {
    name: string;
    phase: CliCommandPhase;
    args?: CommandArgsMeta;
}

export interface CliCommandStartEvent extends CliCommandBaseEvent {
    phase: 'start';
}

export interface CliCommandEndEvent extends CliCommandBaseEvent {
    phase: 'end';
    success: boolean;
    durationMs: number;
    error?: string;
    reason?: string;
    command?: string;
}

export interface CliCommandTimeoutEvent extends CliCommandBaseEvent {
    phase: 'timeout';
    timeoutMs: number;
}

export type CliCommandEvent = CliCommandStartEvent | CliCommandEndEvent | CliCommandTimeoutEvent;

export interface PromptEvent {
    mode: 'cli';
    provider: string;
    model: string;
}

export interface SetupEvent {
    provider: string;
    model: string;
    hadApiKeyBefore?: boolean;
    setupMode: 'interactive' | 'non-interactive';
    setupVariant?: 'quick-start' | 'custom' | 'codex-chatgpt' | 'openrouter';
    defaultMode?: string;
    hasBaseURL?: boolean;
    apiKeySkipped?: boolean;
}

export interface InstallAgentEvent {
    agent: string;
    status: 'installed' | 'skipped' | 'failed';
    force: boolean;
    reason?: string;
    error_message?: string;
}

export interface InstallAggregateEvent {
    requested: string[];
    installed: string[];
    skipped: string[];
    failed: string[];
    successCount: number;
    errorCount: number;
}

export interface UninstallAgentEvent {
    agent: string;
    status: 'uninstalled' | 'failed';
    force: boolean;
    error_message?: string;
}

export interface UninstallAggregateEvent {
    requested: string[];
    uninstalled: string[];
    failed: string[];
    successCount: number;
    errorCount: number;
}

export interface CreateProjectEvent {
    provider: string;
    providedKey: boolean;
}

export interface InitProjectEvent {
    provider: string;
    providedKey: boolean;
}

/**
 * CLI analytics event map extending shared events with CLI-specific events.
 *
 * IMPORTANT: If an event is also tracked by WebUI, move it to SharedAnalyticsEventMap
 * in @fiusdev/analytics to avoid duplication.
 */
export interface FiusAnalyticsEventMap extends SharedAnalyticsEventMap {
    fius_cli_command: CliCommandEvent;
    fius_prompt: PromptEvent;
    fius_setup: SetupEvent;
    fius_install_agent: InstallAgentEvent;
    fius_install: InstallAggregateEvent;
    fius_uninstall_agent: UninstallAgentEvent;
    fius_uninstall: UninstallAggregateEvent;
    fius_create: CreateProjectEvent;
    fius_init: InitProjectEvent;
}

export type AnalyticsEventName = keyof FiusAnalyticsEventMap;

export type AnalyticsEventPayload<Name extends AnalyticsEventName> = FiusAnalyticsEventMap[Name];
