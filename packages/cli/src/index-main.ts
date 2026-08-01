import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { Command } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';

if (process.platform === 'win32') {
    execSync('cls', { stdio: 'inherit' });
} else {
    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J');
}
import { withAnalytics, safeExit, ExitSignal } from './analytics/wrapper.js';
import type { UpdateInfo } from './cli/utils/version-check.js';

function readVersionFromPackageJson(packageJsonPath: string): string | undefined {
    if (!existsSync(packageJsonPath)) {
        return undefined;
    }

    try {
        const content = readFileSync(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content) as { version?: unknown };
        if (typeof pkg.version === 'string' && pkg.version.length > 0) {
            return pkg.version;
        }
    } catch {
    }

    return undefined;
}

function resolveCliVersion(): string {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const localPackageJsonPath = path.resolve(scriptDir, '..', 'package.json');
    const localVersion = readVersionFromPackageJson(localPackageJsonPath);
    if (localVersion) {
        return localVersion;
    }

    const packageRoot = getFiusPackageRoot();
    if (packageRoot) {
        const packageJsonPath = path.join(packageRoot, 'package.json');
        const packageVersion = readVersionFromPackageJson(packageJsonPath);
        if (packageVersion) {
            return packageVersion;
        }
    }

    return process.env.FIUS_CLI_VERSION || '0.0.0';
}

const cliVersion = resolveCliVersion();

process.env.FIUS_CLI_VERSION = cliVersion;

import { logger, startLlmRegistryAutoUpdate, FiusAgent, isPath } from '@fiusdev/core';
import { getSupportedModels, getProviderFromModel, type LLMProvider } from '@fiusdev/llm';
import {
    applyImageDefaults,
    cleanNullValues,
    AgentConfigSchema,
    loadImage,
    resolveServicesFromConfig,
    toFiusAgentOptions,
    type FiusImage,
    type ValidatedAgentConfig,
} from '@fiusdev/agent-config';
import {
    getFiusPackageRoot,
    resolveAgentPath,
    loadAgentConfig,
    findFiusProjectRoot,
    globalPreferencesExist,
    loadGlobalPreferences,
    resolveBundledScript,
    enrichAgentConfig,
    createModelAuthResolver,
    resolveApiKeyForProvider,
    getPrimaryApiKeyEnvVar,
} from '@fiusdev/agent-management';
import { validateCliOptions, handleCliOptionsError } from './cli/utils/options.js';
import { validateAgentConfig } from './cli/utils/config-validation.js';
import {
    applyCLIOverrides,
    applyStartupLLMFallback,
    applyUserPreferences,
} from './config/cli-overrides.js';
import { registerRunCommand } from './cli/commands/run/register.js';
import { registerSessionCommand } from './cli/commands/session/register.js';
import { registerSearchCommand } from './cli/commands/search/register.js';
import { registerAuthCommand } from './cli/commands/auth/register.js';
import { registerBillingCommand } from './cli/commands/billing/register.js';
import { registerMcpCommand } from './cli/commands/mcp/register.js';
import { registerImageCommand } from './cli/commands/image/register.js';
import { registerPluginCommand } from './cli/commands/plugin/register.js';
import { registerDeployCommand } from './cli/commands/deploy/register.js';
import { registerSpanCommand } from './cli/commands/span/register.js';
import { registerTraceCommand } from './cli/commands/trace/register.js';
import { registerInitCommand } from './cli/commands/init.js';
import type { BootstrapAgentMode } from './cli/commands/register-context.js';
import type { MainModeOptions } from './cli/modes/context.js';
import type { CLIConfigOverrides } from './config/cli-overrides.js';
import type { CreateAppOptions } from './cli/commands/create-app.js';
import type { CLISetupOptionsInput } from './cli/commands/setup.js';
import type { UpgradeCommandOptions } from './cli/commands/upgrade.js';
import type { UninstallCliCommandOptions } from './cli/commands/uninstall.js';
import { ensureImageImporterConfigured } from './cli/utils/image-importer.js';

const program = new Command();

