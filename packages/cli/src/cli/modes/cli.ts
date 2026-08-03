import chalk from 'chalk';
import * as p from '@clack/prompts';
import type { FiusAgent } from '@fiusdev/core';
import { logger } from '@fiusdev/core';
import { safeExit, ExitSignal } from '../../analytics/wrapper.js';
import { hasUsableCredentials } from '../../config/cli-overrides.js';
import type { MainModeContext } from './context.js';
import { applyWorkspaceToAgent } from '../../utils/workspace.js';

let webServerRunning = false;

async function getMostRecentSessionId(agent: FiusAgent): Promise<string | null> {
    const sessionIds = await agent.listSessions();
    if (sessionIds.length === 0) {
        return null;
    }

    let mostRecentId: string | null = null;
    let mostRecentActivity = 0;

    for (const sessionId of sessionIds) {
        const metadata = await agent.getSessionMetadata(sessionId);
        if (metadata && metadata.lastActivity > mostRecentActivity) {
            mostRecentActivity = metadata.lastActivity;
            mostRecentId = sessionId;
        }
    }

    return mostRecentId;
}

export async function runCliMode(context: MainModeContext): Promise<void> {
    const {
        agent,
        opts,
        workspaceRoot,
        validatedConfig,
        resolvedPath,
        initialPrompt,
        getVersionCheckResult,
    } = context;

    const needsHandler =
        validatedConfig.permissions.mode === 'manual' || validatedConfig.elicitation.enabled;

    if (needsHandler) {
        const { createCLIApprovalHandler } = await import('../approval/index.js');
        const handler = createCLIApprovalHandler(agent);
        agent.setApprovalHandler(handler);

        logger.debug('CLI approval handler configured for Ink CLI');
    }

    try {
        await agent.start();
        await applyWorkspaceToAgent(agent, workspaceRoot);
        const llmConfig = agent.getCurrentLLMConfig();
        if (!hasUsableCredentials(llmConfig.provider, llmConfig)) {
            const { globalPreferencesExist, loadGlobalPreferences } = await import(
                '@fiusdev/agent-management'
            );
            const { interactiveApiKeySetup } = await import('../utils/api-key-setup.js');
            const { getProviderDisplayName, getProviderEnvVar } = await import(
                '../utils/provider-setup.js'
            );

            let hasCompletedSetup = false;
            if (globalPreferencesExist()) {
                try {
                    const preferences = await loadGlobalPreferences();
                    hasCompletedSetup = preferences.setup.completed;
                } catch {
                    hasCompletedSetup = false;
                }
            }

            console.log(
                chalk.yellow(
                    `\nвљ пёЏ  API key required for provider '${getProviderDisplayName(llmConfig.provider)}'\n`
                )
            );

            if (!hasCompletedSetup) {
                console.log(
                    chalk.gray(
                        `Fius started with the bundled defaults. ` +
                            `Set ${getProviderEnvVar(llmConfig.provider)} or run ${chalk.cyan(
                                'fius setup'
                            )} to choose a different provider.`
                    )
                );
            }

            const runProviderKeySetup = async () => {
                const setupResult = await interactiveApiKeySetup(llmConfig.provider, {
                    exitOnCancel: false,
                    model: llmConfig.model || '',
                });

                if (setupResult.cancelled) {
                    safeExit('main', 0, 'api-key-setup-cancelled');
                }

                if (setupResult.skipped) {
                    safeExit('main', 0, 'api-key-pending');
                }

                if (setupResult.success && setupResult.apiKey) {
                    await agent.switchLLM({
                        provider: llmConfig.provider,
                        model: llmConfig.model,
                        apiKey: setupResult.apiKey,
                    });
                    logger.info('API key configured successfully, continuing...');
                }
            };

            if (hasCompletedSetup) {
                await runProviderKeySetup();
            } else {
                const action = await p.select({
                    message: 'How would you like to continue?',
                    options: [
                        {
                            value: 'key',
                            label: `Paste a ${getProviderDisplayName(llmConfig.provider)} key`,
                            hint: 'Continue in this session',
                        },
                        {
                            value: 'setup',
                            label: 'Run fius setup',
                            hint: 'Choose a different provider or save defaults',
                        },
                        {
                            value: 'exit',
                            label: 'Exit',
                            hint: 'Configure later',
                        },
                    ],
                });

                if (p.isCancel(action) || action === 'exit') {
                    safeExit('main', 0, 'api-key-setup-cancelled');
                }

                if (action === 'setup') {
                    const { handleSetupCommand } = await import('../commands/setup.js');
                    await handleSetupCommand({ interactive: true, force: true });

                    let preferences;
                    try {
                        preferences = await loadGlobalPreferences();
                    } catch {
                        safeExit('main', 0, 'setup-incomplete');
                    }

                    if (!preferences.setup.completed) {
                        safeExit('main', 0, 'setup-incomplete');
                    }
                    if (preferences.setup.apiKeyPending) {
                        safeExit('main', 0, 'api-key-pending');
                    }
                    await agent.switchLLM({
                        provider: preferences.llm.provider,
                        model: preferences.llm.model,
                        ...(preferences.llm.apiKey && { apiKey: preferences.llm.apiKey }),
                        ...(preferences.llm.baseURL && { baseURL: preferences.llm.baseURL }),
                    });
                    logger.info('Provider configured successfully, continuing...');
                } else {
                    await runProviderKeySetup();
                }
            }
        }

        let cliSessionId: string;
        if (opts.resume) {
            const existing = await agent.getSession(opts.resume);
            if (!existing) {
                console.error(`вќЊ Session '${opts.resume}' not found`);
                console.error('рџ’Ў Use `fius session list` to see available sessions');
                safeExit('main', 1, 'resume-failed');
            }
            cliSessionId = opts.resume;
        } else if (opts.continue) {
            const mostRecentSessionId = await getMostRecentSessionId(agent);
            if (mostRecentSessionId) {
                cliSessionId = mostRecentSessionId;
            } else {
                const session = await agent.createSession();
                cliSessionId = session.id;
            }
        } else {
            const session = await agent.createSession();
            cliSessionId = session.id;
        }

        const originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
            info: console.info,
        };
        const noOp = () => {};
        console.log = noOp;
        console.error = noOp;
        console.warn = noOp;
        console.info = noOp;

        let inkError: unknown = undefined;
        try {
            const [
                { startInkCliRefactored, setTuiRuntimeServices },
                { registerGracefulShutdown },
                { applyLayeredEnvironmentLoading },
                { getProviderDisplayName, validateApiKeyFormat, getProviderInstructions },
                {
                    performDeviceCodeLogin,
                    persistDeviceApiKeyLoginResult,
                    ensureFiusApiKeyForAuthToken,
                    loadAuth,
                    storeAuth,
                    removeAuth,
                    removeFiusApiKeyFromEnv,
                    buildFiusBillingUrl,
                    openFiusBillingPage,
                },
                { canUseFiusProvider },
                {},
                { capture },
            ] = await Promise.all([
                import('@fiusdev/tui'),
                import('../../utils/graceful-shutdown.js'),
                import('../../utils/env.js'),
                import('../utils/provider-setup.js'),
                import('../auth/index.js'),
                import('../../config/effective-llm.js'),
                import('../utils/fius-setup.js'),
                import('../../analytics/index.js'),
            ]);

            let buildMode: 'build' | 'plan' = 'build';
            try {
                const { getBuildModeAsync } = await import('@fiusdev/tui');
                buildMode = await getBuildModeAsync();
            } catch {}

            setTuiRuntimeServices({
                registerGracefulShutdown,
                capture: (event, properties) => {
                    capture(event as never, properties as never);
                },
                applyLayeredEnvironmentLoading,
                getProviderDisplayName,
                isValidApiKeyFormat: validateApiKeyFormat,
                getProviderInstructions,
                performDeviceCodeLogin,
                persistDeviceApiKeyLoginResult,
                ensureFiusApiKeyForAuthToken,
                loadAuth,
                storeAuth,
                removeAuth,
                removeFiusApiKeyFromEnv,
                canUseFiusProvider,
                buildFiusBillingUrl,
                openFiusBillingPage,
                startWebServer: async (options?: { port?: number }) => {
                    if (webServerRunning) {
                        const port = options?.port ?? 3000;
                        return { url: `http://localhost:${port}` };
                    }

                    const port = options?.port ?? 3000;

                    try {
                        const [{ resolveWebRoot }, { startHonoApiServer }] = await Promise.all([
                            import('../../web.js'),
                            import('../../api/server-hono.js'),
                        ]);

                        const webRoot = resolveWebRoot();

                        await startHonoApiServer(
                            agent,
                            port,
                            agent.config.agentCard || {},
                            agent.config.agentId,
                            resolvedPath,
                            workspaceRoot,
                            webRoot
                        );

                        webServerRunning = true;

                        const url = `http://localhost:${port}`;
                        try {
                            const { default: open } = await import('open');
                            await open(url, { wait: false });
                        } catch {}

                        return { url };
                    } catch (err: any) {
                        console.error(`[Fius] Failed to start WebUI server: ${err?.message || err}`);
                        return { url: `http://localhost:${port}` };
                    }
                },
            });


            while (true) {
                await startInkCliRefactored(agent, cliSessionId, {
                    configFilePath: resolvedPath,
                    ...(initialPrompt && { initialPrompt }),
                    bypassPermissions: opts.bypassPermissions,
                    buildMode,
                });

                const { wasLogoutRequested, resetLogoutRequested } = await import('@fiusdev/tui');
                if (!wasLogoutRequested()) break;

                resetLogoutRequested();
                const { handleLoginCommand } = await import('../commands/auth/login.js');
                console.log = originalConsole.log;
                console.error = originalConsole.error;
                console.warn = originalConsole.warn;
                console.info = originalConsole.info;
                try {
                    await handleLoginCommand();
                } finally {
                    console.log = noOp;
                    console.error = noOp;
                    console.warn = noOp;
                    console.info = noOp;
                }
                logger.debug('[AUTH-DEBUG] handleLoginCommand completed, creating new session');

                const newSession = await agent.createSession();
                cliSessionId = newSession.id;
                logger.debug('[AUTH-DEBUG] New session created, sessionId=' + cliSessionId + ', restarting loop');
            }
        } catch (error) {
            inkError = error;
        } finally {
            console.log = originalConsole.log;
            console.error = originalConsole.error;
            console.warn = originalConsole.warn;
            console.info = originalConsole.info;
        }

        if (inkError) {
            if (inkError instanceof ExitSignal) throw inkError;
            const errorMessage = inkError instanceof Error ? inkError.message : String(inkError);
            console.error(`вќЊ Ink CLI failed: ${errorMessage}`);
            if (inkError instanceof Error && inkError.stack) {
                console.error(inkError.stack);
            }
            safeExit('main', 1, 'ink-cli-error');
        }

        safeExit('main', 0);
    } finally {
        try {
            await agent.stop();
        } catch {
        }
    }
}