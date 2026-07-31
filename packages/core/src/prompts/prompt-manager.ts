import type { MCPManager } from '../mcp/manager.js';
import type { PromptSet, PromptProvider, PromptInfo, ResolvedPromptResult } from './types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { AgentRuntimeSettings } from '../agent/runtime-config.js';
import type { PromptsConfig } from './schemas.js';
import type { AgentEventBus } from '../events/index.js';
import { MCPPromptProvider } from './providers/mcp-prompt-provider.js';
import { ConfigPromptProvider } from './providers/config-prompt-provider.js';
import {
    CustomPromptProvider,
    type CreateCustomPromptInput,
} from './providers/custom-prompt-provider.js';
import { PromptError } from './errors.js';
import type { Logger } from '../logger/v2/types.js';
import { FiusLogComponent } from '../logger/v2/types.js';
import type { ResourceManager } from '../resources/manager.js';
import type { FiusStores } from '../storage/index.js';
import { normalizePromptArgs, flattenPromptResult } from './utils.js';

interface PromptCacheEntry {
    providerName: string;
    providerPromptName: string;
    originalName: string;
    info: PromptInfo;
}

export class PromptManager {
    private providers: Map<string, PromptProvider> = new Map();
    private configProvider: ConfigPromptProvider;
    private promptIndex: Map<string, PromptCacheEntry> | undefined;
    private aliasMap: Map<string, string> = new Map();
    private buildPromise: Promise<void> | null = null;
    private logger: Logger;

    constructor(
        mcpManager: MCPManager,
        resourceManager: ResourceManager,
        agentConfig: AgentRuntimeSettings,
        private readonly eventBus: AgentEventBus,
        stores: FiusStores,
        logger: Logger
    ) {
        this.logger = logger.createChild(FiusLogComponent.PROMPT);
        this.configProvider = new ConfigPromptProvider(agentConfig, this.logger);
        this.providers.set('mcp', new MCPPromptProvider(mcpManager, this.logger));
        this.providers.set('config', this.configProvider);
        this.providers.set(
            'custom',
            new CustomPromptProvider(
                stores.getStore('customPrompts'),
                stores.getStore('artifacts'),
                resourceManager,
                this.logger
            )
        );

        this.logger.debug(
            `PromptManager initialized with providers: ${Array.from(this.providers.keys()).join(', ')}`
        );

        const refresh = async (reason: string) => {
            this.logger.debug(`PromptManager refreshing due to: ${reason}`);
            await this.refresh();
        };

        this.eventBus.on('mcp:server-connected', async (p) => {
            if (p.success) {
                await refresh(`mcpServerConnected:${p.name}`);
            }
        });
        this.eventBus.on('mcp:server-removed', async (p) => {
            await refresh(`mcpServerRemoved:${p.serverName}`);
        });
        this.eventBus.on('mcp:server-updated', async (p) => {
            await refresh(`mcpServerUpdated:${p.serverName}`);
        });

        this.eventBus.on('mcp:prompts-list-changed', async (p) => {
            await this.updatePromptsForServer(p.serverName, p.prompts);
            this.logger.debug(
                `🔄 Surgically updated prompts for server '${p.serverName}': [${p.prompts.join(', ')}]`
            );
        });
    }

    async initialize(): Promise<void> {
        await this.ensureCache();
        this.logger.debug('PromptManager initialization complete');
    }

    async list(): Promise<PromptSet> {
        await this.ensureCache();
        const index = this.promptIndex ?? new Map();
        const result: PromptSet = {};
        for (const [key, entry] of index.entries()) {
            result[key] = entry.info;
        }
        return result;
    }

    async has(name: string): Promise<boolean> {
        const entry = await this.findEntry(name);
        return entry !== undefined;
    }

