import { z } from 'zod';
import chalk from 'chalk';
import {
    listInstalledPlugins,
    installPluginFromPath,
    uninstallPlugin,
    validatePluginDirectory,
    type PluginInstallScope,

    addMarketplace,
    removeMarketplace,
    updateMarketplace,
    listMarketplaces,
    listAllMarketplacePlugins,
    installPluginFromMarketplace,
} from '@fiusdev/agent-management';



const PluginListCommandSchema = z
    .object({
        verbose: z.boolean().default(false).describe('Show detailed plugin information'),
    })
    .strict();

const PluginInstallCommandSchema = z
    .object({
        path: z.string().min(1).describe('Path to the plugin directory'),
        scope: z.enum(['user', 'project', 'local']).default('user').describe('Installation scope'),
        force: z.boolean().default(false).describe('Force overwrite if already installed'),
    })
    .strict();

const PluginUninstallCommandSchema = z
    .object({
        name: z.string().min(1).describe('Name of the plugin to uninstall'),
    })
    .strict();

const PluginValidateCommandSchema = z
    .object({
        path: z.string().default('.').describe('Path to the plugin directory to validate'),
    })
    .strict();



const MarketplaceAddCommandSchema = z
    .object({
        source: z
            .string()
            .min(1)
            .describe('Marketplace source (owner/repo, git URL, or local path)'),
        name: z.string().optional().describe('Custom name for the marketplace'),
    })
    .strict();

const MarketplaceRemoveCommandSchema = z
    .object({
        name: z.string().min(1).describe('Name of the marketplace to remove'),
    })
    .strict();

const MarketplaceUpdateCommandSchema = z
    .object({
        name: z.string().optional().describe('Name of the marketplace to update (all if omitted)'),
    })
    .strict();

const MarketplaceListCommandSchema = z
    .object({
        verbose: z.boolean().default(false).describe('Show detailed marketplace information'),
    })
    .strict();

const MarketplaceInstallCommandSchema = z
    .object({
        plugin: z.string().min(1).describe('Plugin spec: name or name@marketplace'),
        scope: z.enum(['user', 'project', 'local']).default('user').describe('Installation scope'),
        force: z.boolean().default(false).describe('Force reinstall if already exists'),
    })
    .strict();



export type PluginListCommandOptions = z.output<typeof PluginListCommandSchema>;
export type PluginListCommandOptionsInput = z.input<typeof PluginListCommandSchema>;

export type PluginInstallCommandOptions = z.output<typeof PluginInstallCommandSchema>;
export type PluginInstallCommandOptionsInput = z.input<typeof PluginInstallCommandSchema>;

export type PluginUninstallCommandOptions = z.output<typeof PluginUninstallCommandSchema>;
export type PluginUninstallCommandOptionsInput = z.input<typeof PluginUninstallCommandSchema>;

export type PluginValidateCommandOptions = z.output<typeof PluginValidateCommandSchema>;
export type PluginValidateCommandOptionsInput = z.input<typeof PluginValidateCommandSchema>;


export type MarketplaceAddCommandOptions = z.output<typeof MarketplaceAddCommandSchema>;
export type MarketplaceAddCommandOptionsInput = z.input<typeof MarketplaceAddCommandSchema>;

export type MarketplaceRemoveCommandOptions = z.output<typeof MarketplaceRemoveCommandSchema>;
export type MarketplaceRemoveCommandOptionsInput = z.input<typeof MarketplaceRemoveCommandSchema>;

export type MarketplaceUpdateCommandOptions = z.output<typeof MarketplaceUpdateCommandSchema>;
export type MarketplaceUpdateCommandOptionsInput = z.input<typeof MarketplaceUpdateCommandSchema>;

export type MarketplaceListCommandOptions = z.output<typeof MarketplaceListCommandSchema>;
export type MarketplaceListCommandOptionsInput = z.input<typeof MarketplaceListCommandSchema>;

export type MarketplaceInstallCommandOptions = z.output<typeof MarketplaceInstallCommandSchema>;
export type MarketplaceInstallCommandOptionsInput = z.input<typeof MarketplaceInstallCommandSchema>;



export async function handlePluginListCommand(
    options: PluginListCommandOptionsInput
): Promise<void> {
    const validated = PluginListCommandSchema.parse(options);
    const plugins = listInstalledPlugins();

    if (plugins.length === 0) {
        console.log(chalk.yellow('No plugins installed.'));
        console.log('');
        console.log('Install a plugin with:');
        console.log(chalk.cyan('  fius plugin install --path <path-to-plugin>'));
        return;
    }

    console.log(chalk.bold(`Installed Plugins (${plugins.length}):`));
    console.log('');

    for (const plugin of plugins) {
        const sourceLabel = getSourceLabel(plugin.source);
        const scopeLabel = plugin.scope ? ` [${plugin.scope}]` : '';

        console.log(
            `  ${chalk.green(plugin.name)}${chalk.dim('@' + (plugin.version || 'unknown'))} ${sourceLabel}${scopeLabel}`
        );

        if (validated.verbose) {
            if (plugin.description) {
                console.log(chalk.dim(`    ${plugin.description}`));
            }
            console.log(chalk.dim(`    Path: ${plugin.path}`));
            if (plugin.installedAt) {
                const date = new Date(plugin.installedAt).toLocaleDateString();
                console.log(chalk.dim(`    Installed: ${date}`));
            }
        }
    }

    console.log('');
}

