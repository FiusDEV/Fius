/**
 * Config Enrichment Layer
 *
 * Provides per-agent path defaults for file-based resources (logs, database, blobs, backups).
 * This layer runs before agent initialization and injects explicit paths
 * into the configuration, eliminating the need for core services to resolve paths themselves.
 *
 * Also discovers command prompts from (in priority order):
 * - Local: <projectRoot>/commands/ (fius-source dev mode or fius-project only)
 * - Local: <cwd>/.fius/commands/
 * - Global: ~/.fius/commands/
 *
 * Core services now require explicit paths - this enrichment layer provides them.
 */

import { getFiusPath } from '../utils/path.js';
import type { AgentConfig } from '@fius/agent-config';
import * as path from 'path';
import { discoverCommandPrompts, discoverAgentInstructionFile } from './discover-prompts.js';
import { findFiusProjectRoot } from '../utils/execution-context.js';
import { discoverClaudeCodePlugins, loadClaudeCodePlugin } from '../plugins/index.js';

export { discoverCommandPrompts, discoverAgentInstructionFile } from './discover-prompts.js';

/**
 * Derives an agent ID from config or file path for per-agent isolation.
 * Priority: explicit agentId > agentCard.name > filename (without extension) > 'coding-agent'
 */
export function deriveAgentId(config: AgentConfig, configPath?: string): string {
    if (config.agentId) {
        const sanitizedId = config.agentId
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        return sanitizedId || 'fius';
    }

    if (config.agentCard?.name) {
        const sanitizedName = config.agentCard.name
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (sanitizedName) {
            return sanitizedName;
        }
    }

    if (configPath) {
        const basename = path.basename(configPath, path.extname(configPath));
        if (basename && basename !== 'agent' && basename !== 'config') {
            return basename;
        }
    }

    return 'fius';
}

/**
 * Options for enriching agent configuration
 */
export interface EnrichAgentConfigOptions {
    /** Whether this is interactive CLI mode (affects logger transports - file only vs console+file) */
    isInteractiveCli?: boolean;
    /** Override log level (defaults to 'error' for SDK, CLI/server can override to 'info') */
    logLevel?: 'error' | 'warn' | 'info' | 'debug';
    /** Skip Claude Code plugin discovery (useful for subagents that don't need plugins) */
    skipPluginDiscovery?: boolean;
    /**
     * Bundled plugin paths from image definition.
     * These are absolute paths to plugin directories that are discovered alongside
     * user/project plugins.
     */
    bundledPlugins?: string[];
    /**
     * When true, normalize relative storage paths (database/blob) to per-agent
     * locations.
     * Useful when configs may be loaded from varying working directories.
     */
    forceStoragePaths?: boolean;
    /**
     * Explicit workspace root to use for workspace-scoped discovery (skills, AGENTS.md).
     * When omitted, enrichment falls back to the selected config path and then the ambient cwd.
     */
    workspaceRoot?: string | undefined;
}

function resolveEnrichmentWorkspaceRoot(
    configPath: string | undefined,
    explicitWorkspaceRoot: string | undefined
): string {
    if (explicitWorkspaceRoot) {
        return path.resolve(explicitWorkspaceRoot);
    }

    if (configPath) {
        const resolvedConfigDir = path.dirname(path.resolve(configPath));
        const configProjectRoot = findFiusProjectRoot(resolvedConfigDir);
        if (configProjectRoot) {
            return configProjectRoot;
        }

        return resolvedConfigDir;
    }

    return findFiusProjectRoot() ?? process.cwd();
}

/**
 * Enriches agent configuration with per-agent file paths and discovered commands.
 * This function is called before creating the FiusAgent instance.
 *
 * Enrichment adds:
 * - File transport to logger config (per-agent log file)
 * - Full paths to storage config (SQLite database, blob storage)
 * - Backup path to filesystem config (per-agent backups)
 * - Discovered command prompts from local/global commands/ directories
 *
 * @param config Agent configuration from YAML file + CLI overrides
 * @param configPath Path to the agent config file (used for agent ID derivation)
 * @param options Enrichment options (isInteractiveCli, logLevel)
 * @returns Enriched configuration with explicit per-agent paths and discovered prompts
 */
