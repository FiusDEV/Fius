/**
 * Plugin Installation
 *
 * Installs plugins from local directories to Fius's plugin directory.
 * Manages Fius's own installed_plugins.json for tracking installations.
 */

import * as path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { getFiusGlobalPath, copyDirectory } from '../utils/path.js';
import { validatePluginDirectory } from './validate-plugin.js';
import { PluginError } from './errors.js';
import { InstalledPluginsFileSchema } from './schemas.js';
import type {
    PluginInstallScope,
    PluginInstallResult,
    InstalledPluginsFile,
    InstalledPluginEntry,
} from './types.js';

/**
 * Options for plugin installation
 */
export interface InstallPluginOptions {
    /** Installation scope: 'user', 'project', or 'local' */
    scope: PluginInstallScope;
    /** Project path for project-scoped plugins */
    projectPath?: string;
    /** Force overwrite if plugin already exists */
    force?: boolean;
}

/**
 * Path to Fius's installed_plugins.json
 */
export function getFiusInstalledPluginsPath(): string {
    return getFiusGlobalPath('plugins', 'installed_plugins.json');
}

/**
 * Loads Fius's installed_plugins.json
 */
export function loadFiusInstalledPlugins(): InstalledPluginsFile {
    const filePath = getFiusInstalledPluginsPath();

    if (!existsSync(filePath)) {
        return { version: 1, plugins: {} };
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = InstalledPluginsFileSchema.safeParse(parsed);

        if (!result.success) {
            return { version: 1, plugins: {} };
        }

        return result.data as InstalledPluginsFile;
    } catch {
        return { version: 1, plugins: {} };
    }
}

/**
 * Saves Fius's installed_plugins.json
 */
export function saveFiusInstalledPlugins(data: InstalledPluginsFile): void {
    const filePath = getFiusInstalledPluginsPath();
    const dirPath = path.dirname(filePath);

    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
    }

    try {
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        throw PluginError.installManifestWriteFailed(
            filePath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Checks if a plugin is already installed.
 *
 * @param pluginName Plugin name to check
 * @param projectPath Optional project path for project-scoped check
 * @returns Installation entry if found, null otherwise
 */
export function isPluginInstalled(
    pluginName: string,
    projectPath?: string
): InstalledPluginEntry | null {
    const installed = loadFiusInstalledPlugins();
    const normalizedName = pluginName.toLowerCase();

    for (const [_id, installations] of Object.entries(installed.plugins)) {
        for (const installation of installations) {
            const manifestPath = path.join(
                installation.installPath,
                '.claude-plugin',
                'plugin.json'
            );
            if (!existsSync(manifestPath)) continue;

            try {
                const content = readFileSync(manifestPath, 'utf-8');
                const manifest = JSON.parse(content);
                if (manifest.name?.toLowerCase() === normalizedName) {
                    if (
                        (installation.scope === 'project' || installation.scope === 'local') &&
                        installation.projectPath
                    ) {
                        if (projectPath) {
                            const normalizedInstallProject = path
                                .resolve(installation.projectPath)
                                .toLowerCase();
                            const normalizedCurrentProject = path
                                .resolve(projectPath)
                                .toLowerCase();
                            if (normalizedInstallProject === normalizedCurrentProject) {
                                return installation;
                            }
                        }
                        continue;
                    }
                    return installation;
                }
            } catch {
                continue;
            }
        }
    }

    return null;
}

/**
 * Installs a plugin from a local directory.
 *
 * @param sourcePath Absolute or relative path to the plugin source directory
 * @param options Installation options
 * @returns Installation result with success status and warnings
 */
export async function installPluginFromPath(
    sourcePath: string,
    options: InstallPluginOptions
): Promise<PluginInstallResult> {
    const { scope, projectPath, force = false } = options;
    const warnings: string[] = [];

    const absoluteSourcePath = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(sourcePath);

    const validation = validatePluginDirectory(absoluteSourcePath);
    if (!validation.valid) {
        throw PluginError.installSourceNotFound(absoluteSourcePath);
    }

    if (!validation.manifest) {
        throw PluginError.installSourceNotFound(absoluteSourcePath);
    }

    warnings.push(...validation.warnings);

    const pluginName = validation.manifest.name;
    const currentProjectPath = projectPath || process.cwd();

    const existingInstall = isPluginInstalled(pluginName, currentProjectPath);
    if (existingInstall && !force) {
        throw PluginError.installAlreadyExists(pluginName, existingInstall.installPath);
    }

    let installPath: string;
    let isLocal = false;

    switch (scope) {
        case 'user':
            installPath = path.join(getFiusGlobalPath('plugins'), pluginName);
            break;
        case 'project':
            installPath = path.join(currentProjectPath, '.fius', 'plugins', pluginName);
            break;
        case 'local':
            installPath = absoluteSourcePath;
            isLocal = true;
            break;
        default:
            throw PluginError.invalidScope(scope);
    }

    if (!isLocal) {
        if (existingInstall && force) {
            try {
                rmSync(existingInstall.installPath, { recursive: true, force: true });
            } catch (error) {
                throw PluginError.installCopyFailed(
                    absoluteSourcePath,
                    installPath,
                    `Failed to remove existing: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        const parentDir = path.dirname(installPath);
        if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
        }

        try {
            await copyDirectory(absoluteSourcePath, installPath);
        } catch (error) {
            throw PluginError.installCopyFailed(
                absoluteSourcePath,
                installPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    const installed = loadFiusInstalledPlugins();
    const now = new Date().toISOString();

    const entry: InstalledPluginEntry = {
        scope,
        installPath,
        version: validation.manifest.version,
        installedAt: now,
        lastUpdated: now,
        ...(scope !== 'user' && { projectPath: currentProjectPath }),
        ...(isLocal && { isLocal: true }),
    };

    if (!installed.plugins[pluginName]) {
        installed.plugins[pluginName] = [];
    }

    installed.plugins[pluginName] = installed.plugins[pluginName].filter((e) => {
        if (e.scope !== scope) return true;
        if (scope === 'user') return false;
        if (e.projectPath && currentProjectPath) {
            return (
                path.resolve(e.projectPath).toLowerCase() !==
                path.resolve(currentProjectPath).toLowerCase()
            );
        }
        return true;
    });

    installed.plugins[pluginName].push(entry);

    saveFiusInstalledPlugins(installed);

    return {
        success: true,
        pluginName,
        installPath,
        warnings,
    };
}
