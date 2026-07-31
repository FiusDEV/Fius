/**
 * Plugin Marketplace Operations
 *
 * Handles adding, removing, updating, and listing marketplaces.
 */

import * as path from 'path';
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import {
    getMarketplacesDir,
    addMarketplaceEntry,
    removeMarketplaceEntry,
    getMarketplaceEntry,
    getAllMarketplaces,
    updateMarketplaceTimestamp,
} from './registry.js';
import { MarketplaceError } from './errors.js';
import { MarketplaceManifestSchema } from './schemas.js';
import { tryLoadManifest } from '../validate-plugin.js';
import type {
    MarketplaceSource,
    MarketplaceEntry,
    MarketplacePlugin,
    MarketplaceAddOptions,
    MarketplaceAddResult,
    MarketplaceRemoveResult,
    MarketplaceUpdateResult,
    MarketplaceManifest,
} from './types.js';

/**
 * Parse a source string to determine its type and value
 */
export function parseMarketplaceSource(source: string): MarketplaceSource {
    const trimmed = source.trim();

    if (
        trimmed.startsWith('/') ||
        trimmed.startsWith('./') ||
        trimmed.startsWith('../') ||
        trimmed.startsWith('~/')
    ) {
        return { type: 'local', value: trimmed };
    }

    if (trimmed.includes('://') || trimmed.endsWith('.git')) {
        return { type: 'git', value: trimmed };
    }

    const githubMatch = /^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/.exec(trimmed);
    if (githubMatch) {
        return { type: 'github', value: trimmed };
    }

    return { type: 'git', value: trimmed };
}

/**
 * Derive a marketplace name from its source
 */
export function deriveMarketplaceName(source: MarketplaceSource): string {
    switch (source.type) {
        case 'github': {
            const parts = source.value.split('/');
            return parts[parts.length - 1] ?? source.value;
        }
        case 'git': {
            const url = source.value.replace(/\.git$/, '');
            const parts = url.split('/');
            return parts[parts.length - 1] ?? 'marketplace';
        }
        case 'local': {
            const resolved = source.value.startsWith('~')
                ? source.value.replace('~', process.env.HOME || '')
                : path.resolve(source.value);
            return path.basename(resolved);
        }
    }
}

/**
 * Get the git clone URL for a source
 */
function getCloneUrl(source: MarketplaceSource): string {
    switch (source.type) {
        case 'github':
            return `https://github.com/${source.value}.git`;
        case 'git':
            return source.value;
        case 'local':
            throw new Error('Cannot clone local source');
    }
}

/**
 * Get the current git commit SHA in a directory
 */
