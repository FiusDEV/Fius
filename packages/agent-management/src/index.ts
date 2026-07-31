export { getAgentRegistry, loadBundledRegistryAgents } from './registry/registry.js';
export type { AgentRegistry, AgentRegistryEntry, Registry } from './registry/types.js';
export { deriveDisplayName } from './registry/types.js';
export { RegistryError } from './registry/errors.js';
export { RegistryErrorCode } from './registry/error-codes.js';

export {
    loadGlobalPreferences,
    saveGlobalPreferences,
    globalPreferencesExist,
    getGlobalPreferencesPath,
    createInitialPreferences,
    updateGlobalPreferences,
    type GlobalPreferencesUpdates,
    type CreatePreferencesOptions,
} from './preferences/loader.js';
export type { GlobalPreferences, AgentPreferences } from './preferences/schemas.js';
export {
    loadAgentPreferences,
    saveAgentPreferences,
    updateAgentPreferences,
    agentPreferencesExist,
    getAgentPreferencesPath,
} from './preferences/loader.js';
export { PreferenceError, PreferenceErrorCode } from './preferences/errors.js';

export { resolveAgentPath, updateDefaultAgentPreference } from './resolver.js';

export {
    writeConfigFile,
    writeLLMPreferences,
    writePreferencesToAgent,
    type LLMOverrides,
} from './writer.js';

export { AgentManager, type AgentMetadata } from './AgentManager.js';
export {
    ProjectRegistryEntrySchema,
    ProjectRegistrySchema,
    getProjectRegistryPath,
    getProjectRegistryCandidatePaths,
    findProjectRegistryPath,
    findProjectRegistryPathSync,
    readProjectRegistry,
    readProjectRegistrySync,
    loadProjectRegistry,
    loadProjectRegistrySync,
    getDefaultProjectRegistryEntry,
    resolveProjectRegistryEntryConfigPath,
    resolveProjectRegistryEntryConfigPathSync,
    resolveProjectRegistryEntry,
    resolveProjectRegistryAgentPath,
    resolveDefaultProjectRegistryAgentPath,
    ProjectRegistryError,
    isProjectRegistryError,
    type ProjectRegistryEntry,
    type ProjectRegistry,
    type ProjectRegistryErrorCode,
} from './project-registry.js';

export {
    installBundledAgent,
    installCustomAgent,
    uninstallAgent,
    listInstalledAgents,
    type InstallOptions,
} from './installation.js';

export { AgentFactory, type CreateAgentOptions } from './AgentFactory.js';
export { createFiusAgentFromConfig } from './agent-creation.js';

export {
    getDefaultImageStoreDir,
    getImageRegistryPath,
    getImagePackagesDir,
    getImagePackageInstallDir,
    loadImageRegistry,
    saveImageRegistry,
    parseImageSpecifier,
    isFileLikeImageSpecifier,
    resolveFileLikeImageSpecifierToPath,
    resolveFileLikeImageSpecifierToFileUrl,
    resolveImageEntryFileFromStore,
    setActiveImageVersion,
    removeImageFromStore,
    type ImageRegistryFile,
    type ImageSpecifierParts,
} from './images/image-store.js';

export {
    getFiusPackageRoot,
    getFiusPath,
    getFiusGlobalPath,
    getFiusEnvPath,
    copyDirectory,
    isPath,
    findPackageRoot,
    resolveBundledScript,
    ensureFiusGlobalDirectory,
} from './utils/path.js';
export {
    getExecutionContext,
    findFiusSourceRoot,
    findFiusProjectRoot,
    type ExecutionContext,
} from './utils/execution-context.js';
export { walkUpDirectories } from './utils/fs-walk.js';
export { updateEnvFile } from './utils/env-file.js';
export { isFiusAuthEnabled } from './utils/feature-flags.js';
export {
    isFiusAuthenticated,
    getFiusApiKeyFromAuth,
    canUseFiusProvider,
} from './utils/fius-auth.js';

export {
    updateAgentConfigFile,
    reloadAgentConfigFromFile,
    loadAgentConfig,
    enrichAgentConfig,
    deriveAgentId,
    addPromptToAgentConfig,
    removePromptFromAgentConfig,
    deletePromptByMetadata,
    updateMcpServerField,
    removeMcpServerFromConfig,
    ConfigError,
    ConfigErrorCode,
    type FilePromptInput,
    type InlinePromptInput,
    type PromptInput,
    type PromptMetadataForDeletion,
    type PromptDeletionResult,
} from './config/index.js';

export {
    saveProviderApiKey,
    getProviderKeyStatus,
    listProviderKeyStatus,
    determineApiKeyStorage,
    SHARED_API_KEY_PROVIDERS,
    type ApiKeyStorageStrategy,
} from './utils/api-key-store.js';
export {
    resolveApiKeyForProvider,
    getPrimaryApiKeyEnvVar,
    PROVIDER_API_KEY_MAP,
} from './utils/api-key-resolver.js';