function showBanner(): void {
    const args = process.argv.slice(2);
    if (args.length > 0) return;

    process.stdout.write('\x1B[2J\x1B[0f');

    if (process.platform === 'win32') {
        const psScript = `$art = @('███████╗██╗██╗   ██╗███████╗     ██████╗██╗     ██╗','██╔════╝██║██║   ██║██╔════╝    ██╔════╝██║     ██║','█████╗  ██║██║   ██║███████╗    ██║     ██║     ██║','██╔══╝  ██║██║   ██║╚════██║    ██║     ██║     ██║','██║     ██║╚██████╔╝███████║    ╚██████╗███████╗██║','╚═╝     ╚═╝ ╚═════╝ ╚══════╝     ╚═════╝╚══════╝╚═╝');foreach($line in $art){$chars=$line.ToCharArray();for($i=0;$i -lt $chars.Length;$i++){$r=[int](0+(255-0)*($i/$chars.Length));$g=[int](190+(0-190)*($i/$chars.Length));$b=[int](255+(255-255)*($i/$chars.Length));[Console]::Write([char]27+'[38;2;'+$r+';'+$g+';'+$b+'m'+$chars[$i])};[Console]::WriteLine([char]27+'[0m')}`;
        execSync(`chcp 65001 >nul && powershell -NoProfile -Command "${psScript}"`, { stdio: 'inherit' });
    } else {
        const art = [
            '███████╗██╗██╗   ██╗███████╗     ██████╗██╗     ██╗',
            '██╔════╝██║██║   ██║██╔════╝    ██╔════╝██║     ██║',
            '█████╗  ██║██║   ██║███████╗    ██║     ██║     ██║',
            '██╔══╝  ██║██║   ██║╚════██║    ██║     ██║     ██║',
            '██║     ██║╚██████╔╝███████║    ╚██████╗███████╗██║',
            '╚═╝     ╚═╝ ╚═════╝ ╚══════╝     ╚═════╝╚══════╝╚═╝',
        ];
        let output = '';
        for (const line of art) {
            for (let i = 0; i < line.length; i++) {
                const t = i / line.length;
                const r = Math.round(0 + (255 - 0) * t);
                const g = Math.round(190 + (0 - 190) * t);
                const b = 255;
                output += `\x1B[38;2;${r};${g};${b}m${line[i]}`;
            }
            output += '\x1B[0m\n';
        }
        process.stdout.write(output);
    }

}

let fiusApiKeyBootstrapped = false;
let versionCheckPromise: Promise<UpdateInfo | null> | null = null;
let llmRegistryAutoUpdateStarted = false;

async function ensureFiusApiKeyBootstrap(): Promise<void> {
    if (fiusApiKeyBootstrapped) {
        return;
    }
    const { getFiusApiKey } = await import('./cli/auth/index.js');
    const fiusApiKey = await getFiusApiKey();
    if (fiusApiKey) {
        process.env.FIUS_API_KEY = fiusApiKey;
    }
    fiusApiKeyBootstrapped = true;
}

async function getVersionCheckResult(): Promise<UpdateInfo | null> {
    if (!versionCheckPromise) {
        const { checkForUpdates } = await import('./cli/utils/version-check.js');
        versionCheckPromise = checkForUpdates(cliVersion);
    }
    return versionCheckPromise;
}

function ensureLlmRegistryAutoUpdateStarted(): void {
    if (llmRegistryAutoUpdateStarted) {
        return;
    }
    startLlmRegistryAutoUpdate();
    llmRegistryAutoUpdateStarted = true;
}

program
    .name('fius')
    .description('AI-powered CLI and WebUI for interacting with MCP servers.')
    .version(cliVersion, '-v, --version', 'output the current version')
    .option('-a, --agent <id|path>', 'Agent ID or path to agent config file')
    .option('--cloud-agent <id>', 'Connect the interactive CLI to a deployed cloud agent by ID')
    .option('-p, --prompt <text>', 'Start the interactive CLI and immediately run the prompt')
    .option('-s, --strict', 'Require all server connections to succeed')
    .option('--no-verbose', 'Disable verbose output')
    .option('--no-interactive', 'Disable interactive prompts and API key setup')
    .option('--skip-setup', 'Skip global setup validation (useful for MCP mode, automation)')
    .option('-m, --model <model>', 'Specify the LLM model to use')
    .option('--auto-approve', 'Always approve tool executions without approval prompts')
    .option(
        '--bypass-permissions',
        'Start the interactive CLI in bypass permissions mode (auto-approve approval prompts)'
    )
    .option('--no-elicitation', 'Disable elicitation (agent cannot prompt user for input)')
    .option('-c, --continue', 'Continue most recent session (CLI mode)')
    .option('-r, --resume <sessionId>', 'Resume a session by ID (CLI mode)')
    .option(
        '--mode <mode>',
        'The application in which fius should talk to you - web | cli | server | mcp',
        'cli'
    )
    .option('--port <port>', 'port for the server (default: 3000 for web, 3001 for server mode)')
    .option('--no-auto-install', 'Disable automatic installation of missing agents from registry')
    .option(
        '--image <package>',
        'Image package to load (e.g., @fiusdev/image-local). Overrides config image field.'
    )
    .option(
        '--dev',
        '[maintainers] Use local ./agents instead of ~/.fius (for fius repo development)'
    )
    .enablePositionalOptions();