    async getPromptDefinition(name: string): Promise<import('./types.js').PromptDefinition | null> {
        const entry = await this.findEntry(name);
        if (!entry) return null;
        const { info } = entry;
        return {
            name: info.name,
            ...(info.title && { title: info.title }),
            ...(info.description && { description: info.description }),
            ...(info.arguments && { arguments: info.arguments }),
            ...(info.userInvocable !== undefined && { userInvocable: info.userInvocable }),
        };
    }

    
    async listUserInvocablePrompts(): Promise<PromptSet> {
        await this.ensureCache();
        const index = this.promptIndex ?? new Map();
        const result: PromptSet = {};
        for (const [key, entry] of index.entries()) {
            if (entry.info.userInvocable !== false) {
                result[key] = entry.info;
            }
        }
        return result;
    }

    
    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        const entry = await this.findEntry(name);
        if (!entry) {
            throw PromptError.notFound(name);
        }

        const provider = this.providers.get(entry.providerName);
        if (!provider) {
            throw PromptError.providerNotFound(entry.providerName);
        }

        let finalArgs = args;
        if (args?._positional && Array.isArray(args._positional) && args._positional.length > 0) {
            const promptArgs = entry.info.arguments;
            if (promptArgs && promptArgs.length > 0) {
                finalArgs = { ...args };
                const positionalArgs = args._positional as unknown[];
                promptArgs.forEach((argDef, index) => {
                    if (index < positionalArgs.length && !finalArgs![argDef.name]) {
                        const value = positionalArgs[index];
                        finalArgs![argDef.name] = typeof value === 'string' ? value : String(value);
                    }
                });
            }
        }

