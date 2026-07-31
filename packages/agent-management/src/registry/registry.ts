import { existsSync, readFileSync, readdirSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@fius/core';
import { resolveBundledScript, getFiusGlobalPath, copyDirectory } from '../utils/path.js';
import {
    Registry,
    RegistrySchema,
    AgentRegistry,
    AgentRegistryEntry,
    normalizeRegistryJson,
} from './types.js';
import { RegistryError } from './errors.js';
import {
    loadUserRegistry,
    mergeRegistries,
    removeAgentFromUserRegistry,
    addAgentToUserRegistry,
} from './user-registry.js';
import { loadGlobalPreferences } from '../preferences/loader.js';
let cachedRegistry: LocalAgentRegistry | null = null;

/**
 * Local agent registry implementation
 * Loads and merges the bundled registry (shipped with the CLI bundle) with the user's custom
 * registry under `~/.fius`.
 *
 * Hosts (CLI, server, apps) use this to resolve an agent ID to a concrete YAML path, then
 * load/validate that YAML and instantiate a `FiusAgent` from the resolved config.
 */
export class LocalAgentRegistry implements AgentRegistry {
    private _registry: Registry | null = null;

    /**
     * Lazy load registry from JSON file
     */
    getRegistry(): Registry {
        if (this._registry === null) {
            this._registry = this.loadRegistry();
        }
        return this._registry;
    }

    /**
     * Load and merge bundled + user registries
     * Uses fail-fast approach - throws RegistryError for any loading issues
     */
    private loadRegistry(): Registry {
        let jsonPath: string;

        try {
            jsonPath = resolveBundledScript('agents/agent-registry.json');
        } catch (error) {
            throw RegistryError.registryNotFound(
                'agents/agent-registry.json',
                error instanceof Error ? error.message : String(error)
            );
        }

        if (!existsSync(jsonPath)) {
            throw RegistryError.registryNotFound(jsonPath, "File doesn't exist");
        }

        let bundledRegistry: Registry;
        try {
            const jsonData = readFileSync(jsonPath, 'utf-8');
            const rawRegistry = JSON.parse(jsonData);
            bundledRegistry = RegistrySchema.parse(normalizeRegistryJson(rawRegistry));
        } catch (error) {
            throw RegistryError.registryParseError(
                jsonPath,
                error instanceof Error ? error.message : String(error)
            );
        }

        const userRegistry = loadUserRegistry();
        const merged = mergeRegistries(bundledRegistry, userRegistry);

        logger.debug(
            `Loaded registry: ${Object.keys(bundledRegistry.agents).length} bundled, ${Object.keys(userRegistry.agents).length} custom`
        );

        return merged;
    }

    /**
     * Check if agent exists in registry by ID
     */
    hasAgent(agentId: string): boolean {
        const registry = this.getRegistry();
        return agentId in registry.agents;
    }

    /**
     * Get available agents with their metadata from registry
     */
    getAvailableAgents(): Record<string, AgentRegistryEntry> {
        const registry = this.getRegistry();
        return registry.agents;
    }

    /**
     * Validate custom agent ID doesn't conflict with bundled registry
     * @throws RegistryError if ID conflicts with builtin agent
     */
    private validateCustomAgentId(agentId: string): void {
        let jsonPath: string;
        try {
            jsonPath = resolveBundledScript('agents/agent-registry.json');
        } catch (error) {
            throw RegistryError.registryNotFound(
                'agents/agent-registry.json',
                error instanceof Error ? error.message : String(error)
            );
        }

        try {
            const jsonData = readFileSync(jsonPath, 'utf-8');
            const bundledRegistry = RegistrySchema.parse(
                normalizeRegistryJson(JSON.parse(jsonData))
            );

            if (agentId in bundledRegistry.agents) {
                throw RegistryError.customAgentNameConflict(agentId);
            }
        } catch (error) {
            if (error instanceof Error && /name conflicts with builtin agent/.test(error.message)) {
                throw error;
            }
            throw RegistryError.registryParseError(
                jsonPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Resolve main config file for installed agent
     * Handles both directory agents (with main field) and single-file agents
     */
    resolveMainConfig(agentDir: string, agentId: string): string {
        const registry = this.getRegistry();
        const agentData = registry.agents[agentId];

        if (!agentData) {
            if (existsSync(agentDir)) {
                const candidates = ['agent.yaml', 'agent.yml', 'agent.json', 'main.js', 'main.ts', 'index.js', 'index.ts', 'SKILL.md'];
                for (const candidate of candidates) {
                    const configPath = path.join(agentDir, candidate);
                    if (existsSync(configPath)) {
                        return configPath;
                    }
                }
                try {
                    const entries = readdirSync(agentDir);
                    for (const entry of entries) {
                        if (/\.(json|ya?ml)$/.test(entry)) {
                            return path.join(agentDir, entry);
                        }
                    }
                    for (const entry of entries) {
                        if (/\.(ts|js)$/.test(entry) && !entry.endsWith('.d.ts')) {
                            return path.join(agentDir, entry);
                        }
                    }
                } catch {
                }
            }
            const available = Object.keys(registry.agents);
            throw RegistryError.agentNotFound(agentId, available);
        }

        if (agentData.source.endsWith('/')) {
            if (!agentData.main) {
                throw RegistryError.agentInvalidEntry(
                    agentId,
                    'directory entry missing main field'
                );
            }

            const mainConfigPath = path.join(agentDir, agentData.main);
            if (!existsSync(mainConfigPath)) {
                throw RegistryError.mainConfigMissing(agentId, mainConfigPath);
            }

            return mainConfigPath;
        } else {
            const filename = path.basename(agentData.source);
            const configPath = path.join(agentDir, filename);

            if (!existsSync(configPath)) {
                throw RegistryError.configNotFound(configPath);
            }

            return configPath;
        }
    }

    /**
     * Install agent atomically using temp + rename pattern
     * @param agentId ID of the agent to install
     */
    async installAgent(agentId: string): Promise<string> {
        logger.info(`Installing agent: ${agentId}`);
        const registry = this.getRegistry();
        const agentData = registry.agents[agentId];

        if (!agentData) {
            const available = Object.keys(registry.agents);
            throw RegistryError.agentNotFound(agentId, available);
        }

        const globalAgentsDir = getFiusGlobalPath('agents');
        const targetDir = path.resolve(globalAgentsDir, agentId);
        const relTarget = path.relative(globalAgentsDir, targetDir);
        if (relTarget.startsWith('..') || path.isAbsolute(relTarget)) {
            throw RegistryError.installationFailed(
                agentId,
                'invalid agentId: path traversal detected'
            );
        }

        if (existsSync(targetDir)) {
            logger.info(`Agent '${agentId}' already installed`);
            return this.resolveMainConfig(targetDir, agentId);
        }

        await fs.mkdir(globalAgentsDir, { recursive: true });

        const sourcePath = resolveBundledScript(`agents/${agentData.source}`);

        const tempDir = `${targetDir}.tmp.${Date.now()}`;

        try {
            if (agentData.source.endsWith('/')) {
                await copyDirectory(sourcePath, tempDir);
            } else {
                await fs.mkdir(tempDir, { recursive: true });
                const targetFile = path.join(tempDir, path.basename(sourcePath));
                await fs.copyFile(sourcePath, targetFile);
            }

            const mainConfigPath = this.resolveMainConfig(tempDir, agentId);
            if (!existsSync(mainConfigPath)) {
                throw RegistryError.installationValidationFailed(agentId, mainConfigPath);
            }

            await fs.rename(tempDir, targetDir);

            logger.info(`✓ Installed agent '${agentId}' to ${targetDir}`);

            return this.resolveMainConfig(targetDir, agentId);
        } catch (error) {
            try {
                if (existsSync(tempDir)) {
                    await fs.rm(tempDir, { recursive: true, force: true });
                }
            } catch (cleanupError) {
                logger.error(
                    `Failed to clean up temp directory: ${
                        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
                    }. Skipping cleanup...`
                );
            }

            throw RegistryError.installationFailed(
                agentId,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Install a custom agent from a local file path
     * @param agentId Unique identifier for the custom agent
     * @param sourcePath Absolute path to agent YAML file or directory
     * @param metadata Agent metadata (name for display, description, author, tags, main)
     * @returns Path to the installed agent's main config file
     */
    async installCustomAgentFromPath(
        agentId: string,
        sourcePath: string,
        metadata: {
            name?: string;
            description: string;
            author: string;
            tags: string[];
            main?: string;
        }
    ): Promise<string> {
        logger.info(`Installing custom agent '${agentId}' from ${sourcePath}`);

        this.validateCustomAgentId(agentId);

        if (!existsSync(sourcePath)) {
            throw RegistryError.configNotFound(sourcePath);
        }

        const globalAgentsDir = getFiusGlobalPath('agents');
        const targetDir = path.resolve(globalAgentsDir, agentId);
        const relTarget = path.relative(globalAgentsDir, targetDir);
        if (relTarget.startsWith('..') || path.isAbsolute(relTarget)) {
            throw RegistryError.installationFailed(
                agentId,
                'invalid agentId: path traversal detected'
            );
        }

        if (existsSync(targetDir)) {
            throw RegistryError.agentAlreadyExists(agentId);
        }

        await fs.mkdir(globalAgentsDir, { recursive: true });

        const stats = await fs.stat(sourcePath);
        const isDirectory = stats.isDirectory();

        const configFileName = isDirectory ? undefined : `${agentId}.yml`;

        if (!metadata.description) {
            throw RegistryError.installationFailed(agentId, 'description is required');
        }
        if (isDirectory && !metadata.main) {
            throw RegistryError.installationFailed(
                agentId,
                'main field is required for directory-based agents'
            );
        }

        const displayName =
            metadata.name ||
            agentId
                .split('-')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

        const registryEntry: Omit<AgentRegistryEntry, 'type'> = {
            id: agentId,
            name: displayName,
            description: metadata.description,
            author: metadata.author,
            tags: metadata.tags,
            source: isDirectory ? `${agentId}/` : configFileName!,
            main: metadata.main,
        };

        const tempDir = `${targetDir}.tmp.${Date.now()}`;

        try {
            if (isDirectory) {
                await copyDirectory(sourcePath, tempDir);
            } else {
                await fs.mkdir(tempDir, { recursive: true });
                const targetFile = path.join(tempDir, configFileName!);
                await fs.copyFile(sourcePath, targetFile);
            }

            const tempMainConfigPath = isDirectory
                ? path.join(tempDir, metadata.main!)
                : path.join(tempDir, configFileName!);

            if (!existsSync(tempMainConfigPath)) {
                throw RegistryError.installationValidationFailed(agentId, tempMainConfigPath);
            }

            await fs.rename(tempDir, targetDir);

            logger.info(`✓ Installed custom agent '${agentId}' to ${targetDir}`);

            const mainConfigPath =
                isDirectory && metadata.main
                    ? path.join(targetDir, metadata.main)
                    : path.join(targetDir, configFileName!);

            try {
                await addAgentToUserRegistry(agentId, registryEntry);
                logger.info(`✓ Added '${agentId}' to user registry`);

                this._registry = null;
            } catch (registryError) {
                try {
                    if (existsSync(targetDir)) {
                        await fs.rm(targetDir, { recursive: true, force: true });
                        logger.info(`Rolled back installation: removed ${targetDir}`);
                    }
                } catch (rollbackError) {
                    logger.error(
                        `Rollback failed for '${agentId}': ${
                            rollbackError instanceof Error
                                ? rollbackError.message
                                : String(rollbackError)
                        }`
                    );
                }
                throw registryError;
            }

            return mainConfigPath;
        } catch (error) {
            try {
                if (existsSync(tempDir)) {
                    await fs.rm(tempDir, { recursive: true, force: true });
                }
            } catch (cleanupError) {
                logger.error(
                    `Failed to clean up temp directory: ${
                        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
                    }. Skipping cleanup...`
                );
            }

            throw RegistryError.installationFailed(
                agentId,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * Resolve a registry agent ID to a config path
     * NOTE: Only handles registry IDs, not file paths (routing done in loadAgentConfig)
     * Handles installing agent if needed
     * @param agentId ID of the agent to resolve
     * @param autoInstall Whether to automatically install missing agents from registry (default: true)
     */
    async resolveAgent(agentId: string, autoInstall: boolean = true): Promise<string> {
        logger.debug(`Resolving registry agent: ${agentId}`);

        const globalAgentsDir = getFiusGlobalPath('agents');
        const installedPath = path.resolve(globalAgentsDir, agentId);
        const relInstalled = path.relative(globalAgentsDir, installedPath);
        if (relInstalled.startsWith('..') || path.isAbsolute(relInstalled)) {
            throw RegistryError.agentNotFound(agentId, Object.keys(this.getRegistry().agents));
        }

        if (existsSync(installedPath)) {
            const mainConfig = this.resolveMainConfig(installedPath, agentId);
            logger.debug(`Resolved installed agent '${agentId}' to: ${mainConfig}`);
            return mainConfig;
        }

        logger.debug(`Agent '${agentId}' not found in installed path: ${installedPath}`);

        if (this.hasAgent(agentId)) {
            if (autoInstall) {
                logger.info(`Installing agent '${agentId}' from registry...`);
                return await this.installAgent(agentId);
            } else {
                const registry = this.getRegistry();
                const available = Object.keys(registry.agents);
                throw RegistryError.agentNotInstalledAutoInstallDisabled(agentId, available);
            }
        }

        const registry = this.getRegistry();
        const available = Object.keys(registry.agents);
        throw RegistryError.agentNotFound(agentId, available);
    }

    /**
     * Get list of currently installed agents
     */
    async getInstalledAgents(): Promise<string[]> {
        const globalAgentsDir = getFiusGlobalPath('agents');

        if (!existsSync(globalAgentsDir)) {
            return [];
        }

        try {
            const entries = await fs.readdir(globalAgentsDir, { withFileTypes: true });
            return (
                entries
                    .filter((entry) => entry.isDirectory())
                    .map((entry) => entry.name)
                    .filter((name) => !name.startsWith('.tmp') && !name.includes('.tmp.'))
            );
        } catch (error) {
            logger.error(`Failed to read installed agents directory: ${error}`);
            return [];
        }
    }

    /**
     * Check if an agent is safe to uninstall (not the default agent from preferences)
     */
    private async isAgentSafeToUninstall(agentId: string): Promise<boolean> {
        try {
            const preferences = await loadGlobalPreferences();
            const defaultAgent = preferences.defaults.defaultAgent;
            return agentId !== defaultAgent;
        } catch {
            logger.warn('Could not load preferences, using fallback protection for fius');
            return agentId !== 'fius';
        }
    }

    /**
     * Uninstall an agent by removing its directory
     * For custom agents: also removes from user registry
     * For builtin agents: only removes from disk
     * @param agentId ID of the agent to uninstall
     * @param force Whether to force uninstall even if agent is protected (default: false)
     */
    async uninstallAgent(agentId: string, force: boolean = false): Promise<void> {
        const globalAgentsDir = getFiusGlobalPath('agents');
        const agentDir = path.resolve(globalAgentsDir, agentId);
        const relAgent = path.relative(globalAgentsDir, agentDir);
        if (relAgent.startsWith('..') || path.isAbsolute(relAgent)) {
            throw RegistryError.uninstallationFailed(
                agentId,
                'invalid agentId: path traversal detected'
            );
        }
        logger.info(`Uninstalling agent: ${agentId} from ${agentDir}`);

        if (!existsSync(agentDir)) {
            throw RegistryError.agentNotInstalled(agentId);
        }

        if (!force && !(await this.isAgentSafeToUninstall(agentId))) {
            throw RegistryError.agentProtected(agentId);
        }

        const registry = this.getRegistry();
        const agentData = registry.agents[agentId];
        const isCustomAgent = agentData?.type === 'custom';

        try {
            await fs.rm(agentDir, { recursive: true, force: true });
            logger.info(`✓ Removed agent '${agentId}' from ${agentDir}`);

            if (isCustomAgent) {
                await removeAgentFromUserRegistry(agentId);
                logger.info(`✓ Removed custom agent '${agentId}' from user registry`);

                this._registry = null;
            }
        } catch (error) {
            throw RegistryError.uninstallationFailed(
                agentId,
                error instanceof Error ? error.message : String(error)
            );
        }
    }
}

/**
 * Get cached registry instance (singleton pattern)
 */
export function getAgentRegistry(): LocalAgentRegistry {
    if (cachedRegistry === null) {
        cachedRegistry = new LocalAgentRegistry();
    }
    return cachedRegistry;
}

/**
 * Load bundled agent registry (agents field only)
 * Returns empty object on error - use for non-critical lookups like display names
 */
export function loadBundledRegistryAgents(): Record<string, AgentRegistryEntry> {
    try {
        const registryPath = resolveBundledScript('agents/agent-registry.json');
        const content = readFileSync(registryPath, 'utf-8');
        const registry = JSON.parse(content);
        return registry.agents || {};
    } catch (error) {
        logger.warn(
            `Could not load bundled registry: ${error instanceof Error ? error.message : String(error)}`
        );
        return {};
    }
}