function getGitSha(dir: string): string | undefined {
    try {
        const result = execSync('git rev-parse HEAD', {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return result.trim();
    } catch {
        return undefined;
    }
}

/**
 * Add a marketplace
 */
export async function addMarketplace(
    source: string,
    options: MarketplaceAddOptions = {}
): Promise<MarketplaceAddResult> {
    const parsedSource = parseMarketplaceSource(source);
    const name = options.name || deriveMarketplaceName(parsedSource);
    const warnings: string[] = [];

    const existing = getMarketplaceEntry(name);
    if (existing) {
        throw MarketplaceError.addAlreadyExists(name, existing.installLocation);
    }

    let installLocation: string;

    if (parsedSource.type === 'local') {
        const localPath = parsedSource.value.startsWith('~')
            ? parsedSource.value.replace('~', process.env.HOME || '')
            : path.resolve(parsedSource.value);

        if (!existsSync(localPath)) {
            throw MarketplaceError.addLocalNotFound(localPath);
        }

        installLocation = localPath;
    } else {
        const marketplacesDir = getMarketplacesDir();
        installLocation = path.join(marketplacesDir, name);

        const cloneUrl = getCloneUrl(parsedSource);

        try {
            execSync(`git clone "${cloneUrl}" "${installLocation}"`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (error) {
            throw MarketplaceError.addCloneFailed(
                source,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    const plugins = scanMarketplacePlugins(installLocation, name);

    if (plugins.length === 0) {
        warnings.push('No plugins found in marketplace');
    }

    const entry: MarketplaceEntry = {
        name,
        source: parsedSource,
        installLocation,
        lastUpdated: new Date().toISOString(),
    };

    addMarketplaceEntry(entry);

    return {
        success: true,
        name,
        pluginCount: plugins.length,
        warnings,
    };
}

/**
 * Remove a marketplace
 */
export async function removeMarketplace(name: string): Promise<MarketplaceRemoveResult> {
    const entry = getMarketplaceEntry(name);

    if (!entry) {
        throw MarketplaceError.removeNotFound(name);
    }

    if (entry.source.type !== 'local') {
        try {
            if (existsSync(entry.installLocation)) {
                rmSync(entry.installLocation, { recursive: true, force: true });
            }
        } catch (error) {
            throw MarketplaceError.removeDeleteFailed(
                name,
                entry.installLocation,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    removeMarketplaceEntry(name);

    return {
        success: true,
        name,
    };
}

/**
 * Update a marketplace (git pull)
 */
export async function updateMarketplace(name?: string): Promise<MarketplaceUpdateResult[]> {
    const results: MarketplaceUpdateResult[] = [];

    if (name) {
        const result = await updateSingleMarketplace(name);
        results.push(result);
    } else {
        const marketplaces = getAllMarketplaces();
        for (const marketplace of marketplaces) {
            const result = await updateSingleMarketplace(marketplace.name);
            results.push(result);
        }
    }

    return results;
}

/**
 * Update a single marketplace
 */
async function updateSingleMarketplace(name: string): Promise<MarketplaceUpdateResult> {
    const entry = getMarketplaceEntry(name);

    if (!entry) {
        throw MarketplaceError.updateNotFound(name);
    }

    const warnings: string[] = [];

    if (entry.source.type === 'local') {
        return {
            success: true,
            name,
            hasChanges: false,
            warnings: ['Local marketplaces do not support automatic updates'],
        };
    }

    if (!existsSync(entry.installLocation)) {
        warnings.push('Marketplace directory not found, re-cloning');
        const cloneUrl = getCloneUrl(entry.source);
        try {
            execSync(`git clone "${cloneUrl}" "${entry.installLocation}"`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (error) {
            throw MarketplaceError.updatePullFailed(
                name,
                error instanceof Error ? error.message : String(error)
            );
        }

        updateMarketplaceTimestamp(name);

        const newShaValue = getGitSha(entry.installLocation);
        return {
            success: true,
            name,
            ...(newShaValue !== undefined && { newSha: newShaValue }),
            hasChanges: true,
            warnings,
        };
    }

    const previousShaValue = getGitSha(entry.installLocation);

    try {
        execSync('git pull --ff-only', {
            cwd: entry.installLocation,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    } catch (error) {
        throw MarketplaceError.updatePullFailed(
            name,
            error instanceof Error ? error.message : String(error)
        );
    }

    const newShaValue = getGitSha(entry.installLocation);
    const hasChanges = previousShaValue !== newShaValue;

    if (hasChanges) {
        updateMarketplaceTimestamp(name);
    }

    return {
        success: true,
        name,
        ...(previousShaValue !== undefined && { previousSha: previousShaValue }),
        ...(newShaValue !== undefined && { newSha: newShaValue }),
        hasChanges,
        warnings,
    };
}

/**
 * List all registered marketplaces
 */
export function listMarketplaces(): MarketplaceEntry[] {
    return getAllMarketplaces();
}

/**
 * Scan a marketplace directory for plugins
 */
export function scanMarketplacePlugins(
    marketplacePath: string,
    marketplaceName: string
): MarketplacePlugin[] {
    const plugins: MarketplacePlugin[] = [];

    const manifestPath = path.join(marketplacePath, 'marketplace.json');
    if (existsSync(manifestPath)) {
        try {
            const content = readFileSync(manifestPath, 'utf-8');
            const parsed = JSON.parse(content);
            const result = MarketplaceManifestSchema.safeParse(parsed);

            if (result.success) {
                const manifest = result.data as MarketplaceManifest;
                if (manifest.plugins && manifest.plugins.length > 0) {
                    for (const plugin of manifest.plugins) {
                        const pluginPath = path.join(marketplacePath, plugin.source);
                        if (existsSync(pluginPath)) {
                            plugins.push({
                                name: plugin.name,
                                ...(plugin.description !== undefined && {
                                    description: plugin.description,
                                }),
                                ...(plugin.version !== undefined && { version: plugin.version }),
                                ...(plugin.category !== undefined && { category: plugin.category }),
                                sourcePath: pluginPath,
                                marketplace: marketplaceName,
                            });
                        }
                    }
                    return plugins;
                }
            }
        } catch {
        }
    }

    const pluginDirs = ['plugins', 'external_plugins'];

    for (const dir of pluginDirs) {
        const dirPath = path.join(marketplacePath, dir);
        if (!existsSync(dirPath)) continue;

        try {
            const entries = readdirSync(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const pluginPath = path.join(dirPath, entry.name);

                const manifest = tryLoadManifest(pluginPath);
                if (manifest) {
                    plugins.push({
                        name: manifest.name,
                        ...(manifest.description !== undefined && {
                            description: manifest.description,
                        }),
                        ...(manifest.version !== undefined && { version: manifest.version }),
                        sourcePath: pluginPath,
                        marketplace: marketplaceName,
                    });
                }
            }
        } catch {
        }
    }

    try {
        const rootEntries = readdirSync(marketplacePath, { withFileTypes: true });

        for (const entry of rootEntries) {
            if (!entry.isDirectory()) continue;
            if (['plugins', 'external_plugins', '.git', 'node_modules'].includes(entry.name))
                continue;

            const pluginPath = path.join(marketplacePath, entry.name);

            const manifest = tryLoadManifest(pluginPath);
            if (manifest) {
                const existing = plugins.find((p) => p.name === manifest.name);
                if (!existing) {
                    plugins.push({
                        name: manifest.name,
                        ...(manifest.description !== undefined && {
                            description: manifest.description,
                        }),
                        ...(manifest.version !== undefined && { version: manifest.version }),
                        sourcePath: pluginPath,
                        marketplace: marketplaceName,
                    });
                }
            }
        }
    } catch {
    }

    return plugins;
}

/**
 * List all plugins across all marketplaces
 */
export function listAllMarketplacePlugins(): MarketplacePlugin[] {
    const marketplaces = listMarketplaces();
    const allPlugins: MarketplacePlugin[] = [];

    for (const marketplace of marketplaces) {
        if (!existsSync(marketplace.installLocation)) continue;

        const plugins = scanMarketplacePlugins(marketplace.installLocation, marketplace.name);
        allPlugins.push(...plugins);
    }

    return allPlugins;
}

/**
 * Find a plugin by name across all marketplaces
 */
export function findPluginInMarketplaces(
    pluginName: string,
    marketplaceName?: string
): MarketplacePlugin | null {
    const marketplaces = marketplaceName
        ? ([getMarketplaceEntry(marketplaceName)].filter(Boolean) as MarketplaceEntry[])
        : listMarketplaces();

    for (const marketplace of marketplaces) {
        if (!existsSync(marketplace.installLocation)) continue;

        const plugins = scanMarketplacePlugins(marketplace.installLocation, marketplace.name);
        const found = plugins.find((p) => p.name.toLowerCase() === pluginName.toLowerCase());

        if (found) {
            return found;
        }
    }

    return null;
}