export function enrichAgentConfig(
    config: AgentConfig,
    configPath?: string,
    options: EnrichAgentConfigOptions | boolean = {}
): AgentConfig {
    const opts: EnrichAgentConfigOptions =
        typeof options === 'boolean' ? { isInteractiveCli: options } : options;
    const {
        isInteractiveCli = false,
        logLevel = 'error',
        skipPluginDiscovery = false,
        bundledPlugins = [],
        forceStoragePaths = false,
        workspaceRoot: explicitWorkspaceRoot,
    } = opts;
    const agentId = deriveAgentId(config, configPath);
    const workspaceRoot = resolveEnrichmentWorkspaceRoot(configPath, explicitWorkspaceRoot);

    const dbPath = getFiusPath('database', 'fius.db', workspaceRoot);
    const blobPath = getFiusPath('blobs', agentId, workspaceRoot);

    const enriched: AgentConfig = {
        ...config,
        agentId,
    };

    if (!config.logger) {
        const transports = isInteractiveCli
            ? [{ type: 'silent' as const }]
            : [{ type: 'console' as const, colorize: true }];

        enriched.logger = {
            level: logLevel,
            transports,
        };
    } else {
        enriched.logger = config.logger;
    }

    if (!config.storage) {
        enriched.storage = {
            cache: { type: 'in-memory' },
            database: { type: 'sqlite', path: dbPath },
            blob: { type: 'local', storePath: blobPath },
        };
    } else {
        enriched.storage = {
            ...config.storage,
        };

        if (config.storage.database?.type === 'sqlite') {
            const databasePath =
                typeof config.storage.database.path === 'string'
                    ? config.storage.database.path
                    : undefined;
            const shouldOverride =
                !databasePath || (forceStoragePaths && !path.isAbsolute(databasePath));
            enriched.storage.database = {
                ...config.storage.database,
                path: shouldOverride ? dbPath : databasePath,
            };
        }
        if (config.storage.blob?.type === 'local') {
            const blobStorePath =
                typeof config.storage.blob.storePath === 'string'
                    ? config.storage.blob.storePath
                    : undefined;
            const shouldOverride =
                !blobStorePath || (forceStoragePaths && !path.isAbsolute(blobStorePath));
            enriched.storage.blob = {
                ...config.storage.blob,
                storePath: shouldOverride ? blobPath : blobStorePath,
            };
        }
    }

    const discoveredPrompts = discoverCommandPrompts(workspaceRoot);
    if (discoveredPrompts.length > 0) {
        const existingPrompts = config.prompts ?? [];

        const existingFilePaths = new Set<string>();
        for (const prompt of existingPrompts) {
            if (prompt.type === 'file') {
                existingFilePaths.add(path.resolve(prompt.file));
            }
        }

        const filteredDiscovered = discoveredPrompts.filter(
            (p) => !existingFilePaths.has(path.resolve(p.file))
        );

        enriched.prompts = [...existingPrompts, ...filteredDiscovered];
    }

    if (!skipPluginDiscovery) {
        const existingPromptPaths = new Set<string>();
        for (const prompt of enriched.prompts ?? []) {
            if (prompt.type === 'file') {
                existingPromptPaths.add(path.resolve(prompt.file));
            }
        }

        const discoveredPlugins = discoverClaudeCodePlugins(workspaceRoot, bundledPlugins);
        for (const plugin of discoveredPlugins) {
            const loaded = loadClaudeCodePlugin(plugin);

            for (const warning of loaded.warnings) {
                console.warn(`[plugin] ${warning}`);
            }

            for (const cmd of loaded.commands) {
                if (cmd.isSkill) continue;

                const resolvedPath = path.resolve(cmd.file);
                if (existingPromptPaths.has(resolvedPath)) {
                    continue;
                }
                existingPromptPaths.add(resolvedPath);

                const promptEntry = {
                    type: 'file' as const,
                    file: cmd.file,
                    namespace: cmd.namespace,
                };

                enriched.prompts = enriched.prompts ?? [];
                enriched.prompts.push(promptEntry);
            }
        }
    }

    const shouldDiscoverAgentInstructions =
        config.agentFile?.discoverInCwd !== undefined ? config.agentFile.discoverInCwd : true;

    const instructionFile = shouldDiscoverAgentInstructions
        ? discoverAgentInstructionFile(workspaceRoot)
        : null;
    if (instructionFile) {
        const fileContributor = {
            id: 'discovered-instructions',
            type: 'file' as const,
            priority: 5,
            enabled: true,
            files: [instructionFile],
            options: {
                includeFilenames: true,
                errorHandling: 'skip' as const,
                maxFileSize: 100000,
            },
        };

        const buildModeContributor = {
            id: 'buildMode',
            type: 'dynamic' as const,
            source: 'buildMode' as const,
            priority: 5,
            enabled: true,
        };

        if (!config.systemPrompt) {
            enriched.systemPrompt = {
                contributors: [buildModeContributor, fileContributor],
            };
        } else if (typeof config.systemPrompt === 'string') {
            enriched.systemPrompt = {
                contributors: [
                    {
                        id: 'inline',
                        type: 'static' as const,
                        content: config.systemPrompt,
                        priority: 0,
                        enabled: true,
                    },
                    buildModeContributor,
                    fileContributor,
                ],
            };
        } else if ('contributors' in config.systemPrompt) {
            const existingContributors = config.systemPrompt.contributors ?? [];
            const hasDiscoveredInstructions = existingContributors.some(
                (c) => c.id === 'discovered-instructions'
            );
            const hasBuildMode = existingContributors.some(
                (c) => c.id === 'buildMode'
            );
            const extraContributors = [];
            if (!hasBuildMode) {
                extraContributors.push({
                    id: 'buildMode',
                    type: 'dynamic' as const,
                    source: 'buildMode' as const,
                    priority: 5,
                    enabled: true,
                });
            }
            if (!hasDiscoveredInstructions) {
                enriched.systemPrompt = {
                    contributors: [...existingContributors, ...extraContributors, fileContributor],
                };
            } else if (extraContributors.length > 0) {
                enriched.systemPrompt = {
                    contributors: [...existingContributors, ...extraContributors],
                };
            }
        }
    }

    return enriched;
}
