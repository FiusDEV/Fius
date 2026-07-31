/**
 * Plugin Listing
 *
 * Lists all installed plugins managed by Fius:
 * 1. Fius's installed_plugins.json (~/.fius/plugins/installed_plugins.json)
 * 2. Directory scanning of Fius plugin directories (project and user)
 *
 * Deduplicates by plugin name (first found wins).
 */

import * as path from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { getFiusGlobalPath } from '../utils/path.js';
import { InstalledPluginsFileSchema } from './schemas.js';
import { tryLoadManifest } from './validate-plugin.js';
import type { ListedPlugin } from './types.js';

/**
 * Path to Fius's installed_plugins.json
 */
export function getFiusInstalledPluginsPath(): string {
    return getFiusGlobalPath('plugins', 'installed_plugins.json');
}

/**
 * Lists all installed plugins managed by Fius.
 *
 * Discovery sources:
 * 1. ~/.fius/plugins/installed_plugins.json (tracked installations)
 * 2. Directory scanning of .fius/plugins (project and user)
 *
 * @param projectPath Optional project path for filtering project-scoped plugins
 * @returns Array of listed plugins, deduplicated by name (first found wins)
 */
export function listInstalledPlugins(projectPath?: string): ListedPlugin[] {
    const plugins: ListedPlugin[] = [];
    const seenNames = new Set<string>();
    const cwd = projectPath || process.cwd();

    /**
     * Adds a plugin if not already seen (deduplication by name)
     */
    const addPlugin = (plugin: ListedPlugin): boolean => {
        const normalizedName = plugin.name.toLowerCase();
        if (seenNames.has(normalizedName)) {
            return false;
        }
        seenNames.add(normalizedName);
        plugins.push(plugin);
        return true;
    };

    const { plugins: fiusPlugins } = readFiusInstalledPlugins(cwd);
    for (const plugin of fiusPlugins) {
        addPlugin(plugin);
    }

    const scanPluginsDir = (dir: string): void => {
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
                        name: manifest.name,
                        description: manifest.description,
                        version: manifest.version,
                        path: pluginPath,
                        source: 'fius',
                    });
                }
            }
        } catch {
        }
    };

    scanPluginsDir(path.join(cwd, '.fius', 'plugins'));

    scanPluginsDir(getFiusGlobalPath('plugins'));

    return plugins;
}

/**
 * Reads Fius's installed_plugins.json and returns ListedPlugin array.
 */
function readFiusInstalledPlugins(currentProjectPath: string): {
    plugins: ListedPlugin[];
} {
    const plugins: ListedPlugin[] = [];
    const filePath = getFiusInstalledPluginsPath();

    if (!existsSync(filePath)) {
        return { plugins };
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = InstalledPluginsFileSchema.safeParse(parsed);

        if (!result.success) {
            return { plugins };
        }

        const installedPlugins = result.data.plugins;
        for (const pluginId of Object.keys(installedPlugins)) {
            const installations = installedPlugins[pluginId] ?? [];
            for (const installation of installations) {
                const { scope, installPath, version, installedAt, projectPath } = installation;

                if (!existsSync(installPath)) {
                    continue;
                }

                const manifest = tryLoadManifest(installPath);
                if (manifest) {
                    if ((scope === 'project' || scope === 'local') && projectPath) {
                        const normalizedProjectPath = path.resolve(projectPath).toLowerCase();
                        const normalizedCurrentPath = path
                            .resolve(currentProjectPath)
                            .toLowerCase();
                        if (normalizedProjectPath !== normalizedCurrentPath) {
                            continue;
                        }
                    }

                    plugins.push({
                        name: manifest.name,
                        description: manifest.description,
                        version: version || manifest.version,
                        path: installPath,
                        source: 'fius',
                        scope,
                        installedAt,
                    });
                }
            }
        }
    } catch {
    }

    return { plugins };
}
