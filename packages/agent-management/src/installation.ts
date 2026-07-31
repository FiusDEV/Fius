import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@fius/core';
import { getFiusGlobalPath, resolveBundledScript, copyDirectory } from './utils/path.js';
import { RegistryError } from './registry/errors.js';
import { ConfigError } from './config/errors.js';
import type { AgentMetadata } from './AgentManager.js';

export interface InstallOptions {
    /** Directory where agents are stored (default: ~/.fius/agents) */
    agentsDir?: string;
}

/**
 * Get the default agents directory
 */
function getAgentsDir(options?: InstallOptions): string {
    return options?.agentsDir ?? getFiusGlobalPath('agents');
}

/**
 * Get the user registry path for installed agents
 */
function getUserRegistryPath(agentsDir: string): string {
    return path.join(agentsDir, 'registry.json');
}

/**
 * Load user registry (creates empty if doesn't exist)
 */
async function loadUserRegistry(registryPath: string): Promise<{ agents: any[] }> {
    try {
        const content = await fs.readFile(registryPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { agents: [] };
        }
        throw error;
    }
}

/**
 * Save user registry
 */
async function saveUserRegistry(registryPath: string, registry: { agents: any[] }): Promise<void> {
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
}

/**
 * Install agent from bundled registry to local directory
 *
 * @param agentId ID of the agent to install from bundled registry
 * @param options Installation options
 * @returns Path to the installed agent's main config file
 *
 * @throws {FiusRuntimeError} If agent not found in bundled registry or installation fails
 *
 * @example
 * ```typescript
 * await installBundledAgent('coding-agent');
 * console.log('Agent installed to ~/.fius/agents/coding-agent');
 * ```
 */