export async function handlePluginInstallCommand(
    options: PluginInstallCommandOptionsInput
): Promise<void> {
    const validated = PluginInstallCommandSchema.parse(options);

    console.log(chalk.cyan(`Installing plugin from ${validated.path}...`));
    console.log('');

    const result = await installPluginFromPath(validated.path, {
        scope: validated.scope as PluginInstallScope,
        force: validated.force,
    });


    if (result.warnings.length > 0) {
        console.log(chalk.yellow('Warnings:'));
        for (const warning of result.warnings) {
            console.log(chalk.yellow(`  - ${warning}`));
        }
        console.log('');
    }

    console.log(chalk.green(`Successfully installed plugin '${result.pluginName}'`));
    console.log(chalk.dim(`  Path: ${result.installPath}`));
    console.log('');
}

export async function handlePluginUninstallCommand(
    options: PluginUninstallCommandOptionsInput
): Promise<void> {
    const validated = PluginUninstallCommandSchema.parse(options);

    console.log(chalk.cyan(`Uninstalling plugin '${validated.name}'...`));

    const result = await uninstallPlugin(validated.name);

    console.log(chalk.green(`Successfully uninstalled plugin '${validated.name}'`));
    if (result.removedPath) {
        console.log(chalk.dim(`  Removed: ${result.removedPath}`));
    }
    console.log('');
}

export async function handlePluginValidateCommand(
    options: PluginValidateCommandOptionsInput
): Promise<void> {
    const validated = PluginValidateCommandSchema.parse(options);

    console.log(chalk.cyan(`Validating plugin at ${validated.path}...`));
    console.log('');

    const result = validatePluginDirectory(validated.path);

    if (result.valid) {
        console.log(chalk.green('Plugin is valid!'));
        console.log('');

        if (result.manifest) {
            console.log(chalk.bold('Manifest:'));
            console.log(`  Name: ${chalk.green(result.manifest.name)}`);
            if (result.manifest.description) {
                console.log(`  Description: ${result.manifest.description}`);
            }
            if (result.manifest.version) {
                console.log(`  Version: ${result.manifest.version}`);
            }
            console.log('');
        }
    } else {
        console.log(chalk.red('Plugin validation failed!'));
        console.log('');
    }


    if (result.errors.length > 0) {
        console.log(chalk.red('Errors:'));
        for (const error of result.errors) {
            console.log(chalk.red(`  - ${error}`));
        }
        console.log('');
    }


    if (result.warnings.length > 0) {
        console.log(chalk.yellow('Warnings:'));
        for (const warning of result.warnings) {
            console.log(chalk.yellow(`  - ${warning}`));
        }
        console.log('');
    }


    if (!result.valid) {
        const errorDetails = result.errors.length > 0 ? `: ${result.errors.join(', ')}` : '';
        throw new Error(`Plugin validation failed${errorDetails}`);
    }
}



export async function handleMarketplaceAddCommand(
    options: MarketplaceAddCommandOptionsInput
): Promise<void> {
    const validated = MarketplaceAddCommandSchema.parse(options);

    console.log(chalk.cyan(`Adding marketplace from ${validated.source}...`));
    console.log('');

    const result = await addMarketplace(validated.source, {
        name: validated.name,
    });


    if (result.warnings.length > 0) {
        console.log(chalk.yellow('Warnings:'));
        for (const warning of result.warnings) {
            console.log(chalk.yellow(`  - ${warning}`));
        }
        console.log('');
    }

    console.log(chalk.green(`Successfully added marketplace '${result.name}'`));
    console.log(chalk.dim(`  Plugins found: ${result.pluginCount}`));
    console.log('');
}

export async function handleMarketplaceRemoveCommand(
    options: MarketplaceRemoveCommandOptionsInput
): Promise<void> {
    const validated = MarketplaceRemoveCommandSchema.parse(options);

    console.log(chalk.cyan(`Removing marketplace '${validated.name}'...`));

    await removeMarketplace(validated.name);

    console.log(chalk.green(`Successfully removed marketplace '${validated.name}'`));
    console.log('');
}

export async function handleMarketplaceUpdateCommand(
    options: MarketplaceUpdateCommandOptionsInput
): Promise<void> {
    const validated = MarketplaceUpdateCommandSchema.parse(options);

    if (validated.name) {
        console.log(chalk.cyan(`Updating marketplace '${validated.name}'...`));
    } else {
        console.log(chalk.cyan('Updating all marketplaces...'));
    }
    console.log('');

    const results = await updateMarketplace(validated.name);

    for (const result of results) {
        if (result.hasChanges) {
            console.log(chalk.green(`вњ“ ${result.name}: Updated`));
            if (result.previousSha && result.newSha) {
                console.log(
                    chalk.dim(
                        `    ${result.previousSha.substring(0, 8)} в†’ ${result.newSha.substring(0, 8)}`
                    )
                );
            }
        } else {
            console.log(chalk.dim(`в—‹ ${result.name}: Already up to date`));
        }


        if (result.warnings.length > 0) {
            for (const warning of result.warnings) {
                console.log(chalk.yellow(`  - ${warning}`));
            }
        }
    }

    console.log('');
}