program
    .command('create-app [name]')
    .description('Create a Fius application (CLI, web, bot, etc.)')
    .option('--from-image <package>', 'Use existing image (e.g., @fiusdev/image-local)')
    .option('--type <type>', 'App type: script, webapp (default: script)')
    .action(
        withAnalytics('create-app', async (name?: string, options?: CreateAppOptions) => {
            try {
                p.intro(chalk.inverse('Create Fius App'));

                const { createFiusProject } = await import('./cli/commands/create-app.js');
                await createFiusProject(name, options);

                p.outro(chalk.greenBright('Fius app created successfully!'));
                safeExit('create-app', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ fius create-app command failed: ${err}`);
                safeExit('create-app', 1, 'error');
            }
        })
    );

registerImageCommand({ program });
registerDeployCommand({ program });
registerSpanCommand({ program });
registerTraceCommand({ program });
registerInitCommand({ program });

program
    .command('init-app')
    .description('Initialize an existing Typescript app with Fius')
    .action(
        withAnalytics('init-app', async () => {
            const { checkForFileInCurrentDirectory, FileNotFoundError } = await import(
                './cli/utils/package-mgmt.js'
            );
            try {
                await checkForFileInCurrentDirectory('package.json');
                await checkForFileInCurrentDirectory('tsconfig.json');

                p.intro(chalk.inverse('Fius Init App'));
                const { getUserInputToInitFiusApp, initFius, postInitFius } = await import(
                    './cli/commands/init-app.js'
                );
                const userInput = await getUserInputToInitFiusApp();
                try {
                    const { capture } = await import('./analytics/index.js');
                    capture('fius_init', {
                        provider: userInput.llmProvider,
                        providedKey: Boolean(userInput.llmApiKey),
                    });
                } catch {
                }
                await initFius(
                    userInput.directory,
                    userInput.createExampleFile,
                    userInput.llmProvider,
                    userInput.llmApiKey
                );
                p.outro(chalk.greenBright('Fius app initialized successfully!'));

                await postInitFius(userInput.directory);
                safeExit('init-app', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                if (err instanceof FileNotFoundError) {
                    console.error(`❌ ${err.message} Run "fius create-app" to create a new app`);
                    safeExit('init-app', 1, 'file-not-found');
                }
                console.error(`❌ Initialization failed: ${err}`);
                safeExit('init-app', 1, 'error');
            }
        })
    );

program
    .command('setup')
    .description('Configure global Fius preferences')
    .option('--provider <provider>', 'LLM provider (openai, anthropic, google, groq)')
    .option('--model <model>', 'Model name (uses provider default if not specified)')
    .option('--default-agent <agent>', 'Default agent name (default: fius)')
    .option('--no-interactive', 'Skip interactive prompts and API key setup')
    .option('--force', 'Overwrite existing setup without confirmation')
    .action(
        withAnalytics('setup', async (options: CLISetupOptionsInput) => {
            try {
                const { handleSetupCommand } = await import('./cli/commands/setup.js');
                await handleSetupCommand(options);
                safeExit('setup', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(
                    `❌ fius setup command failed: ${err}. Check logs in ~/.fius/logs/fius.log for more information`
                );
                safeExit('setup', 1, 'error');
            }
        })
    );

program
    .command('upgrade [version]')
    .description('Upgrade Fius CLI (auto-migrates npm installs to native)')
    .option('--dry-run', 'Print commands without executing them')
    .option('--force', 'Force reinstall during upgrade')
    .action(
        withAnalytics(
            'upgrade',
            async (version: string | undefined, options: Partial<UpgradeCommandOptions>) => {
                try {
                    const { handleUpgradeCommand } = await import('./cli/commands/upgrade.js');
                    await handleUpgradeCommand(version, options);
                    safeExit('upgrade', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ fius upgrade command failed: ${err}`);
                    safeExit('upgrade', 1, 'error');
                }
            }
        )
    );

