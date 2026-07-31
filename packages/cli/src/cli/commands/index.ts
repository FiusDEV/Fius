
export { createFiusProject, type CreateAppOptions } from './create-app.js';

export { createImage } from './create-image.js';

export {
    handleInitCommand,
    handleInitAgentCommand,
    handleInitPrimaryCommand,
    handleInitSkillCommand,
} from './init.js';
export { getUserInputToInitFiusApp, initFius, postInitFius } from './init-app.js';

export { handleSetupCommand, type CLISetupOptions, type CLISetupOptionsInput } from './setup.js';
export { handleConnectCommand, type ConnectCommandOptions } from './connect.js';
export { handleInstallCommand, type InstallCommandOptions } from './agents/install.js';
export { handleUninstallCommand, type UninstallCommandOptions } from './agents/uninstall.js';
export { handleUpgradeCommand, type UpgradeCommandOptions } from './upgrade.js';
export { handleUninstallCliCommand, type UninstallCliCommandOptions } from './uninstall.js';
export {
    handleListAgentsCommand,
    type ListAgentsCommandOptions,
    type ListAgentsCommandOptionsInput,
} from './agents/list.js';
export { handleWhichCommand, type WhichCommandOptions } from './which.js';
export {
    handleSyncAgentsCommand,
    shouldPromptForSync,
    type SyncAgentsCommandOptions,
} from './agents/sync.js';


export {
    handleImageInstallCommand,
    handleImageListCommand,
    handleImageUseCommand,
    handleImageRemoveCommand,
    handleImageDoctorCommand,
    type ImageInstallCommandOptions,
    type ImageInstallCommandOptionsInput,
} from './image.js';


export { handleLoginCommand, handleLogoutCommand, handleStatusCommand } from './auth/index.js';


export { handleBillingStatusCommand } from './billing/index.js';


export {
    handlePluginListCommand,
    handlePluginInstallCommand,
    handlePluginUninstallCommand,
    handlePluginValidateCommand,
    handleMarketplaceAddCommand,
    handleMarketplaceRemoveCommand,
    handleMarketplaceUpdateCommand,
    handleMarketplaceListCommand,
    handleMarketplacePluginsCommand,
    handleMarketplaceInstallCommand,
    type PluginListCommandOptions,
    type PluginListCommandOptionsInput,
    type PluginInstallCommandOptions,
    type PluginInstallCommandOptionsInput,
    type PluginUninstallCommandOptions,
    type PluginUninstallCommandOptionsInput,
    type PluginValidateCommandOptions,
    type PluginValidateCommandOptionsInput,
    type MarketplaceAddCommandOptionsInput,
    type MarketplaceRemoveCommandOptionsInput,
    type MarketplaceUpdateCommandOptionsInput,
    type MarketplaceListCommandOptionsInput,
    type MarketplaceInstallCommandOptionsInput,
} from './plugin.js';