export {
    AUTH_METHOD_KINDS,
    OPENAI_API_KEY_AUTH_METHOD,
    OPENAI_CHATGPT_LOGIN_AUTH_METHOD,
    PROVIDER_AUTH_DEFINITIONS,
    getAuthMethodDefinition,
    getProviderAuthDefinition,
    getProviderAuthDefinitions,
    isOAuthAuthMethod,
    createChatGPTRuntimeAuth,
    createModelAuthResolver,
    deleteModelAuthProfile,
    getDefaultModelAuthProfile,
    getDefaultModelAuthProfileIdForProvider,
    getModelAuthProfileId,
    getModelAuthProfilesPath,
    listModelAuthProfiles,
    listSavedModelAuthProfiles,
    loadModelAuthProfiles,
    loadModelAuthProfilesSync,
    markModelAuthProviderConnected,
    refreshChatGPTOAuthCredential,
    saveApiKeyModelAuthProfile,
    saveChatGPTLoginModelAuthProfile,
    setDefaultModelAuthProfile,
    startModelAuthBrowserLogin,
    startChatGPTBrowserLogin,
    upsertModelAuthProfile,
    type ApiKeyAuthMethodDefinition,
    type AuthMethodDefinition,
    type AuthMethodKind,
    type ChatGPTOAuthCredential,
    type ChatGPTRuntimeAuth,
    type ApiKeyEnvModelAuthCredential,
    type ModelAuthCredential,
    type OAuthAuthMethodDefinition,
    type OAuthModelAuthCredential,
    type ModelAuthProfile,
    type ModelAuthProfilesFile,
    type PendingChatGPTLogin,
    type PendingModelAuthBrowserLogin,
    type ProviderAuthDefinition,
} from './auth/index.js';

export {
    loadCustomModels,
    saveCustomModel,
    deleteCustomModel,
    getCustomModel,
    getCustomModelsPath,
    CustomModelSchema,
    type CustomModel,
    type CustomModelProvider,
} from './models/custom-models.js';

export {
    getModelsDirectory,
    getModelFilePath,
    getModelDirectory,
    getModelStatePath,
    getModelPickerStatePath,
    getModelTempDirectory,
    ensureModelsDirectory,
    ensureModelDirectory,
    modelFileExists,
    getModelFileSize,
    deleteModelDirectory,
    listModelDirectories,
    getModelsDiskUsage,
    formatSize,
    type ModelSource,
    type InstalledModel,
    type ModelState,
    loadModelState,
    saveModelState,
    addInstalledModel,
    removeInstalledModel,
    getInstalledModel,
    getAllInstalledModels,
    isModelInstalled,
    updateModelLastUsed,
    setActiveModel,
    getActiveModelId,
    getActiveModel,
    addToDownloadQueue,
    removeFromDownloadQueue,
    getDownloadQueue,
    syncStateWithFilesystem,
    getTotalInstalledSize,
    getInstalledModelCount,
    registerManualModel,
    MODEL_PICKER_STATE_VERSION,
    MODEL_PICKER_RECENTS_LIMIT,
    MODEL_PICKER_FAVORITES_LIMIT,
    toModelPickerKey,
    pruneModelPickerState,
    loadModelPickerState,
    saveModelPickerState,
    recordRecentModel,
    toggleFavoriteModel,
    setFavoriteModels,
    type ModelPickerModel,
    type ModelPickerEntry,
    type ModelPickerState,
    type SetFavoriteModelsInput,
} from './models/index.js';

export * from './runtime/index.js';

export * from './tool-factories/agent-spawner/index.js';
export * from './tool-factories/creator-tools/index.js';

export {
    discoverClaudeCodePlugins,
    getPluginSearchPaths,
    loadClaudeCodePlugin,
    validatePluginDirectory,
    tryLoadManifest,
    listInstalledPlugins,
    getFiusInstalledPluginsPath,
    installPluginFromPath,
    loadFiusInstalledPlugins,
    saveFiusInstalledPlugins,
    isPluginInstalled,
    uninstallPlugin,
    PluginManifestSchema,
    PluginMCPConfigSchema,
    PluginErrorCode,
    PluginError,
    DEFAULT_MARKETPLACES,
    addMarketplace,
    removeMarketplace,
    updateMarketplace,
    listMarketplaces,
    listAllMarketplacePlugins,
    installPluginFromMarketplace,
    getUninstalledDefaults,
    createLocalSkillSources,
    LocalSkillSource,
    isDefaultMarketplace,
    marketplaceExists,
    MarketplaceErrorCode,
    MarketplaceError,
    type PluginManifest,
    type DiscoveredPlugin,
    type PluginCommand,
    type PluginMCPConfig,
    type LoadedPlugin,
    type PluginInstallScope,
    type InstalledPluginEntry,
    type InstalledPluginsFile,
    type ListedPlugin,
    type PluginValidationResult,
    type PluginInstallResult,
    type PluginUninstallResult,
    type ValidatedPluginManifest,
    type ValidatedPluginMCPConfig,
    type InstallPluginOptions,
    type UninstallPluginOptions,
    type CreateLocalSkillSourcesOptions,
    type LocalSkillRoot,
    type MarketplaceEntry,
    type MarketplacePlugin,
    type MarketplaceAddResult,
    type MarketplaceUpdateResult,
    type MarketplaceInstallResult,
} from './plugins/index.js';