        let providerArgs: Record<string, unknown> | undefined = finalArgs;
        if (entry.providerName === 'mcp') {
            const declared = new Set((entry.info.arguments ?? []).map((a) => a.name));
            const filtered: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(finalArgs ?? {})) {
                if (key.startsWith('_')) continue;
                if (declared.size === 0 || declared.has(key)) {
                    filtered[key] = value;
                }
            }
            providerArgs = filtered;
        }

        return await provider.getPrompt(entry.providerPromptName, providerArgs);
    }

    async resolvePromptKey(nameOrAlias: string): Promise<string | null> {
        await this.ensureCache();
        if (!this.promptIndex) return null;

        if (this.promptIndex.has(nameOrAlias)) {
            return nameOrAlias;
        }

        const normalized = nameOrAlias.startsWith('/') ? nameOrAlias.slice(1) : nameOrAlias;
        const aliasMatch = this.aliasMap.get(nameOrAlias) ?? this.aliasMap.get(normalized);
        return aliasMatch ?? null;
    }

    async createCustomPrompt(input: CreateCustomPromptInput): Promise<PromptInfo> {
        const provider = this.providers.get('custom');
        if (!provider || !(provider instanceof CustomPromptProvider)) {
            throw PromptError.providerNotFound('custom');
        }
        const prompt = await provider.createPrompt(input);
        await this.refresh();
        return prompt;
    }

    async deleteCustomPrompt(name: string): Promise<void> {
        const provider = this.providers.get('custom');
        if (!provider || !(provider instanceof CustomPromptProvider)) {
            throw PromptError.providerNotFound('custom');
        }
        await provider.deletePrompt(name);
        await this.refresh();
    }

    
    async resolvePrompt(
        name: string,
        options: {
            context?: string;
            args?: Record<string, unknown>;
        } = {}
    ): Promise<ResolvedPromptResult> {
        const args: Record<string, unknown> = { ...options.args };
        if (options.context?.trim()) args._context = options.context.trim();

        const resolvedName = (await this.resolvePromptKey(name)) ?? name;

        const normalized = normalizePromptArgs(args);

        const providerArgs = normalized.context
            ? { ...normalized.args, _context: normalized.context }
            : normalized.args;

        const promptResult = await this.getPrompt(resolvedName, providerArgs);
        const flattened = flattenPromptResult(promptResult);

        if (!flattened.text && flattened.resourceUris.length === 0) {
            throw PromptError.emptyResolvedContent(resolvedName);
        }

        return {
            text: flattened.text,
            resources: flattened.resourceUris,
        };
    }

    async refresh(): Promise<void> {
        this.promptIndex = undefined;
        this.aliasMap.clear();
        for (const provider of this.providers.values()) {
            provider.invalidateCache();
        }
        await this.ensureCache();
        this.logger.info('PromptManager refreshed');
    }

    
    updateConfigPrompts(prompts: PromptsConfig): void {
        this.configProvider.updatePrompts(prompts);
        this.promptIndex = undefined;
        this.aliasMap.clear();
        this.logger.debug('Config prompts updated');
    }

    
    private async updatePromptsForServer(serverName: string, _newPrompts: string[]): Promise<void> {
        await this.ensureCache();
        if (!this.promptIndex) return;

        this.removePromptsForServer(serverName);

        const mcpProvider = this.providers.get('mcp');
        if (mcpProvider) {
            try {
                const { prompts } = await mcpProvider.listPrompts();
                const serverPrompts = prompts.filter(
                    (p) =>
                        p.metadata &&
                        typeof p.metadata === 'object' &&
                        'serverName' in p.metadata &&
                        p.metadata.serverName === serverName
                );

                const displayNameCounts = new Map<string, number>();
                for (const entry of this.promptIndex.values()) {
                    const displayName = entry.info.displayName || entry.info.name;
                    displayNameCounts.set(
                        displayName,
                        (displayNameCounts.get(displayName) || 0) + 1
                    );
                }
                for (const prompt of serverPrompts) {
                    const displayName = prompt.displayName || prompt.name;
                    displayNameCounts.set(
                        displayName,
                        (displayNameCounts.get(displayName) || 0) + 1
                    );
                }

                for (const prompt of serverPrompts) {
                    const displayName = prompt.displayName || prompt.name;
                    const hasCollision = (displayNameCounts.get(displayName) || 0) > 1;
                    prompt.commandName = hasCollision
                        ? `${prompt.source}:${displayName}`
                        : displayName;
                    this.insertPrompt(this.promptIndex, this.aliasMap, 'mcp', prompt);
                }
            } catch (error) {
                this.logger.debug(
                    `Failed to get updated prompts for server '${serverName}': ${error}`
                );
            }
        }
    }

    
    private removePromptsForServer(serverName: string): void {
        if (!this.promptIndex) return;

        const keysToRemove: string[] = [];
        for (const [key, entry] of this.promptIndex.entries()) {
            if (
                entry.providerName === 'mcp' &&
                entry.info.metadata &&
                typeof entry.info.metadata === 'object' &&
                'serverName' in entry.info.metadata &&
                entry.info.metadata.serverName === serverName
            ) {
                keysToRemove.push(key);
            }
        }

        for (const key of keysToRemove) {
            const entry = this.promptIndex.get(key);
            if (entry) {
                this.promptIndex.delete(key);
                for (const [aliasKey, aliasValue] of Array.from(this.aliasMap.entries())) {
                    if (aliasValue === key) {
                        this.aliasMap.delete(aliasKey);
                    }
                }
            }
        }
    }

    private sanitizePromptInfo(prompt: PromptInfo, providerName: string): PromptInfo {
        const metadata = { ...(prompt.metadata ?? {}) } as Record<string, unknown>;
        delete metadata.content;
        delete metadata.prompt;
        delete metadata.messages;

        if (!metadata.originalName) {
            metadata.originalName = prompt.name;
        }
        metadata.provider = providerName;

        const sanitized: PromptInfo = { ...prompt };
        if (Object.keys(metadata).length > 0) {
            sanitized.metadata = metadata;
        } else {
            delete sanitized.metadata;
        }
        return sanitized;
    }

    private async ensureCache(): Promise<void> {
        if (this.promptIndex) {
            return;
        }
        if (this.buildPromise) {
            await this.buildPromise;
            return;
        }
        this.buildPromise = this.buildCache();
        try {
            await this.buildPromise;
        } finally {
            this.buildPromise = null;
        }
    }

    private async buildCache(): Promise<void> {
        const index = new Map<string, PromptCacheEntry>();
        const aliases = new Map<string, string>();

        const collectedPrompts: Array<{ providerName: string; prompt: PromptInfo }> = [];

        for (const [providerName, provider] of this.providers) {
            try {
                const { prompts } = await provider.listPrompts();
                for (const prompt of prompts) {
                    collectedPrompts.push({ providerName, prompt });
                }
            } catch (error) {
                this.logger.error(
                    `Failed to get prompts from ${providerName} provider: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        const displayNameCounts = new Map<string, number>();
        for (const { prompt } of collectedPrompts) {
            const displayName = prompt.displayName || prompt.name;
            displayNameCounts.set(displayName, (displayNameCounts.get(displayName) || 0) + 1);
        }

        for (const { prompt } of collectedPrompts) {
            const displayName = prompt.displayName || prompt.name;
            const hasCollision = (displayNameCounts.get(displayName) || 0) > 1;

            prompt.commandName = hasCollision ? `${prompt.source}:${displayName}` : displayName;
        }

        for (const { providerName, prompt } of collectedPrompts) {
            this.insertPrompt(index, aliases, providerName, prompt);
        }

        this.promptIndex = index;
        this.aliasMap = aliases;

        if (index.size > 0) {
            const sample = Array.from(index.keys()).slice(0, 5);
            this.logger.debug(
                `📋 Prompt discovery: ${index.size} prompts. Sample: ${sample.join(', ')}`
            );
        }
    }

    private insertPrompt(
        index: Map<string, PromptCacheEntry>,
        aliases: Map<string, string>,
        providerName: string,
        prompt: PromptInfo
    ): void {
        const providerPromptName = prompt.name;
        const prepared = this.sanitizePromptInfo(prompt, providerName);
        let key = providerPromptName;
        const originalName = providerPromptName;

        if (index.has(key)) {
            const existing = index.get(key)!;
            index.delete(key);

            const existingKey = `${existing.providerName}:${existing.originalName}`;
            const updatedExisting: PromptCacheEntry = {
                ...existing,
                info:
                    existing.info.name === existingKey
                        ? existing.info
                        : { ...existing.info, name: existingKey },
            };
            index.set(existingKey, updatedExisting);
            aliases.set(existing.originalName, existingKey);
            key = `${providerName}:${originalName}`;
        }

        const entryInfo =
            prepared.name === key ? prepared : ({ ...prepared, name: key } as PromptInfo);
        const entry: PromptCacheEntry = {
            providerName,
            providerPromptName,
            originalName,
            info: entryInfo,
        };

        index.set(key, entry);
        aliases.set(originalName, key);

        const metadata = entryInfo.metadata as Record<string, unknown> | undefined;
        if (metadata) {
            const aliasCandidates = new Set<string>();
            if (typeof metadata.originalName === 'string') {
                aliasCandidates.add(metadata.originalName);
            }
            if (typeof metadata.command === 'string') {
                const command = metadata.command as string;
                aliasCandidates.add(command);
                if (command.startsWith('/')) {
                    aliasCandidates.add(command.slice(1));
                }
            }

            for (const candidate of aliasCandidates) {
                if (candidate && !aliases.has(candidate)) {
                    aliases.set(candidate, key);
                }
            }
        }

        if (entryInfo.commandName && !aliases.has(entryInfo.commandName)) {
            aliases.set(entryInfo.commandName, key);
        }
    }

    private async findEntry(name: string): Promise<PromptCacheEntry | undefined> {
        await this.ensureCache();
        if (!this.promptIndex) return undefined;

        if (this.promptIndex.has(name)) {
            return this.promptIndex.get(name);
        }

        const normalized = name.startsWith('/') ? name.slice(1) : name;
        const alias = this.aliasMap.get(name) ?? this.aliasMap.get(normalized);
        if (alias && this.promptIndex.has(alias)) {
            return this.promptIndex.get(alias);
        }

        return undefined;
    }
}