export async function installBundledAgent(
    agentId: string,
    options?: InstallOptions
): Promise<string> {
    const agentsDir = getAgentsDir(options);
    const bundledRegistryPath = resolveBundledScript('agents/agent-registry.json');

    logger.info(`Installing agent: ${agentId}`);

    let bundledRegistry: any;
    try {
        const content = await fs.readFile(bundledRegistryPath, 'utf-8');
        bundledRegistry = JSON.parse(content);
    } catch (error) {
        throw RegistryError.registryParseError(
            bundledRegistryPath,
            error instanceof Error ? error.message : String(error)
        );
    }

    const agentEntry = bundledRegistry.agents[agentId];

    if (!agentEntry) {
        const available = Object.keys(bundledRegistry.agents);
        throw RegistryError.agentNotFound(agentId, available);
    }

    const targetDir = path.join(agentsDir, agentId);

    try {
        await fs.access(targetDir);
        logger.info(`Agent '${agentId}' already installed`);

        const mainFile = agentEntry.main || path.basename(agentEntry.source);
        return path.join(targetDir, mainFile);
    } catch {
    }

    await fs.mkdir(agentsDir, { recursive: true });

    const sourcePath = resolveBundledScript(`agents/${agentEntry.source}`);
    const tempDir = `${targetDir}.tmp.${Date.now()}`;

    try {
        if (agentEntry.source.endsWith('/')) {
            await copyDirectory(sourcePath, tempDir);
        } else {
            await fs.mkdir(tempDir, { recursive: true });
            const targetFile = path.join(tempDir, path.basename(sourcePath));
            await fs.copyFile(sourcePath, targetFile);
        }

        await fs.rename(tempDir, targetDir);

        logger.info(`✓ Installed agent '${agentId}' to ${targetDir}`);

        const userRegistryPath = getUserRegistryPath(agentsDir);
        const userRegistry = await loadUserRegistry(userRegistryPath);

        if (!userRegistry.agents.some((a: any) => a.id === agentId)) {
            const mainFile = agentEntry.main || path.basename(agentEntry.source);
            userRegistry.agents.push({
                id: agentId,
                name: agentEntry.name,
                description: agentEntry.description,
                configPath: `./${agentId}/${mainFile}`,
                author: agentEntry.author,
                tags: agentEntry.tags,
            });
            await saveUserRegistry(userRegistryPath, userRegistry);
        }

        return path.join(targetDir, agentEntry.main || path.basename(agentEntry.source));
    } catch (error) {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
        }

        throw RegistryError.installationFailed(
            agentId,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Install custom agent from local path
 *
 * @param agentId Unique ID for the custom agent
 * @param sourcePath Absolute path to agent YAML file or directory
 * @param metadata Agent metadata (name, description, author, tags)
 * @param options Installation options
 * @returns Path to the installed agent's main config file
 *
 * @throws {FiusRuntimeError} If agent ID already exists or installation fails
 *
 * @example
 * ```typescript
 * await installCustomAgent('my-agent', '/path/to/agent.yml', {
 *   name: 'My Agent',
 *   description: 'Custom agent for my use case',
 *   author: 'John Doe',
 *   tags: ['custom']
 * });
 * ```
 */
export async function installCustomAgent(
    agentId: string,
    sourcePath: string,
    metadata: Pick<AgentMetadata, 'name' | 'description' | 'author' | 'tags'>,
    options?: InstallOptions
): Promise<string> {
    const agentsDir = getAgentsDir(options);
    const targetDir = path.join(agentsDir, agentId);

    logger.info(`Installing custom agent: ${agentId}`);

    try {
        const bundledRegistryPath = resolveBundledScript('agents/agent-registry.json');
        const bundledContent = await fs.readFile(bundledRegistryPath, 'utf-8');
        const bundledRegistry = JSON.parse(bundledContent);

        if (agentId in bundledRegistry.agents) {
            throw RegistryError.customAgentNameConflict(agentId);
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes('conflicts with builtin')) {
            throw error;
        }
        logger.debug(
            `Could not validate against bundled registry: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    try {
        await fs.access(targetDir);
        throw RegistryError.agentAlreadyExists(agentId);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    const resolvedSource = path.resolve(sourcePath);
    let stat;
    try {
        stat = await fs.stat(resolvedSource);
    } catch (_error) {
        throw ConfigError.fileNotFound(resolvedSource);
    }

    await fs.mkdir(agentsDir, { recursive: true });

    try {
        if (stat.isDirectory()) {
            await copyDirectory(resolvedSource, targetDir);
        } else {
            await fs.mkdir(targetDir, { recursive: true });
            const filename = path.basename(resolvedSource);
            await fs.copyFile(resolvedSource, path.join(targetDir, filename));
        }

        logger.info(`✓ Installed custom agent '${agentId}' to ${targetDir}`);

        const userRegistryPath = getUserRegistryPath(agentsDir);
        const userRegistry = await loadUserRegistry(userRegistryPath);

        const configFile = stat.isDirectory() ? 'agent.yml' : path.basename(resolvedSource);
        userRegistry.agents.push({
            id: agentId,
            name: metadata.name || agentId,
            description: metadata.description,
            configPath: `./${agentId}/${configFile}`,
            author: metadata.author,
            tags: metadata.tags || [],
        });

        await saveUserRegistry(userRegistryPath, userRegistry);

        return path.join(targetDir, configFile);
    } catch (error) {
        try {
            await fs.rm(targetDir, { recursive: true, force: true });
        } catch {
        }

        throw RegistryError.installationFailed(
            agentId,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Uninstall agent by removing it from disk and user registry
 *
 * @param agentId ID of the agent to uninstall
 * @param options Installation options
 *
 * @throws {FiusRuntimeError} If agent not installed
 *
 * @example
 * ```typescript
 * await uninstallAgent('my-custom-agent');
 * console.log('Agent uninstalled');
 * ```
 */
export async function uninstallAgent(agentId: string, options?: InstallOptions): Promise<void> {
    const agentsDir = getAgentsDir(options);
    const targetDir = path.join(agentsDir, agentId);

    logger.info(`Uninstalling agent: ${agentId}`);

    try {
        await fs.access(targetDir);
    } catch (_error) {
        throw RegistryError.agentNotInstalled(agentId);
    }

    await fs.rm(targetDir, { recursive: true, force: true });
    logger.info(`✓ Removed agent directory: ${targetDir}`);

    const userRegistryPath = getUserRegistryPath(agentsDir);
    try {
        const userRegistry = await loadUserRegistry(userRegistryPath);
        userRegistry.agents = userRegistry.agents.filter((a: any) => a.id !== agentId);
        await saveUserRegistry(userRegistryPath, userRegistry);
        logger.info(`✓ Removed '${agentId}' from user registry`);
    } catch (error) {
        logger.warn(
            `Failed to update user registry: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * List installed agents
 *
 * @param options Installation options
 * @returns Array of installed agent IDs
 *
 * @example
 * ```typescript
 * const installed = await listInstalledAgents();
 * console.log(installed); // ['coding-agent', 'my-custom-agent']
 * ```
 */
export async function listInstalledAgents(options?: InstallOptions): Promise<string[]> {
    const agentsDir = getAgentsDir(options);

    try {
        const entries = await fs.readdir(agentsDir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
