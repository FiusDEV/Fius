/**
 * Plugin Discovery
 *
 * Discovers plugins from Fius locations following the plugin format.
 * Plugins must have a .claude-plugin/plugin.json manifest file.
 *
 * Discovery Methods (Priority Order):
 * 1. Read ~/.fius/plugins/installed_plugins.json for Fius installed plugins
 * 2. Scan directories for plugins with .claude-plugin/plugin.json manifests
 *
 * Search Locations for Directory Scanning:
 * 1. <cwd>/.fius/plugins/*     (project)
 * 2. ~/.fius/plugins/*         (user)
 *
 * First found wins on name collision (by plugin name).
 */

import * as path from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { getFiusGlobalPath } from '../utils/path.js';
import { InstalledPluginsFileSchema } from './schemas.js';
import { tryLoadManifest } from './validate-plugin.js';
import type { DiscoveredPlugin } from './types.js';

/**
 * Discovers plugins from Fius locations.
 *
 * @param projectPath Optional project path for filtering project-scoped plugins
 * @param bundledPluginPaths Optional array of absolute paths to bundled plugins from image definition
 * @returns Array of discovered plugins, deduplicated by name (first found wins)
 */
export function discoverClaudeCodePlugins(
    projectPath?: string,
    bundledPluginPaths?: string[]
): DiscoveredPlugin[] {
    const plugins: DiscoveredPlugin[] = [];
    const seenNames = new Set<string>();
    const cwd = projectPath || process.cwd();

    /**
     * Adds a plugin if not already seen (deduplication by name)
     */
    const addPlugin = (plugin: DiscoveredPlugin): boolean => {
        const normalizedName = plugin.manifest.name.toLowerCase();
        if (seenNames.has(normalizedName)) {
            return false;
        }
        seenNames.add(normalizedName);
        plugins.push(plugin);
        return true;
    };

    const fiusInstalledPluginsPath = getFiusGlobalPath('plugins', 'installed_plugins.json');
    const fiusInstalledPlugins = readInstalledPluginsFile(fiusInstalledPluginsPath, cwd);
    for (const plugin of fiusInstalledPlugins) {
        addPlugin(plugin);
    }

    /**
     * Scans a plugins directory and adds valid plugins to the list
     */
    const scanPluginsDir = (dir: string, source: 'project' | 'user'): void => {
        if (!existsSync(dir)) return;

        try {
            const entries = readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                if (entry.name === 'cache' || entry.name === 'marketplaces') continue;

                const pluginPath = path.join(dir, entry.name);
                const manifest = tryLoadManifest(pluginPath);
                if (manifest) {
                    addPlugin({
                        path: pluginPath,
                        manifest,
                        source,
                    });
                }
            }
        } catch {
        }
    };

    scanPluginsDir(path.join(cwd, '.fius', 'plugins'), 'project');

    scanPluginsDir(getFiusGlobalPath('plugins'), 'user');

    if (bundledPluginPaths && bundledPluginPaths.length > 0) {
        for (const pluginPath of bundledPluginPaths) {
            if (!existsSync(pluginPath)) {
                continue;
            }

            const manifest = tryLoadManifest(pluginPath);
            if (manifest) {
                addPlugin({
                    path: pluginPath,
                    manifest,
                    source: 'user',
                });
            }
        }
    }

    return plugins;
}

/**
 * Reads and parses installed_plugins.json
 *
 * Plugins are stored at paths like:
 *   ~/.fius/plugins/cache/<marketplace>/<plugin-name>/<version>/
 *
 * @param filePath Path to installed_plugins.json
 * @param currentProjectPath Current project path for filtering project-scoped plugins
 * @returns Array of discovered plugins from the installed plugins file
 */
function readInstalledPluginsFile(
    filePath: string,
    currentProjectPath: string
): DiscoveredPlugin[] {
    const plugins: DiscoveredPlugin[] = [];

    if (!existsSync(filePath)) {
        return plugins;
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = InstalledPluginsFileSchema.safeParse(parsed);

        if (!result.success) {
            return plugins;
        }

        const installedPlugins = result.data;

        const pluginsById = installedPlugins.plugins;

        for (const pluginId of Object.keys(pluginsById)) {
            const installations = pluginsById[pluginId] ?? [];

            for (const installation of installations) {
                const { scope, installPath, projectPath } = installation;

                if (!existsSync(installPath)) {
                    continue;
                }

                if ((scope === 'project' || scope === 'local') && projectPath) {
                    const normalizedProjectPath = path.resolve(projectPath).toLowerCase();
                    const normalizedCurrentPath = path.resolve(currentProjectPath).toLowerCase();
                    if (normalizedProjectPath !== normalizedCurrentPath) {
                        continue;
                    }
                }

                const manifest = tryLoadManifest(installPath);
                if (manifest) {
                    const source: 'project' | 'user' =
                        scope === 'project' || scope === 'local' ? 'project' : 'user';

                    plugins.push({
                        path: installPath,
                        manifest,
                        source,
                    });
                }
            }
        }
    } catch {
    }

    return plugins;
}

/**
 * Gets the search locations for plugins in priority order.
 * Useful for debugging and testing.
 *
 * @returns Array of plugin search paths
 */
export function getPluginSearchPaths(): string[] {
    const cwd = process.cwd();

    return [
        getFiusGlobalPath('plugins', 'installed_plugins.json'),
        path.join(cwd, '.fius', 'plugins'),
        getFiusGlobalPath('plugins'),
    ];
}

/**
 * Gets the path to Fius's installed_plugins.json file.
 *
 * @returns Absolute path to installed_plugins.json
 */
export function getInstalledPluginsPath(): string {
    return getFiusGlobalPath('plugins', 'installed_plugins.json');
}