program
    .command('uninstall')
    .description('Uninstall the Fius CLI binary (does not uninstall agents)')
    .option('--purge', 'Also remove ~/.fius completely')
    .option('--dry-run', 'Print actions without deleting files')
    .action(
        withAnalytics('uninstall', async (options: Partial<UninstallCliCommandOptions>) => {
            try {
                const { handleUninstallCliCommand } = await import('./cli/commands/uninstall.js');
                await handleUninstallCliCommand(options);
                safeExit('uninstall', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ fius uninstall command failed: ${err}`);
                safeExit('uninstall', 1, 'error');
            }
        })
    );

program
    .command('which <agent>')
    .description('Show the path to an agent')
    .action(
        withAnalytics('which', async (agent: string) => {
            try {
                const { handleWhichCommand } = await import('./cli/commands/which.js');
                await handleWhichCommand(agent);
                safeExit('which', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ fius which command failed: ${err}`);
                safeExit('which', 1, 'error');
            }
        })
    );

registerPluginCommand({ program });

async function bootstrapAgentFromGlobalOpts(options: {
    mode: BootstrapAgentMode;
    modelOverride?: string;
}) {
    const { mode, modelOverride } = options;
    const isHeadlessRun = mode === 'headless-run';
    await ensureFiusApiKeyBootstrap();
    await ensureImageImporterConfigured();
    const globalOpts = program.opts();
    const effectiveModel = modelOverride ?? globalOpts.model;
    let inferredProvider: LLMProvider | undefined;
    let inferredApiKey: string | undefined;

    if (effectiveModel) {
        if (effectiveModel.includes('/')) {
            throw new Error(
                `Model '${effectiveModel}' looks like an OpenRouter-format ID (provider/model). Please set provider/model explicitly in agent config for this command.`
            );
        }

        inferredProvider = getProviderFromModel(effectiveModel) ?? 'openai-compatible';
        const apiKey = resolveApiKeyForProvider(inferredProvider);
        if (!apiKey) {
            const envVar = getPrimaryApiKeyEnvVar(inferredProvider);
            throw new Error(
                `Missing API key for provider '${inferredProvider}' - please set $${envVar}`
            );
        }

        inferredApiKey = apiKey;
    }

    const resolvedPath = await resolveAgentPath(globalOpts.agent, globalOpts.autoInstall !== false);
    const workspaceRoot = findFiusProjectRoot(process.cwd()) ?? process.cwd();
    const rawConfig = await loadAgentConfig(resolvedPath);
    const mergedConfig = applyCLIOverrides(rawConfig, {
        ...globalOpts,
        ...(modelOverride ? { model: modelOverride } : {}),
    });
    if (effectiveModel) {
        mergedConfig.llm.model = effectiveModel;
    }
    if (inferredProvider && inferredApiKey) {
        mergedConfig.llm.provider = inferredProvider;
        mergedConfig.llm.apiKey = inferredApiKey;
    }

    const imageName =
        globalOpts.image || // --image flag
        mergedConfig.image || // image field in agent config
        process.env.FIUS_IMAGE || // FIUS_IMAGE env var
        '@fiusdev/image-local'; // Default for convenience

    let image: FiusImage;
    try {
        image = await loadImage(imageName);
    } catch (err) {
        console.error(`❌ Failed to load image '${imageName}'`);
        if (err instanceof Error) {
            console.error(err.message);
        }
        console.error(`💡 Install it with: fius image install ${imageName}`);
        safeExit('bootstrap', 1, 'image-load-failed');
    }

    const configWithImageDefaults = applyImageDefaults(mergedConfig, image.defaults);

    const enrichedConfig = enrichAgentConfig(configWithImageDefaults, resolvedPath, {
        logLevel: isHeadlessRun ? 'error' : 'info',
        workspaceRoot,
    });

    if (isHeadlessRun) {
        enrichedConfig.logger = {
            level: 'error',
            transports: [{ type: 'silent' }],
        };
    }

    enrichedConfig.permissions = {
        ...(enrichedConfig.permissions ?? {}),
        mode: 'auto-approve',
    };
    enrichedConfig.elicitation = {
        enabled: false,
        ...(enrichedConfig.elicitation?.timeout !== undefined && {
            timeout: enrichedConfig.elicitation.timeout,
        }),
    };

    const validatedConfig = AgentConfigSchema.parse(enrichedConfig);
    const services = await resolveServicesFromConfig(validatedConfig, image, { workspaceRoot });
    const agent = new FiusAgent(
        toFiusAgentOptions({
            config: validatedConfig,
            services,
            image,
            hostContext: { workspaceRoot },
            overrides: {
                authResolver: createModelAuthResolver(),
            },
        })
    );
    await agent.start();
    await (await import('./utils/workspace.js')).applyWorkspaceToAgent(agent, workspaceRoot);

    const shutdown = async () => {
        try {
            await agent.stop();
        } catch (_err) {
        }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return agent;
}

const runtimeCommandContext = {
    program,
    cliVersion,
    bootstrapAgentFromGlobalOpts,
};
registerRunCommand(runtimeCommandContext);
registerSessionCommand(runtimeCommandContext);
registerSearchCommand(runtimeCommandContext);
registerAuthCommand(runtimeCommandContext);
registerBillingCommand(runtimeCommandContext);
registerMcpCommand({ program });

program
    .description(
        'Fius CLI - AI-powered assistant with session management.\n\n' +
            'Basic Usage:\n' +
            '  fius or fius --mode cli  Start interactive CLI (default)\n' +
            '  fius --mode web         Start web UI\n' +
            '  fius --prompt "query"   Start interactive CLI and run the prompt\n' +
            '  fius run "query"        Run one-off headless task\n\n' +
            'Session Management Commands:\n' +
            '  fius session list              List all sessions\n' +
            '  fius session history [id]      Show session history\n' +
            '  fius session delete <id>       Delete a session\n' +
            '  fius search <query>            Search across sessions\n' +
            '    Options: --session <id>, --role <user|assistant>, --limit <n>\n\n' +
            'Agent Selection:\n' +
            '  fius --agent fius             Use installed agent by name\n' +
            '  fius --agent ./my-agent.yml     Use agent from file path\n' +
            '  fius -a agents/custom.yml       Short form with relative path\n\n' +
            'Tool Confirmation:\n' +
            '  fius --auto-approve     Auto-approve all tool executions\n\n' +
            'Ink CLI Modes:\n' +
            '  fius --bypass-permissions  Start in bypass permissions mode (skip approval prompts)\n\n' +
            'Advanced Modes:\n' +
            '  fius --mode server      Run as API server\n' +
            '  fius --mode mcp         Run as MCP server\n\n' +
            'Docs: https://docs.fius.ai'
    )
    .action(
        withAnalytics(
            'main',
            async () => {
                await ensureFiusApiKeyBootstrap();
                await ensureImageImporterConfigured();
                ensureLlmRegistryAutoUpdateStarted();

                if (!existsSync('.env')) {
                    logger.debug(
                        'WARNING: .env file not found; copy .env.example and set your API keys.'
                    );
                }

                const opts = program.opts();
                const workspaceRoot = findFiusProjectRoot(process.cwd()) ?? process.cwd();

                if (opts.dev) {
                    process.env.FIUS_DEV_MODE = 'true';
                }

                const modeSource = program.getOptionValueSource('mode');
                const explicitModeProvided = modeSource === 'cli';
                if (!explicitModeProvided) {
                    try {
                        if (globalPreferencesExist()) {
                            const preferences = await loadGlobalPreferences();
                            if (preferences.defaults?.defaultMode) {
                                opts.mode = preferences.defaults.defaultMode;
                                logger.debug(`Using default mode from preferences: ${opts.mode}`);
                            }
                        }
                    } catch (error) {
                        logger.debug(
                            `Failed to load default mode from preferences: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }

                const initialPrompt = opts.prompt !== undefined ? String(opts.prompt) : undefined;

                if (initialPrompt !== undefined && initialPrompt.trim() === '') {
                    console.error(
                        '❌ Prompt cannot be empty. Provide a non-empty prompt with -p/--prompt.'
                    );
                    safeExit('main', 1, 'empty-prompt');
                }

                const modeForcedByChatFlags = Boolean(
                    initialPrompt || opts.continue || opts.resume || opts.cloudAgent
                );
                if (modeForcedByChatFlags && opts.mode !== 'cli') {
                    console.error(
                        `ℹ️  Forcing CLI mode due to --prompt/--continue/--resume/--cloud-agent.`
                    );
                    console.error(`   Original mode: ${opts.mode} → Overridden to: cli`);
                    opts.mode = 'cli';
                }

                if (opts.mode === 'cli' && !process.stdin.isTTY) {
                    console.error('❌ Interactive CLI requires a TTY.');
                    console.error(
                        '💡 For non-interactive runs, use `fius run "<prompt>"`, or use --mode server for automation.'
                    );
                    safeExit('main', 1, 'no-tty');
                }

                if (opts.cloudAgent) {
                    if (opts.agent) {
                        console.error(
                            '❌ `--agent` and `--cloud-agent` are mutually exclusive. Use one chat target at a time.'
                        );
                        safeExit('main', 1, 'cloud-agent-conflict');
                    }

                    try {
                        const { startCloudChatCli } = await import('./cli/cloud-chat.js');
                        await startCloudChatCli({
                            cloudAgentId: String(opts.cloudAgent),
                            ...(initialPrompt ? { initialPrompt } : {}),
                            ...(opts.resume ? { resume: String(opts.resume) } : {}),
                            ...(opts.continue ? { continueMostRecent: true } : {}),
                        });
                        safeExit('main', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ Cloud chat failed: ${err}`);
                        safeExit('main', 1, 'cloud-chat-error');
                    }
                }

                if (opts.model) {
                    if (opts.model.includes('/')) {
                        console.error(
                            `❌ Model '${opts.model}' looks like an OpenRouter-format ID (provider/model).`
                        );
                        console.error(
                            `   This is ambiguous for --model inference. Please also pass --provider (e.g. --provider openrouter).`
                        );
                        safeExit('main', 1, 'ambiguous-model');
                    }

                    let provider: LLMProvider;
                    try {
                        provider = getProviderFromModel(opts.model) ?? 'openai-compatible';
                    } catch (err) {
                        console.error(`❌ ${(err as Error).message}`);
                        console.error(`Supported models: ${getSupportedModels().join(', ')}`);
                        safeExit('main', 1, 'invalid-model');
                    }

                    const apiKey = resolveApiKeyForProvider(provider);
                    if (!apiKey) {
                        const envVar = getPrimaryApiKeyEnvVar(provider);
                        console.error(
                            `❌ Missing API key for provider '${provider}' - please set $${envVar}`
                        );
                        safeExit('main', 1, 'missing-api-key');
                    }
                    opts.provider = provider;
                    opts.apiKey = apiKey;
                }

                try {
                    validateCliOptions(opts);
                } catch (err) {
                    handleCliOptionsError(err);
                }

                let validatedConfig: ValidatedAgentConfig;
                let resolvedPath: string;
                let image: FiusImage;
                let imageName: string;

                let isInteractiveMode = opts.mode === 'web' || opts.mode === 'cli';
                const isInteractiveCli = opts.mode === 'cli';
                let setupRequired = false;

                const canRunInteractiveSetup = isInteractiveMode && opts.interactive !== false;

                if (setupRequired && !canRunInteractiveSetup) {
                    console.error('❌ Setup required before starting in this mode.');
                    console.error(
                        '💡 Run `fius setup` first, or use --skip-setup to bypass global setup.'
                    );
                    safeExit('main', 1, 'setup-required-non-interactive');
                }

                const shouldRunSetupBeforeStartup =
                    setupRequired && canRunInteractiveSetup && !opts.provider && !opts.model;

                if (shouldRunSetupBeforeStartup) {
                    const { handleSetupCommand } = await import('./cli/commands/setup.js');
                    await handleSetupCommand({
                        interactive: true,
                        defaultMode: opts.mode === 'cli' ? 'cli' : undefined,
                    });

                    if (!explicitModeProvided && !modeForcedByChatFlags) {
                        const preferences = await loadGlobalPreferences();
                        if (preferences.defaults.defaultMode) {
                            opts.mode = preferences.defaults.defaultMode;
                        }
                        isInteractiveMode = opts.mode === 'web' || opts.mode === 'cli';
                    }
                }

                try {
                    if (opts.agent && isPath(opts.agent)) {
                        resolvedPath = await resolveAgentPath(
                            opts.agent,
                            opts.autoInstall !== false
                        );
                    }
                    else {
                        if (opts.agent) {
                            try {
                                const bundledRegistryPath = resolveBundledScript(
                                    'agents/agent-registry.json'
                                );
                                const registryContent = readFileSync(bundledRegistryPath, 'utf-8');
                                const bundledRegistry = JSON.parse(registryContent);

                                if (!(opts.agent in bundledRegistry.agents)) {
                                    console.error(`❌ Agent '${opts.agent}' not found in registry`);

                                    const available = Object.keys(bundledRegistry.agents);
                                    if (available.length > 0) {
                                        console.log(`📋 Available agents: ${available.join(', ')}`);
                                    } else {
                                        console.log('📋 No agents available in registry');
                                    }
                                    safeExit('main', 1, 'agent-not-in-registry');
                                    return;
                                }
                            } catch (error) {
                                logger.warn(
                                    `Could not validate agent against registry: ${error instanceof Error ? error.message : String(error)}`
                                );
                            }
                        }

                        resolvedPath = await resolveAgentPath(
                            opts.agent,
                            opts.autoInstall !== false
                        );

                        if (opts.interactive !== false) {
                            const {
                                getBundledSyncTargetForAgentPath,
                                shouldPromptForSync,
                                handleSyncAgentsCommand,
                            } = await import('./cli/commands/agents/sync.js');
                            const syncTarget = getBundledSyncTargetForAgentPath(resolvedPath);

                            if (syncTarget && (await shouldPromptForSync(resolvedPath))) {
                                await handleSyncAgentsCommand({
                                    force: true,
                                    quiet: true,
                                    agentIds: [syncTarget.agentId],
                                });
                            }
                        }
                    }

                    const rawConfig = await loadAgentConfig(resolvedPath);
                    let mergedConfig = applyCLIOverrides(rawConfig, opts as CLIConfigOverrides);

                    const agentId = opts.agent ?? 'fius';
                    let preferences: Awaited<ReturnType<typeof loadGlobalPreferences>> | null =
                        null;
                    let hasCompletedSetup = false;

                    if (globalPreferencesExist()) {
                        try {
                            preferences = await loadGlobalPreferences();
                            hasCompletedSetup = preferences.setup.completed;
                    } catch {
                            logger.debug('Could not load preferences, continuing without them');
                        }
                    }

                    {
                        const { checkFiusAuthState } = await import(
                            './cli/utils/fius-auth-check.js'
                        );
                        const authCheck = await checkFiusAuthState(
                            opts.interactive !== false,
                            agentId
                        );

                        if (!authCheck.shouldContinue) {
                            if (authCheck.action === 'login') {
                                const { handleLoginCommand } = await import(
                                    './cli/commands/auth/login.js'
                                );
                                await handleLoginCommand();
                            } else {
                                safeExit('main', 0, 'fius-auth-check-cancelled');
                            }
                        }
                    }

                    if (preferences?.setup?.apiKeyPending && opts.interactive !== false) {
                        const configuredApiKey = resolveApiKeyForProvider(preferences.llm.provider);
                        if (!configuredApiKey) {
                            const { promptForPendingApiKey } = await import(
                                './cli/utils/api-key-setup.js'
                            );
                            const { updateGlobalPreferences } = await import(
                                '@fiusdev/agent-management'
                            );

                            const result = await promptForPendingApiKey(
                                preferences.llm.provider,
                                preferences.llm.model
                            );

                            if (result.action === 'cancel') {
                                safeExit('main', 0, 'pending-api-key-cancelled');
                            }

                            if (result.action === 'setup' && result.apiKey) {
                                await updateGlobalPreferences({
                                    setup: { apiKeyPending: false },
                                });
                                logger.debug('API key configured, pending flag cleared');
                            }
                        } else {
                            const { updateGlobalPreferences } = await import(
                                '@fiusdev/agent-management'
                            );
                            await updateGlobalPreferences({
                                setup: { apiKeyPending: false },
                            });
                            logger.debug('API key found in environment, cleared pending flag');
                        }
                    }

                    mergedConfig = applyStartupLLMFallback(mergedConfig, {
                        hasCompletedSetup,
                        hasExplicitProviderOverride: Boolean(opts.provider),
                        hasExplicitModelOverride: Boolean(opts.model),
                        hasExplicitApiKeyOverride: Boolean(opts.apiKey),
                    });

                    if (
                        hasCompletedSetup &&
                        preferences?.llm?.provider &&
                        preferences?.llm?.model
                    ) {
                        mergedConfig = applyUserPreferences(mergedConfig, preferences);
                        logger.debug(`Applied user preferences to ${agentId}`, {
                            provider: preferences.llm.provider,
                            model: preferences.llm.model,
                        });
                    }

                    const cleanedConfig = cleanNullValues(mergedConfig);

                    imageName =
                        opts.image || // --image flag
                        cleanedConfig.image || // image field in agent config
                        process.env.FIUS_IMAGE || // FIUS_IMAGE env var
                        '@fiusdev/image-local'; // Default for convenience

                    try {
                        image = await loadImage(imageName);
                        logger.debug(`Loaded image: ${imageName}`);
                    } catch (err) {
                        console.error(`❌ Failed to load image '${imageName}'`);
                        if (err instanceof Error) {
                            console.error(err.message);
                            logger.debug(`Image load error: ${err.message}`);
                        }
                        console.error(`💡 Install it with: fius image install ${imageName}`);
                        safeExit('main', 1, 'image-load-failed');
                    }

                    const configWithImageDefaults = applyImageDefaults(
                        cleanedConfig,
                        image.defaults
                    );

                    const enrichedConfig = enrichAgentConfig(
                        configWithImageDefaults,
                        resolvedPath,
                        {
                            isInteractiveCli,
                            logLevel: 'info',
                            workspaceRoot,
                        }
                    );

                    const validationResult = await validateAgentConfig(
                        enrichedConfig,
                        opts.interactive !== false,
                        {
                            credentialPolicy: isInteractiveMode ? 'warn' : 'error',
                            agentPath: resolvedPath,
                        }
                    );

                    if (validationResult.success && validationResult.config) {
                        validatedConfig = validationResult.config;
                    } else if (validationResult.skipped) {
                        logger.warn(
                            'Starting with validation warnings - some features may not work'
                        );
                        validatedConfig = enrichedConfig as ValidatedAgentConfig;
                    } else {
                        safeExit('main', 1, 'config-validation-failed');
                    }

                    if (
                        !opts.image &&
                        validatedConfig.image &&
                        validatedConfig.image !== imageName
                    ) {
                        console.error(
                            `❌ Config specifies image '${validatedConfig.image}' but '${imageName}' was loaded instead`
                        );
                        console.error(
                            `💡 Either remove 'image' from config or ensure it matches the loaded image`
                        );
                        safeExit('main', 1, 'image-mismatch');
                    }
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ Failed to load configuration: ${err}`);
                    safeExit('main', 1, 'config-load-failed');
                }

                const needsHandler =
                    validatedConfig.permissions.mode === 'manual' ||
                    validatedConfig.elicitation.enabled;

                if (needsHandler) {
                    const supportedModes = ['web', 'server', 'cli'];
                    if (!supportedModes.includes(opts.mode)) {
                        console.error(
                            `❌ Manual approval and elicitation are not supported in "${opts.mode}" mode.`
                        );
                        console.error(
                            `💡 These features require interactive UI and are only supported in: ${supportedModes.join(
                                ', '
                            )}`
                        );
                        console.error(
                            '💡 Run `fius --auto-approve` or configure your agent to skip approvals when running non-interactively.'
                        );
                        console.error('   permissions.mode: auto-approve');
                        console.error('   elicitation.enabled: false');
                        safeExit('main', 1, 'approval-unsupported-mode');
                    }
                }

                let agent: FiusAgent;
                let derivedAgentId: string;
                try {
                    process.env.FIUS_RUN_MODE = opts.mode;

                    if (opts.strict && validatedConfig.mcpServers) {
                        for (const [_serverName, serverConfig] of Object.entries(
                            validatedConfig.mcpServers
                        )) {
                            serverConfig.connectionMode = 'strict';
                        }
                    }

                    const { createFileSessionLoggerFactory } = await import(
                        './utils/session-logger-factory.js'
                    );
                    const sessionLoggerFactory = createFileSessionLoggerFactory();

                    const mcpAuthProviderFactory =
                        opts.mode === 'cli'
                            ? (
                                  await import('./cli/mcp/oauth-factory.js')
                              ).createMcpAuthProviderFactory({
                                  logger,
                              })
                            : null;

                    const services = await resolveServicesFromConfig(validatedConfig, image, {
                        workspaceRoot,
                    });
                    agent = new FiusAgent(
                        toFiusAgentOptions({
                            config: validatedConfig,
                            services,
                            image,
                            hostContext: { workspaceRoot },
                            overrides: {
                                sessionLoggerFactory,
                                mcpAuthProviderFactory,
                                authResolver: createModelAuthResolver(),
                            },
                        })
                    );

                    if (opts.mode !== 'web' && opts.mode !== 'server' && opts.mode !== 'cli') {
                        await agent.start();
                        await (
                            await import('./utils/workspace.js')
                        ).applyWorkspaceToAgent(agent, workspaceRoot);
                    }

                    derivedAgentId =
                        validatedConfig.agentCard?.name ||
                        path.basename(resolvedPath, path.extname(resolvedPath));
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ Configuration Error: ${(err as Error).message}`);
                    safeExit('main', 1, 'config-error');
                }

                const { dispatchMainMode } = await import('./cli/modes/dispatch.js');
                const mainModeOpts: MainModeOptions = {
                    mode: opts.mode,
                    port: opts.port,
                    resume: opts.resume,
                    continue: opts.continue,
                    bypassPermissions: opts.bypassPermissions,
                };
                await dispatchMainMode({
                    agent,
                    opts: mainModeOpts,
                    workspaceRoot,
                    validatedConfig,
                    resolvedPath,
                    derivedAgentId,
                    initialPrompt,
                    getVersionCheckResult,
                });
            },
            { timeoutMs: 0 }
        )
    );

program.parseAsync(process.argv);