export async function handleMarketplaceListCommand(
    options: MarketplaceListCommandOptionsInput
): Promise<void> {
    const validated = MarketplaceListCommandSchema.parse(options);
    const marketplaces = listMarketplaces();

    if (marketplaces.length === 0) {
        console.log(chalk.yellow('No marketplaces registered.'));
        console.log('');
        console.log('Add a marketplace with:');
        console.log(chalk.cyan('  fius plugin marketplace add <owner/repo>'));
        console.log('');
        console.log('Examples:');
        console.log(chalk.dim('  fius plugin marketplace add anthropics/claude-plugins-official'));
        console.log(
            chalk.dim('  fius plugin marketplace add https://github.com/user/plugins.git')
        );
        console.log(chalk.dim('  fius plugin marketplace add ~/my-local-plugins'));
        return;
    }

    console.log(chalk.bold(`Registered Marketplaces (${marketplaces.length}):`));
    console.log('');

    for (const marketplace of marketplaces) {
        const sourceType = chalk.dim(`[${marketplace.source.type}]`);
        console.log(`  ${chalk.green(marketplace.name)} ${sourceType}`);

        if (validated.verbose) {
            console.log(chalk.dim(`    Source: ${marketplace.source.value}`));
            console.log(chalk.dim(`    Path: ${marketplace.installLocation}`));
            if (marketplace.lastUpdated) {
                const date = new Date(marketplace.lastUpdated).toLocaleDateString();
                console.log(chalk.dim(`    Updated: ${date}`));
            }
        }
    }

    console.log('');
}

export async function handleMarketplacePluginsCommand(options: {
    marketplace?: string | undefined;
    verbose?: boolean | undefined;
}): Promise<void> {
    const plugins = listAllMarketplacePlugins();


    const filtered = options.marketplace
        ? plugins.filter(
              (plugin) => plugin.marketplace.toLowerCase() === options.marketplace?.toLowerCase()
          )
        : plugins;

    if (filtered.length === 0) {
        if (options.marketplace) {
            console.log(chalk.yellow(`No plugins found in marketplace '${options.marketplace}'.`));
        } else {
            console.log(chalk.yellow('No plugins found in any marketplace.'));
            console.log('');
            console.log('Make sure you have marketplaces registered:');
            console.log(chalk.cyan('  fius plugin marketplace list'));
        }
        return;
    }

    console.log(chalk.bold(`Available Plugins (${filtered.length}):`));
    console.log('');


    const byMarketplace = new Map<string, typeof filtered>();
    for (const plugin of filtered) {
        const list = byMarketplace.get(plugin.marketplace) || [];
        list.push(plugin);
        byMarketplace.set(plugin.marketplace, list);
    }

    for (const [marketplace, marketplacePlugins] of byMarketplace) {
        console.log(chalk.cyan(`  ${marketplace}:`));
        for (const plugin of marketplacePlugins) {
            const version = plugin.version ? chalk.dim(`@${plugin.version}`) : '';
            const category = plugin.category ? chalk.dim(` [${plugin.category}]`) : '';
            console.log(`    ${chalk.green(plugin.name)}${version}${category}`);

            if (options.verbose && plugin.description) {
                console.log(chalk.dim(`      ${plugin.description}`));
            }
        }
        console.log('');
    }

    console.log('Install a plugin with:');
    console.log(chalk.cyan('  fius plugin marketplace install <name>@<marketplace>'));
    console.log('');
}

export async function handleMarketplaceInstallCommand(
    options: MarketplaceInstallCommandOptionsInput
): Promise<void> {
    const validated = MarketplaceInstallCommandSchema.parse(options);

    console.log(chalk.cyan(`Installing plugin '${validated.plugin}' from marketplace...`));
    console.log('');

    const result = await installPluginFromMarketplace(validated.plugin, {
        scope: validated.scope as PluginInstallScope,
        force: validated.force,
    });


    if (result.warnings.length > 0) {
        console.log(chalk.yellow('Warnings:'));
        for (const warning of result.warnings) {
            console.log(chalk.yellow(`  - ${warning}`));
        }
        console.log('');
    }

    console.log(chalk.green(`Successfully installed plugin '${result.pluginName}'`));
    console.log(chalk.dim(`  Marketplace: ${result.marketplace}`));
    console.log(chalk.dim(`  Path: ${result.installPath}`));
    if (result.gitCommitSha) {
        console.log(chalk.dim(`  Version: ${result.gitCommitSha.substring(0, 8)}`));
    }
    console.log('');
}



function getSourceLabel(_source: 'fius'): string {
    return chalk.blue('(fius)');
}