import { FiusRuntimeError, ErrorScope, ErrorType } from '../errors/index.js';
import { HookErrorCode } from './error-codes.js';
import { getContext } from '../utils/async-context.js';
import type { ExtensionPoint, HookExecutionContext, Hook, HookResult } from './types.js';
import type { AgentEventBus } from '../events/index.js';
import type { FiusStores } from '../storage/index.js';
import type { SessionManager } from '../session/index.js';
import type { MCPManager } from '../mcp/manager.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { Logger } from '../logger/v2/types.js';
import { FiusLogComponent } from '../logger/v2/types.js';
import type { AgentRunContext } from '../runtime/run-context.js';

export interface HookManagerOptions {
    agentEventBus: AgentEventBus;
    stores: FiusStores;
}

export interface HookExecutionContextOptions {
    sessionManager: SessionManager;
    mcpManager: MCPManager;
    toolManager: ToolManager;
    stateManager: AgentStateManager;
    runContext?: AgentRunContext | undefined;
    sessionId?: string;
    abortSignal?: AbortSignal;
}

export class HookManager {
    private hooks: Hook[] = [];
    private hooksByExtensionPoint: Map<ExtensionPoint, Hook[]> = new Map();
    private hookNameByInstance: WeakMap<Hook, string> = new WeakMap();
    private options: HookManagerOptions;
    private initialized: boolean = false;
    private logger: Logger;

    private static readonly DEFAULT_TIMEOUT = 5000;

    constructor(options: HookManagerOptions, hooks: Hook[], logger: Logger) {
        this.options = options;
        this.logger = logger.createChild(FiusLogComponent.HOOK);
        this.setHooks(hooks);
        this.logger.debug('HookManager created');
    }

    setHooks(hooks: Hook[]): void {
        if (this.initialized) {
            throw new FiusRuntimeError(
                HookErrorCode.HOOK_CONFIGURATION_INVALID,
                ErrorScope.HOOK,
                ErrorType.SYSTEM,
                'Cannot set hooks after initialization'
            );
        }

        this.hooks = [...hooks];
        this.hooksByExtensionPoint.clear();
        this.hookNameByInstance = new WeakMap();
        for (const [index, hook] of this.hooks.entries()) {
            this.hookNameByInstance.set(hook, this.deriveHookName(hook, index));
        }
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            throw new FiusRuntimeError(
                HookErrorCode.HOOK_CONFIGURATION_INVALID,
                ErrorScope.HOOK,
                ErrorType.SYSTEM,
                'HookManager already initialized'
            );
        }

        for (const [index, hook] of this.hooks.entries()) {
            this.assertValidHookShape(hook, index);
            this.registerToExtensionPoints(hook);
        }

        for (const [extensionPoint, hooks] of this.hooksByExtensionPoint.entries()) {
            this.logger.debug(
                `Extension point '${extensionPoint}': ${hooks.length} hook(s) registered`
            );
        }

