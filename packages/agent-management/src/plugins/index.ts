/**
 * Plugin Loader
 *
 * Discovers and loads bundled plugins from community sources.
 * Supports Claude Code compatible plugins:
 * - .claude-plugin
 */

export type {
    PluginManifest,
    DiscoveredPlugin,
    PluginCommand,
    PluginMCPConfig,
    LoadedPlugin,
    PluginInstallScope,
    InstalledPluginEntry,
    InstalledPluginsFile,
    ListedPlugin,
    PluginValidationResult,
    PluginInstallResult,
    PluginUninstallResult,
} from './types.js';

export {
    PluginManifestSchema,
    PluginMCPConfigSchema,
    InstalledPluginEntrySchema,
    InstalledPluginsFileSchema,
} from './schemas.js';
export type {
    ValidatedPluginManifest,
    ValidatedPluginMCPConfig,
    ValidatedInstalledPluginsFile,
    ValidatedInstalledPluginEntry,
} from './schemas.js';

export { PluginErrorCode } from './error-codes.js';
export { PluginError } from './errors.js';

export {
    discoverClaudeCodePlugins,
    getPluginSearchPaths,
    getInstalledPluginsPath,
} from './discover-plugins.js';

export { discoverStandaloneSkills, getSkillSearchPaths } from './discover-skills.js';
export type { DiscoveredSkill } from './discover-skills.js';
export { LocalSkillSource } from './local-skill-source.js';
export type { LocalSkillRoot } from './local-skill-source.js';
export { createLocalSkillSources } from './local-skill-sources.js';
export type { CreateLocalSkillSourcesOptions } from './local-skill-sources.js';

export { loadClaudeCodePlugin } from './load-plugin.js';

export { validatePluginDirectory, tryLoadManifest } from './validate-plugin.js';

export { listInstalledPlugins, getFiusInstalledPluginsPath } from './list-plugins.js';

export {
    installPluginFromPath,
    loadFiusInstalledPlugins,
    saveFiusInstalledPlugins,
    isPluginInstalled,
    type InstallPluginOptions,
} from './install-plugin.js';

export { uninstallPlugin, type UninstallPluginOptions } from './uninstall-plugin.js';

export {
    type MarketplaceSourceType,
    type MarketplaceSource,
    type MarketplaceEntry,
    type KnownMarketplacesFile,
    type MarketplacePlugin,
    type MarketplaceAddResult,
    type MarketplaceRemoveResult,
    type MarketplaceUpdateResult,
    type MarketplaceInstallResult,
    type MarketplaceAddOptions,
    type MarketplaceInstallOptions,
    type MarketplaceManifest,
    MarketplaceSourceSchema,
    MarketplaceEntrySchema,
    KnownMarketplacesFileSchema,
    MarketplaceManifestSchema,
    MarketplacePluginEntrySchema,
    MarketplaceAddCommandSchema,
    MarketplaceInstallCommandSchema,
    MarketplaceErrorCode,
    MarketplaceError,
    DEFAULT_MARKETPLACES,
    getMarketplacesRegistryPath,
    getMarketplacesDir,
    getMarketplaceCacheDir,
    loadKnownMarketplaces,
    saveKnownMarketplaces,
    getMarketplaceEntry,
    marketplaceExists,
    getAllMarketplaces,
    getUninstalledDefaults,
    isDefaultMarketplace,
    parseMarketplaceSource,
    deriveMarketplaceName,
    addMarketplace,
    removeMarketplace,
    updateMarketplace,
    listMarketplaces,
    scanMarketplacePlugins,
    listAllMarketplacePlugins,
    findPluginInMarketplaces,
    parsePluginSpec,
    installPluginFromMarketplace,
    searchMarketplacePlugins,
} from './marketplace/index.js';
