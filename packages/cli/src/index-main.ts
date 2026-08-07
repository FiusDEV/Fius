import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { Command } from 'commander';

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

import { logger, startLlmRegistryAutoUpdate, FiusAgent } from '@fiusdev/core';
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
    enrichAgentConfig,
    createModelAuthResolver,
} from '@fiusdev/agent-management';
import { validateAgentConfig } from './cli/utils/config-validation.js';
import { registerSessionCommand } from './cli/commands/session/register.js';
import { registerSearchCommand } from './cli/commands/search/register.js';
import { ensureImageImporterConfigured } from './cli/utils/image-importer.js';
import type { BootstrapAgentMode } from './cli/commands/register-context.js';
import type { MainModeOptions } from './cli/modes/context.js';

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
    .description('AI-powered CLI for interacting with agents.')
    .version(cliVersion, '-v, --version', 'output the current version')
    .enablePositionalOptions();

async function bootstrapAgentFromGlobalOpts(_options: {
    mode: BootstrapAgentMode;
    modelOverride?: string;
}) {
    await ensureFiusApiKeyBootstrap();
    await ensureImageImporterConfigured();
    const workspaceRoot = findFiusProjectRoot(process.cwd()) ?? process.cwd();
    const resolvedPath = await resolveAgentPath(undefined, true);
    const rawConfig = await loadAgentConfig(resolvedPath);
    const cleanedConfig = cleanNullValues(rawConfig);
    const imageName = cleanedConfig.image || process.env.FIUS_IMAGE || '@fiusdev/image-local';
    let image: FiusImage;
    try {
        image = await loadImage(imageName);
    } catch (err) {
        console.error(`❌ Failed to load image '${imageName}'`);
        safeExit('bootstrap', 1, 'image-load-failed');
        throw err;
    }
    const configWithImageDefaults = applyImageDefaults(cleanedConfig, image.defaults);
    const enrichedConfig = enrichAgentConfig(configWithImageDefaults, resolvedPath, {
        logLevel: 'error',
        workspaceRoot,
    });
    enrichedConfig.permissions = { ...(enrichedConfig.permissions ?? {}), mode: 'auto-approve' };
    enrichedConfig.elicitation = { enabled: false };
    const validatedConfig = AgentConfigSchema.parse(enrichedConfig);
    const services = await resolveServicesFromConfig(validatedConfig, image, { workspaceRoot });
    const agent = new FiusAgent(
        toFiusAgentOptions({
            config: validatedConfig,
            services,
            image,
            hostContext: { workspaceRoot },
            overrides: { authResolver: createModelAuthResolver() },
        })
    );
    await agent.start();
    await (await import('./utils/workspace.js')).applyWorkspaceToAgent(agent, workspaceRoot);
    return agent;
}

const runtimeCommandContext = {
    program,
    cliVersion,
    bootstrapAgentFromGlobalOpts,
};
registerSessionCommand(runtimeCommandContext);
registerSearchCommand(runtimeCommandContext);

program
    .description(
        'Fius CLI - AI-powered assistant.\n\n' +
            'Basic Usage:\n' +
            '  fius                       Start interactive CLI (default)\n\n' +
            'Session Management:\n' +
            '  fius session list              List all sessions\n' +
            '  fius session history [id]      Show session history\n' +
            '  fius session delete <id>       Delete a session\n' +
            '  fius search <query>            Search across sessions\n\n' +
            'Docs: https://docs.fius.ai'
    )
    .action(
        withAnalytics(
            'main',
            async () => {
                await ensureFiusApiKeyBootstrap();
                ensureLlmRegistryAutoUpdateStarted();

                if (!process.stdin.isTTY) {
                    console.error('❌ Interactive CLI requires a TTY.');
                    safeExit('main', 1, 'no-tty');
                }

                let validatedConfig: ValidatedAgentConfig;
                let resolvedPath: string;
                let image: FiusImage;
                let imageName: string;

                try {
                    await ensureImageImporterConfigured();
                    resolvedPath = await resolveAgentPath(undefined, true);

                    const rawConfig = await loadAgentConfig(resolvedPath);
                    let mergedConfig = { ...rawConfig };

                    const agentId = 'fius';

                    {
                        const { checkFiusAuthState } = await import(
                            './cli/utils/fius-auth-check.js'
                        );
                        const authCheck = await checkFiusAuthState(true, agentId);

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

                    const cleanedConfig = cleanNullValues(mergedConfig);

                    imageName =
                        cleanedConfig.image ||
                        process.env.FIUS_IMAGE ||
                        '@fiusdev/image-local';

                    try {
                        image = await loadImage(imageName);
                        logger.debug(`Loaded image: ${imageName}`);
                    } catch (err) {
                        console.error(`❌ Failed to load image '${imageName}'`);
                        if (err instanceof Error) {
                            console.error(err.message);
                            logger.debug(`Image load error: ${err.message}`);
                        }
                        safeExit('main', 1, 'image-load-failed');
                    }

                    const configWithImageDefaults = applyImageDefaults(
                        cleanedConfig,
                        image.defaults
                    );

                    const workspaceRoot = findFiusProjectRoot(process.cwd()) ?? process.cwd();
                    const enrichedConfig = enrichAgentConfig(
                        configWithImageDefaults,
                        resolvedPath,
                        {
                            isInteractiveCli: true,
                            logLevel: 'info',
                            workspaceRoot,
                        }
                    );

                    const validationResult = await validateAgentConfig(
                        enrichedConfig,
                        true,
                        {
                            credentialPolicy: 'warn',
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
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ Failed to load configuration: ${err}`);
                    safeExit('main', 1, 'config-load-failed');
                }

                let agent: FiusAgent;
                let derivedAgentId: string;
                const workspaceRoot = findFiusProjectRoot(process.cwd()) ?? process.cwd();

                try {
                    process.env.FIUS_RUN_MODE = 'cli';

                    const { createFileSessionLoggerFactory } = await import(
                        './utils/session-logger-factory.js'
                    );
                    const sessionLoggerFactory = createFileSessionLoggerFactory();

                    const mcpAuthProviderFactory = (
                        await import('./cli/mcp/oauth-factory.js')
                    ).createMcpAuthProviderFactory({
                        logger,
                    });

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
                    mode: 'cli',
                };
                await dispatchMainMode({
                    agent,
                    opts: mainModeOpts,
                    workspaceRoot,
                    validatedConfig,
                    resolvedPath,
                    derivedAgentId,
                    initialPrompt: undefined,
                    getVersionCheckResult,
                });
            },
            { timeoutMs: 0 }
        )
    );

program.parseAsync(process.argv);
