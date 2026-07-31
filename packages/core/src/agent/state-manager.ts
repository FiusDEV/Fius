import type { Logger } from '../logger/v2/types.js';
import { FiusLogComponent } from '../logger/v2/types.js';
import type { AgentRuntimeSettings } from './runtime-config.js';
import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { ValidatedMcpServerConfig } from '../mcp/schemas.js';
import type { AgentEventBus } from '../events/index.js';


export interface SessionOverride {
    
    llm?: ValidatedLLMConfig;
}


export class AgentStateManager {
    private runtimeConfig: AgentRuntimeSettings;
    private readonly baselineConfig: AgentRuntimeSettings;
    private sessionOverrides: Map<string, SessionOverride> = new Map();
    private logger: Logger;

    
    constructor(
        staticConfig: AgentRuntimeSettings,
        private agentEventBus: AgentEventBus,
        logger: Logger
    ) {
        this.baselineConfig = structuredClone(staticConfig);
        this.runtimeConfig = structuredClone(staticConfig);
        this.logger = logger.createChild(FiusLogComponent.AGENT);

        this.logger.debug('AgentStateManager initialized', {
            staticConfigKeys: Object.keys(this.baselineConfig),
            mcpServerCount: Object.keys(this.runtimeConfig.mcpServers).length,
        });
    }



    
    public getRuntimeConfig(sessionId?: string): Readonly<AgentRuntimeSettings> {
        if (!sessionId) {
            return structuredClone(this.runtimeConfig);
        }

        const override = this.sessionOverrides.get(sessionId);
        if (!override) {
            return structuredClone(this.runtimeConfig);
        }

        return {
            ...this.runtimeConfig,
            llm: { ...this.runtimeConfig.llm, ...override.llm },
        };
    }



    
    public updateLLM(validatedConfig: ValidatedLLMConfig, sessionId?: string): void {
        const oldValue = sessionId ? this.getRuntimeConfig(sessionId).llm : this.runtimeConfig.llm;

        if (sessionId) {
            this.setSessionOverride(sessionId, {
                llm: validatedConfig,
            });
        } else {
            this.runtimeConfig.llm = validatedConfig;
        }

        this.agentEventBus.emit('state:changed', {
            field: 'llm',
            oldValue,
            newValue: validatedConfig,
            ...(sessionId && { sessionId }),
        });

        this.logger.info('LLM config updated', {
            sessionId,
            provider: validatedConfig.provider,
            model: validatedConfig.model,
            isSessionSpecific: !!sessionId,
        });
    }



    
    public setMcpServer(serverName: string, validatedConfig: ValidatedMcpServerConfig): void {
        this.logger.debug(`Setting MCP server: ${serverName}`);

        const isUpdate = serverName in this.runtimeConfig.mcpServers;
        this.runtimeConfig.mcpServers[serverName] = validatedConfig;

        const eventName = isUpdate ? 'mcp:server-updated' : 'mcp:server-added';
        this.agentEventBus.emit(eventName, { serverName, config: validatedConfig });

        this.agentEventBus.emit('state:changed', {
            field: 'mcpServers',
            oldValue: isUpdate ? 'updated' : 'added',
            newValue: validatedConfig,
        });

        this.logger.info(
            `MCP server '${serverName}' ${isUpdate ? 'updated' : 'added'} successfully`
        );
    }

    
    public removeMcpServer(serverName: string): void {
        this.logger.debug(`Removing MCP server: ${serverName}`);

        if (serverName in this.runtimeConfig.mcpServers) {
            delete this.runtimeConfig.mcpServers[serverName];

            this.agentEventBus.emit('mcp:server-removed', { serverName });
            this.agentEventBus.emit('state:changed', {
                field: 'mcpServers',
                oldValue: 'removed',
                newValue: undefined,
            });

            this.logger.info(`MCP server '${serverName}' removed successfully`);
        } else {
            this.logger.warn(`MCP server '${serverName}' not found for removal`);
        }
    }

    
    private setSessionOverride(sessionId: string, override: SessionOverride): void {
        this.sessionOverrides.set(sessionId, override);
        this.agentEventBus.emit('session:override-set', {
            sessionId,
            override: structuredClone(override),
        });
    }

    
    private getSessionOverride(sessionId: string): SessionOverride | undefined {
        return this.sessionOverrides.get(sessionId);
    }

    
    public clearSessionOverride(sessionId: string): void {
        const hadOverride = this.sessionOverrides.has(sessionId);
        this.sessionOverrides.delete(sessionId);

        if (hadOverride) {
            this.agentEventBus.emit('session:override-cleared', { sessionId });
            this.logger.info('Session override cleared', { sessionId });
        }
    }

    
    public hasSessionLLMOverride(sessionId: string): boolean {
        return this.sessionOverrides.get(sessionId)?.llm !== undefined;
    }

    
    private clearAllSessionOverrides(): void {
        const sessionIds = Array.from(this.sessionOverrides.keys());
        this.sessionOverrides.clear();

        sessionIds.forEach((sessionId) => {
            this.agentEventBus.emit('session:override-cleared', { sessionId });
        });

        if (sessionIds.length > 0) {
            this.logger.info('All session overrides cleared', { clearedSessions: sessionIds });
        }
    }

    
    public exportAsConfig(): AgentRuntimeSettings {
        const exportedConfig: AgentRuntimeSettings = {
            ...this.baselineConfig,
            llm: structuredClone(this.runtimeConfig.llm),
            systemPrompt: this.runtimeConfig.systemPrompt,
            mcpServers: structuredClone(this.runtimeConfig.mcpServers),
        };

        this.agentEventBus.emit('state:exported', {
            config: exportedConfig,
        });

        this.logger.info('Runtime state exported as config', {
            exportedConfig,
        });

        return exportedConfig;
    }

    
    public resetToBaseline(): void {
        this.runtimeConfig = structuredClone(this.baselineConfig);

        this.clearAllSessionOverrides();
        this.agentEventBus.emit('state:reset', { toConfig: this.baselineConfig });

        this.logger.info('Runtime state reset to baseline config');
    }

    
    public getLLMConfig(sessionId?: string): Readonly<ValidatedLLMConfig> {
        const config = this.getRuntimeConfig(sessionId).llm;
        return config;
    }
}
