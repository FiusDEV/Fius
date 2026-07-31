/**
 * Plugin Uninstallation
 *
 * Uninstalls plugins from Fius's plugin directory.
 * Removes plugin files and updates installed_plugins.json.
 */

import * as path from 'path';
import { existsSync, readFileSync, rmSync } from 'fs';
import { loadFiusInstalledPlugins, saveFiusInstalledPlugins } from './install-plugin.js';
import { PluginError } from './errors.js';
import type { PluginUninstallResult, InstalledPluginEntry } from './types.js';

/**
 * Options for plugin uninstallation
 */
export interface UninstallPluginOptions {
    /** Project path for filtering project-scoped plugins */
    projectPath?: string;
}

/**
 * Finds a plugin installation entry by name.
 *
 * @param pluginName Plugin name to find
 * @param projectPath Optional project path for project-scoped filtering
 * @returns Installation entry if found, null otherwise
 */
function findPluginInstallation(
    pluginName: string,
    projectPath?: string
): { entry: InstalledPluginEntry; pluginId: string } | null {
    const installed = loadFiusInstalledPlugins();
    const normalizedName = pluginName.toLowerCase();
    const currentProjectPath = projectPath || process.cwd();

    if (installed.plugins[pluginName]) {
        const installations = installed.plugins[pluginName];
        for (const entry of installations) {
            if ((entry.scope === 'project' || entry.scope === 'local') && entry.projectPath) {
                const normalizedInstallProject = path.resolve(entry.projectPath).toLowerCase();
                const normalizedCurrentProject = path.resolve(currentProjectPath).toLowerCase();
                if (normalizedInstallProject === normalizedCurrentProject) {
                    return { entry, pluginId: pluginName };
                }
                continue;
            }
            return { entry, pluginId: pluginName };
        }
    }

    for (const [pluginId, installations] of Object.entries(installed.plugins)) {
        for (const entry of installations) {
            const manifestPath = path.join(entry.installPath, '.claude-plugin', 'plugin.json');
            if (!existsSync(manifestPath)) continue;

            try {
                const content = readFileSync(manifestPath, 'utf-8');
                const manifest = JSON.parse(content);
                if (manifest.name?.toLowerCase() !== normalizedName) continue;

                if ((entry.scope === 'project' || entry.scope === 'local') && entry.projectPath) {
                    const normalizedInstallProject = path.resolve(entry.projectPath).toLowerCase();
                    const normalizedCurrentProject = path.resolve(currentProjectPath).toLowerCase();
                    if (normalizedInstallProject === normalizedCurrentProject) {
                        return { entry, pluginId };
                    }
                    continue;
                }
                return { entry, pluginId };
            } catch {
                continue;
            }
        }
    }

    return null;
}

/**
 * Uninstalls a plugin by name.
 * Accepts both "name" and "name@version" formats.
 *
 * @param pluginName Plugin name to uninstall (with optional @version suffix)
 * @param options Uninstallation options
 * @returns Uninstallation result with success status
 */
export async function uninstallPlugin(
    pluginName: string,
    options?: UninstallPluginOptions
): Promise<PluginUninstallResult> {
    const { projectPath } = options || {};

    const atIndex = pluginName.lastIndexOf('@');
    const SEMVER_SUFFIX = /^(?:v)?\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
    const nameWithoutVersion =
        atIndex > 0 && SEMVER_SUFFIX.test(pluginName.slice(atIndex + 1))
            ? pluginName.slice(0, atIndex)
            : pluginName;

    const found = findPluginInstallation(nameWithoutVersion, projectPath);
    if (!found) {
        throw PluginError.uninstallNotFound(nameWithoutVersion);
    }

    const { entry, pluginId } = found;

    let removedPath: string | undefined;
    const shouldDeleteFiles = !entry.isLocal;

    if (shouldDeleteFiles) {
        try {
            rmSync(entry.installPath, { recursive: true, force: true });
            removedPath = entry.installPath;
        } catch (error) {
            throw PluginError.uninstallDeleteFailed(
                entry.installPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    } else {
        removedPath = entry.installPath;
    }

    const installed = loadFiusInstalledPlugins();
    const currentProjectPath = projectPath || process.cwd();

    if (installed.plugins[pluginId]) {
        installed.plugins[pluginId] = installed.plugins[pluginId].filter((e) => {
            if (e.installPath !== entry.installPath) return true;

            if (e.scope === entry.scope) {
                if ((e.scope === 'project' || e.scope === 'local') && e.projectPath) {
                    const normalizedEntryProject = path.resolve(e.projectPath).toLowerCase();
                    const normalizedCurrentProject = path.resolve(currentProjectPath).toLowerCase();
                    return normalizedEntryProject !== normalizedCurrentProject;
                }
                return false;
            }
            return true;
        });

        if (installed.plugins[pluginId].length === 0) {
            delete installed.plugins[pluginId];
        }
    }

    saveFiusInstalledPlugins(installed);

    return {
        success: true,
        removedPath,
    };
}