        this.initialized = true;
        this.logger.info(`HookManager initialized with ${this.hooks.length} hook(s)`);
    }

    private registerToExtensionPoints(hook: Hook): void {
        const extensionPoints: ExtensionPoint[] = [
            'beforeLLMRequest',
            'beforeToolCall',
            'afterToolResult',
            'beforeResponse',
        ];

        for (const point of extensionPoints) {
            if (typeof hook[point] === 'function') {
                if (!this.hooksByExtensionPoint.has(point)) {
                    this.hooksByExtensionPoint.set(point, []);
                }
                this.hooksByExtensionPoint.get(point)!.push(hook);
            }
        }
    }

    async executeHooks<T extends object>(
        extensionPoint: ExtensionPoint,
        payload: T,
        options: HookExecutionContextOptions
    ): Promise<T> {
        const hooks = this.hooksByExtensionPoint.get(extensionPoint) || [];
        if (hooks.length === 0) {
            return payload;
        }

        if (payload === null || typeof payload !== 'object') {
            throw new FiusRuntimeError(
                HookErrorCode.HOOK_INVALID_SHAPE,
                ErrorScope.HOOK,
                ErrorType.USER,
                `Payload for ${extensionPoint} must be an object (got ${payload === null ? 'null' : typeof payload})`,
                { extensionPoint, payloadType: typeof payload }
            );
        }

        let currentPayload = { ...(payload as Record<string, unknown>) } as T;

        const asyncCtx = getContext();
        const sessionId = options.runContext?.sessionId ?? options.sessionId;
        const runtimeConfig = options.stateManager.getRuntimeConfig(sessionId);
        const llmConfig = runtimeConfig.llm;

        const context: HookExecutionContext = {
            sessionId: sessionId ?? undefined,
            userId: asyncCtx?.userId ?? undefined,
            tenantId: asyncCtx?.tenantId ?? undefined,
            hostRuntime: options.runContext?.hostRuntime,
            llmConfig,
            logger: this.logger,
            abortSignal: options.abortSignal ?? undefined,
            agent: {
                sessionManager: options.sessionManager,
                mcpManager: options.mcpManager,
                toolManager: options.toolManager,
                stateManager: options.stateManager,
                agentEventBus: this.options.agentEventBus,
                stores: this.options.stores,
            },
        };

        for (const [index, hook] of hooks.entries()) {
            const method = hook[extensionPoint];
            if (!method) continue;

            const hookName = this.hookNameByInstance.get(hook) ?? this.deriveHookName(hook, index);
            const startTime = Date.now();

            try {
                const result = await this.executeWithTimeout<HookResult>(
                    (
                        method as unknown as (
                            payload: T,
                            context: HookExecutionContext
                        ) => Promise<HookResult>
                    ).call(hook, currentPayload, context),
                    hookName,
                    HookManager.DEFAULT_TIMEOUT
                );

                const duration = Date.now() - startTime;

                this.logger.debug(`Hook '${hookName}' executed at ${extensionPoint}`, {
                    ok: result.ok,
                    cancelled: result.cancel,
                    duration,
                    hasModifications: !!result.modify,
                });

                if (result.notices && result.notices.length > 0) {
                    for (const notice of result.notices) {
                        const level =
                            notice.kind === 'block' || notice.kind === 'warn' ? 'warn' : 'info';
                        this.logger[level](`Hook notice (${notice.kind}): ${notice.message}`, {
                            hook: hookName,
                            code: notice.code,
                            details: notice.details,
                        });
                    }
                }

                if (!result.ok) {
                    this.logger.warn(`Hook '${hookName}' returned error`, {
                        message: result.message,
                    });

                    if (result.cancel) {
                        throw new FiusRuntimeError(
                            HookErrorCode.HOOK_BLOCKED_EXECUTION,
                            ErrorScope.HOOK,
                            ErrorType.FORBIDDEN,
                            result.message || `Operation blocked by hook '${hookName}'`,
                            {
                                hook: hookName,
                                extensionPoint,
                                notices: result.notices,
                            }
                        );
                    }

                    continue;
                }

                if (result.modify) {
                    currentPayload = {
                        ...(currentPayload as Record<string, unknown>),
                        ...result.modify,
                    } as T;
                    this.logger.debug(`Hook '${hookName}' modified payload`, {
                        keys: Object.keys(result.modify),
                    });
                }

                if (result.cancel) {
                    throw new FiusRuntimeError(
                        HookErrorCode.HOOK_BLOCKED_EXECUTION,
                        ErrorScope.HOOK,
                        ErrorType.FORBIDDEN,
                        result.message || `Operation cancelled by hook '${hookName}'`,
                        {
                            hook: hookName,
                            extensionPoint,
                            notices: result.notices,
                        }
                    );
                }
            } catch (error) {
                const duration = Date.now() - startTime;

                if (error instanceof FiusRuntimeError) {
                    throw error;
                }

                this.logger.error(`Hook '${hookName}' threw error`, {
                    error: error instanceof Error ? error.message : String(error),
                    duration,
                });

                throw new FiusRuntimeError(
                    HookErrorCode.HOOK_EXECUTION_FAILED,
                    ErrorScope.HOOK,
                    ErrorType.SYSTEM,
                    `Hook '${hookName}' failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    {
                        hook: hookName,
                        extensionPoint,
                    }
                );
            }
        }

        return currentPayload;
    }

    private async executeWithTimeout<T>(
        promise: Promise<T>,
        hookName: string,
        ms: number
    ): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        return await new Promise<T>((resolve, reject) => {
            timer = setTimeout(() => {
                reject(
                    new FiusRuntimeError(
                        HookErrorCode.HOOK_EXECUTION_TIMEOUT,
                        ErrorScope.HOOK,
                        ErrorType.TIMEOUT,
                        `Hook '${hookName}' execution timed out after ${ms}ms`
                    )
                );
            }, ms);
            promise.then(
                (val) => {
                    if (timer) clearTimeout(timer);
                    resolve(val);
                },
                (err) => {
                    if (timer) clearTimeout(timer);
                    reject(err);
                }
            );
        });
    }

    async cleanup(): Promise<void> {
        for (const [index, hook] of this.hooks.entries()) {
            const hookName = this.hookNameByInstance.get(hook) ?? this.deriveHookName(hook, index);
            if (hook.cleanup) {
                try {
                    await hook.cleanup();
                    this.logger.debug(`Hook cleaned up: ${hookName}`);
                } catch (error) {
                    this.logger.error(`Hook cleanup failed: ${hookName}`, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
        this.logger.info('HookManager cleanup complete');
    }

    getStats(): {
        total: number;
        enabled: number;
        byExtensionPoint: Record<ExtensionPoint, number>;
    } {
        const byExtensionPoint: Record<string, number> = {};
        for (const [point, hooks] of this.hooksByExtensionPoint.entries()) {
            byExtensionPoint[point] = hooks.length;
        }

        return {
            total: this.hooks.length,
            enabled: this.hooks.length,
            byExtensionPoint: byExtensionPoint as Record<ExtensionPoint, number>,
        };
    }

    getHookNames(): string[] {
        return this.hooks.map((hook, index) => {
            return this.hookNameByInstance.get(hook) ?? this.deriveHookName(hook, index);
        });
    }

    private deriveHookName(hook: Hook, index: number): string {
        const maybeNamed = hook as unknown as { name?: unknown };
        if (typeof maybeNamed.name === 'string' && maybeNamed.name.trim().length > 0) {
            return maybeNamed.name;
        }

        const ctorName = (hook as { constructor?: { name?: unknown } }).constructor?.name;
        if (typeof ctorName === 'string' && ctorName !== 'Object' && ctorName.trim().length > 0) {
            return ctorName;
        }

        return `hook#${index + 1}`;
    }

    private assertValidHookShape(hook: Hook, index: number): void {
        const extensionPoints: ExtensionPoint[] = [
            'beforeLLMRequest',
            'beforeToolCall',
            'afterToolResult',
            'beforeResponse',
        ];

        const hasExtensionPoint = extensionPoints.some(
            (point) => typeof hook[point] === 'function'
        );

        if (!hasExtensionPoint) {
            throw new FiusRuntimeError(
                HookErrorCode.HOOK_INVALID_SHAPE,
                ErrorScope.HOOK,
                ErrorType.USER,
                `Hook '${this.deriveHookName(hook, index)}' must implement at least one extension point method`,
                { availableExtensionPoints: extensionPoints }
            );
        }
    }
}
