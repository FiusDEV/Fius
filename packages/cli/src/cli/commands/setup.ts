import chalk from 'chalk';
import { z } from 'zod';
import {
    acceptsAnyModel,
    getDefaultModelForProvider,
    getReasoningProfile,
    getSupportedModels,
    isValidProviderModel,
    LLM_PROVIDERS,
    LLM_REGISTRY,
    requiresApiKey,
    supportsCustomModels,
    type LLMProvider,
    type ReasoningVariant,
} from '@fiusdev/llm';
import { getCuratedModelsForProvider, logger, resolveApiKeyForProvider } from '@fiusdev/core';
import {
    createInitialPreferences,
    saveGlobalPreferences,
    loadGlobalPreferences,
    getGlobalPreferencesPath,
    updateGlobalPreferences,
    setActiveModel,
    loadCustomModels,
    saveCustomModel,
    deleteCustomModel,
    globalPreferencesExist,
    getDefaultModelAuthProfile,
    loadModelAuthProfilesSync,
    type CustomModel,
    type CreatePreferencesOptions,
} from '@fiusdev/agent-management';
import { interactiveApiKeySetup, hasApiKeyConfigured } from '../utils/api-key-setup.js';
import {
    selectProvider,
    getProviderDisplayName,
    getProviderEnvVar,
    providerRequiresBaseURL,
    getDefaultModel,
} from '../utils/provider-setup.js';
import {
    setupLocalModels,
    setupOllamaModels,
    hasSelectedModel,
    getModelFromResult,
} from '../utils/local-model-setup.js';
import { requiresSetup } from '../utils/setup-utils.js';
import { canUseFiusProvider } from '../utils/fius-setup.js';
import { handleAutoLogin } from './auth/login.js';
import { loadAuth, getBillingBalanceForCurrentLogin, openFiusBillingPage } from '../auth/index.js';
import { FIUS_CREDITS_URL } from '../auth/constants.js';
import * as p from '@clack/prompts';
import { capture } from '../../analytics/index.js';


const SetupCommandSchema = z
    .object({
        provider: z
            .enum(LLM_PROVIDERS)
            .optional()
            .describe('AI provider identifier to use for LLM calls'),
        model: z
            .string()
            .min(1, 'Model name cannot be empty')
            .optional()
            .describe('Preferred model name for the selected provider'),
        defaultAgent: z
            .string()
            .min(1, 'Default agent name cannot be empty')
            .default('fius')
            .describe('Registry agent id to use when none is specified'),
        interactive: z.boolean().default(true).describe('Enable interactive prompts'),
        force: z
            .boolean()
            .default(false)
            .describe('Overwrite existing setup when already configured'),
        defaultMode: z
            .enum(['cli', 'web', 'server', 'discord', 'telegram', 'mcp'])
            .optional()
            .describe('Preferred default mode for interactive setup flows'),
        quickStart: z
            .boolean()
            .default(false)
            .describe('Use quick start with Google Gemini (recommended for new users)'),
    })
    .strict()
    .superRefine((data, ctx) => {

        if (data.provider && data.model) {

            if (!acceptsAnyModel(data.provider) && !supportsCustomModels(data.provider)) {
                if (!isValidProviderModel(data.provider, data.model)) {
                    const supportedModels = getSupportedModels(data.provider);
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['model'],
                        message: `Model '${data.model}' is not supported by provider '${data.provider}'. Supported models: ${supportedModels.join(', ')}`,
                    });
                }
            }
        }
    });

export type CLISetupOptions = z.output<typeof SetupCommandSchema>;
export type CLISetupOptionsInput = z.input<typeof SetupCommandSchema>;

const REASONING_VARIANT_HINTS: Readonly<Record<string, string>> = {
    disabled: 'Disable reasoning (fastest)',
    none: 'Disable reasoning (fastest)',
    enabled: 'Enable provider default reasoning',
    minimal: 'Minimal reasoning',
    low: 'Light reasoning, faster responses',
    medium: 'Balanced reasoning',
    high: 'Thorough reasoning',
    max: 'Maximum reasoning within provider limits',
    xhigh: 'Extra high reasoning',
};

function toReasoningVariantLabel(variant: string, defaultVariant: string | undefined): string {
    const normalized = variant.toLowerCase();
    const withKnownCasing =
        normalized === 'xhigh'
            ? 'XHigh'
            : normalized === 'none'
              ? 'None'
              : normalized === 'disabled'
                ? 'Disabled'
                : normalized === 'enabled'
                  ? 'Enabled'
                  : normalized.charAt(0).toUpperCase() + normalized.slice(1);

    return variant === defaultVariant ? `${withKnownCasing} (Recommended)` : withKnownCasing;
}

function getReasoningVariantSelectOptions(
    variants: readonly ReasoningVariant[],
    defaultVariant: string | undefined
): {
    value: ReasoningVariant;
    label: string;
    hint: string;
}[] {
    return variants.map((variant) => ({
        value: variant,
        label: toReasoningVariantLabel(variant, defaultVariant),
        hint: REASONING_VARIANT_HINTS[variant] ?? 'Model/provider-native reasoning variant',
    }));
}

function hasUsableModelAuthProfile(provider: LLMProvider): boolean {
    const profile = getDefaultModelAuthProfile(loadModelAuthProfilesSync(), provider);
    if (!profile) {
        return false;
    }

    if (profile.credential.type === 'api_key_env') {
        return Boolean(process.env[profile.credential.envVar]?.trim());
    }

    return true;
}





type SetupStep = 'setupType' | 'provider' | 'model' | 'reasoning' | 'apiKey' | 'mode' | 'complete';

interface SetupWizardState {
    step: SetupStep;
    setupType?: 'quick' | 'custom' | undefined;
    provider?: LLMProvider | undefined;
    model?: string | undefined;
    baseURL?: string | undefined;
    reasoningPreset?: ReasoningVariant | undefined;
    apiKeySkipped?: boolean | undefined;
    defaultMode?: 'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp' | undefined;
    preferredDefaultMode?: 'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp' | undefined;
    /** Quick start handles its own preferences saving */
    quickStartHandled?: boolean | undefined;
}

function getWizardSteps(
    provider?: LLMProvider,
    model?: string
): Array<{ key: SetupStep; label: string }> {
    const isLocalProvider = provider === 'local' || provider === 'ollama';
    const showReasoningStep =
        provider !== undefined &&
        model !== undefined &&
        getReasoningProfile(provider, model).capable;

    if (isLocalProvider) {
        const steps: Array<{ key: SetupStep; label: string }> = [
            { key: 'provider', label: 'Provider' },
            { key: 'model', label: 'Model' },
        ];
        if (showReasoningStep) {
            steps.push({ key: 'reasoning', label: 'Reasoning' });
        }
        steps.push({ key: 'mode', label: 'Mode' });
        return steps;
    }

    const steps: Array<{ key: SetupStep; label: string }> = [
        { key: 'provider', label: 'Provider' },
        { key: 'model', label: 'Model' },
    ];
    if (showReasoningStep) {
        steps.push({ key: 'reasoning', label: 'Reasoning' });
    }
    steps.push({ key: 'apiKey', label: 'API Key' });
    steps.push({ key: 'mode', label: 'Mode' });
    return steps;
}

function showStepProgress(currentStep: SetupStep, provider?: LLMProvider, model?: string): void {
    if (currentStep === 'setupType' || currentStep === 'complete') {
        return;
    }

    const steps = getWizardSteps(provider, model);
    const currentIndex = steps.findIndex((s) => s.key === currentStep);

    if (currentIndex === -1) {
        return;
    }

    const progress = steps
        .map((step, i) => {
            if (i < currentIndex) return chalk.green(`вњ“ ${step.label}`);
            if (i === currentIndex) return chalk.cyan(`в—Џ ${step.label}`);
            return chalk.gray(`в—‹ ${step.label}`);
        })
        .join('  ');

    console.log(`\n  ${progress}\n`);
}

function validateSetupCommand(options: Partial<CLISetupOptionsInput>): CLISetupOptions {
    const validated = SetupCommandSchema.parse(options);

    if (!validated.interactive && !validated.provider && !validated.quickStart) {
        throw new Error(
            'Provider required in non-interactive mode. Use --provider or --quick-start option.'
        );
    }

    return validated;
}

export async function handleSetupCommand(options: Partial<CLISetupOptionsInput>): Promise<void> {
    const validated = validateSetupCommand(options);
    logger.debug(`Validated setup command options: ${JSON.stringify(validated, null, 2)}`);

    const needsSetup = await requiresSetup();

    if (!needsSetup && !validated.force) {
        if (!validated.interactive) {
            console.error(chalk.red('вќЊ Setup is already complete.'));
            console.error(
                chalk.gray('   Use --force to overwrite, or run interactively for options.')
            );
            process.exit(1);
        }

        await showSettingsMenu();
        return;
    }

    if (validated.quickStart) {
        await handleQuickStart({
            onCancel: 'exit',
            preferredDefaultMode: validated.defaultMode,
        });
        return;
    }

    if (validated.interactive && !validated.provider) {
        await handleInteractiveSetup(validated);
        return;
    }

    await handleNonInteractiveSetup(validated);
}

type QuickStartCancelBehavior = 'exit' | 'back';

interface QuickStartOptions {
    onCancel: QuickStartCancelBehavior;
    preferredDefaultMode?: CLISetupOptions['defaultMode'];
}

async function handleQuickStart(
    options: QuickStartOptions = { onCancel: 'exit' }
): Promise<'completed' | 'cancelled'> {
    console.log(chalk.cyan('\nрџљЂ Quick Start\n'));

    p.intro(chalk.cyan('Quick Setup'));

    while (true) {
        const quickProvider = await p.select({
            message: 'Choose a provider',
            options: [
                {
                    value: 'google' as const,
                    label: `${chalk.green('в—Џ')} Google Gemini`,
                    hint: 'Free, 1M+ context (recommended)',
                },
                {
                    value: 'groq' as const,
                    label: `${chalk.green('в—Џ')} Groq`,
                    hint: 'Free, ultra-fast',
                },
                {
                    value: 'openrouter' as const,
                    label: `${chalk.green('в—Џ')} OpenRouter (Free)`,
                    hint: 'Use free-tier models via OpenRouter',
                },
                {
                    value: 'local' as const,
                    label: `${chalk.cyan('в—Џ')} Local Models`,
                    hint: 'Free, private, runs on your machine',
                },
                { value: '_back' as const, label: chalk.gray('в†ђ Back'), hint: 'Return' },
            ],
        });

        if (p.isCancel(quickProvider) || quickProvider === '_back') {
            if (options.onCancel === 'exit') {
                p.cancel('Setup cancelled');
            }
            return 'cancelled';
        }

        if (quickProvider === 'local') {
            const localResult = await setupLocalModels();
            if (!hasSelectedModel(localResult)) {
                if (options.onCancel === 'exit') {
                    p.cancel('Setup cancelled');
                    return 'cancelled';
                }
                continue;
            }
            const model = getModelFromResult(localResult);

            const useCli = await p.confirm({
                message: 'Start in Terminal mode? (You can change this later)',
                initialValue: true,
            });

            if (p.isCancel(useCli)) {
                if (options.onCancel === 'exit') {
                    p.cancel('Setup cancelled');
                    return 'cancelled';
                }
                continue;
            }

            const defaultMode = useCli
                ? 'cli'
                : await selectDefaultMode(options.preferredDefaultMode);
            if (defaultMode === null) {
                if (options.onCancel === 'exit') {
                    p.cancel('Setup cancelled');
                    return 'cancelled';
                }
                continue;
            }

            await setActiveModel(model);

            const preferences = createInitialPreferences({
                provider: 'local',
                model,
                defaultMode,
                setupCompleted: true,
                apiKeyPending: false,
            });

            await saveGlobalPreferences(preferences);

            capture('fius_setup', {
                provider: 'local',
                model,
                setupMode: 'interactive',
                setupVariant: 'quick-start',
                defaultMode,
                apiKeySkipped: false,
            });

            await showSetupComplete('local', model, defaultMode, false);
            return 'completed';
        }

        const provider: LLMProvider = quickProvider;
        let model: string;
        if (provider === 'openrouter') {
            const selected = await p.select({
                message: 'Select a model for OpenRouter',
                options: [
                    {
                        value: 'openrouter/free' as const,
                        label: 'OpenRouter Free Models',
                        hint: 'Free-tier access via OpenRouter',
                    },
                    {
                        value: 'custom' as const,
                        label: 'Enter a model ID',
                        hint: 'e.g., anthropic/claude-3.5-sonnet',
                    },
                    { value: '_back' as const, label: chalk.gray('в†ђ Back'), hint: 'Return' },
                ],
            });

            if (p.isCancel(selected) || selected === '_back') {
                if (options.onCancel === 'exit') {
                    p.cancel('Setup cancelled');
                    return 'cancelled';
                }
                continue;
            }

            if (selected === 'openrouter/free') {
                model = 'openrouter/free';
            } else {
                const modelInput = await p.text({
                    message: 'Enter model name for OpenRouter',
                    placeholder: 'e.g., anthropic/claude-3.5-sonnet',
                    validate: (value) => {
                        const trimmed = typeof value === 'string' ? value.trim() : '';
                        if (!trimmed) return 'Model name is required';
                        return undefined;
                    },
                });

                if (p.isCancel(modelInput)) {
                    if (options.onCancel === 'exit') {
                        p.cancel('Setup cancelled');
                        return 'cancelled';
                    }
                    continue;
                }

                model = modelInput.trim();
            }
        } else {
            model =
                getDefaultModelForProvider(provider) ||
                (provider === 'google' ? 'gemini-2.5-pro' : 'llama-3.3-70b-versatile');
        }
        const apiKeyVar = getProviderEnvVar(provider);
        let apiKeySkipped = false;

        const hasKey = hasApiKeyConfigured(provider) || hasUsableModelAuthProfile(provider);

        if (!hasKey) {
            const providerName = getProviderDisplayName(provider);
            p.note(
                `${providerName} is ${chalk.green('free')} to use!\n\n` +
                    `We'll help you get an API key in just a few seconds.`,
                'Free AI Access'
            );

            const result = await interactiveApiKeySetup(provider, {
                exitOnCancel: false,
                model,
            });

            if (result.cancelled) {
                if (options.onCancel === 'exit') {
                    p.cancel('Setup cancelled');
                    return 'cancelled';
                }
                continue;
            }

            if (result.skipped || !result.success) {
                apiKeySkipped = true;
            }
        } else {
            p.log.success(`API key for ${getProviderDisplayName(provider)} already configured`);
        }

        const useCli = await p.confirm({
            message: 'Start in Terminal mode? (You can change this later)',
            initialValue: true,
        });

        if (p.isCancel(useCli)) {
            if (options.onCancel === 'exit') {
                p.cancel('Setup cancelled');
                return 'cancelled';
            }
            continue;
        }

        const defaultMode = useCli ? 'cli' : await selectDefaultMode(options.preferredDefaultMode);

        if (defaultMode === null) {
            if (options.onCancel === 'exit') {
                p.cancel('Setup cancelled');
                return 'cancelled';
            }
            continue;
        }

        const preferencesOptions: CreatePreferencesOptions = {
            provider,
            model,
            defaultMode,
            setupCompleted: true,
            apiKeyPending: apiKeySkipped,
        };
        if (!apiKeySkipped && hasApiKeyConfigured(provider)) {
            preferencesOptions.apiKeyVar = apiKeyVar;
        }
        const preferences = createInitialPreferences(preferencesOptions);

        await saveGlobalPreferences(preferences);

        capture('fius_setup', {
            provider,
            model,
            setupMode: 'interactive',
            setupVariant: 'quick-start',
            defaultMode,
            apiKeySkipped,
        });

        await showSetupComplete(provider, model, defaultMode, apiKeySkipped);
        return 'completed';
    }
}

async function handleFiusProviderSetup(
    options: { exitOnCancel?: boolean } = {}
): Promise<boolean> {
    const exitOnCancel = options.exitOnCancel ?? true;
    const abort = (message: string, exitCode: number = 0): false => {
        p.cancel(message);
        if (exitOnCancel) {
            process.exit(exitCode);
        }
        return false;
    };

    console.log(chalk.magenta('\nв… Fius Setup\n'));

    const hasKey = await canUseFiusProvider();

    if (!hasKey) {
        p.note(
            `Fius gives you instant access to ${chalk.cyan('all AI models')} with a single account.\n\n` +
                `We'll guide you through device-code login.`,
            'Login Required'
        );

        const shouldLogin = await p.confirm({
            message: 'Continue with Fius login?',
            initialValue: true,
        });

        if (p.isCancel(shouldLogin) || !shouldLogin) {
            return abort('Setup cancelled');
        }

        try {
            await handleAutoLogin();
            if (!(await canUseFiusProvider())) {
                p.log.error(
                    'API key provisioning failed. Please try again or use `fius setup` with a different provider.'
                );
                return abort('Setup cancelled', 1);
            }
            p.log.success('Login successful! Continuing with setup...');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            p.log.error(`Login failed: ${errorMessage}`);
            return abort('Setup cancelled - login required for Fius', 1);
        }
    } else {
        const auth = await loadAuth();
        const userLabel = auth?.email || auth?.userId || 'unknown';
        p.log.success(`Logged in to Fius as: ${userLabel}`);
    }

    const balance = await getCreditsBalance();
    if (balance !== null) {
        p.note(`$${balance.toFixed(2)} remaining`, 'Fius balance');
    }

    const shouldOpenCredits = await p.confirm({
        message: 'Want to buy or top up Fius credits now?',
        initialValue: false,
    });

    if (p.isCancel(shouldOpenCredits)) {
        return abort('Setup cancelled');
    }

    if (shouldOpenCredits) {
        await openCreditsPage();

        const continueSetup = await p.confirm({
            message: 'Continue choosing a model?',
            initialValue: true,
        });

        if (p.isCancel(continueSetup) || !continueSetup) {
            return abort('Setup cancelled');
        }
    }

    const model = await p.select({
        message: 'Select a model to start with',
        options: [
            {
                value: 'anthropic/claude-haiku-4.5',
                label: 'Claude Haiku 4.5',
                hint: 'Fast & affordable (recommended)',
            },
            {
                value: 'anthropic/claude-sonnet-4.5',
                label: 'Claude Sonnet 4.5',
                hint: 'Balanced performance and cost',
            },
            {
                value: 'anthropic/claude-opus-4.5',
                label: 'Claude Opus 4.5',
                hint: 'Most capable Claude model',
            },
            {
                value: 'openai/gpt-5.2',
                label: 'GPT-5.2',
                hint: 'OpenAI flagship model',
            },
            {
                value: 'openai/gpt-5.2-codex',
                label: 'GPT-5.2 Codex',
                hint: 'Optimized for coding',
            },
            {
                value: 'google/gemini-3-pro-preview',
                label: 'Gemini 3 Pro',
                hint: 'Google flagship model',
            },
            {
                value: 'google/gemini-3-flash-preview',
                label: 'Gemini 3 Flash',
                hint: 'Fast and efficient',
            },
            {
                value: 'qwen/qwen3-coder:free',
                label: 'Qwen3 Coder (Free)',
                hint: 'Free coding model, 262k context',
            },
            {
                value: 'deepseek/deepseek-r1-0528:free',
                label: 'DeepSeek R1 (Free)',
                hint: 'Free reasoning model, 163k context',
            },
            {
                value: 'z-ai/glm-4.7',
                label: 'GLM 4.7',
                hint: 'Zhipu AI flagship model',
            },
            {
                value: 'minimax/minimax-m2.1',
                label: 'Minimax M2.1',
                hint: 'Fast model with 196k context',
            },
            {
                value: 'moonshotai/kimi-k2.5',
                label: 'Kimi K2.5',
                hint: 'Multimodal coding model, 262k context',
            },
        ],
    });

    if (p.isCancel(model)) {
        return abort('Setup cancelled');
    }

    const provider: LLMProvider = 'openrouter';

    const selectedModel = model as string;

    p.log.info(`${chalk.dim('Tip:')} You can switch models anytime with ${chalk.cyan('/models')}`);

    const defaultMode = await selectDefaultMode();

    if (defaultMode === null) {
        return abort('Setup cancelled');
    }

    const preferences = createInitialPreferences({
        provider,
        model: selectedModel,
        defaultMode,
        setupCompleted: true,
        apiKeyPending: false,
        apiKeyVar: 'FIUS_API_KEY',
    });

    await saveGlobalPreferences(preferences);

    capture('fius_setup', {
        provider,
        model: selectedModel,
        setupMode: 'interactive',
        setupVariant: 'openrouter',
        defaultMode,
    });

    await showSetupComplete(provider, selectedModel, defaultMode, false);
    return true;
}

async function openCreditsPage(): Promise<void> {
    try {
        await openFiusBillingPage({});
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.log.warn(`Unable to open browser: ${errorMessage}`);
        p.log.info(`Open this link to buy credits: ${FIUS_CREDITS_URL}`);
    }
}

async function getCreditsBalance(): Promise<number | null> {
    try {
        return await getBillingBalanceForCurrentLogin();
    } catch {
        return null;
    }
}

async function handleInteractiveSetup(options: CLISetupOptions): Promise<void> {
    await handleAutoLogin();

    const preferences = createInitialPreferences({
        provider: 'openrouter',
        model: 'anthropic/claude-haiku-4.5',
        defaultMode: 'cli',
        setupCompleted: true,
        apiKeyPending: false,
    });

    await saveGlobalPreferences(preferences);

    console.log(chalk.green('\n  Setup complete! You can now use Fius.'));
    process.exit(0);
}

async function wizardStepSetupType(state: SetupWizardState): Promise<SetupWizardState> {
    const options: Array<{ value: string; label: string; hint: string }> = [];

    options.push(
        {
            value: 'quick',
            label: `${chalk.blue('в—Џ')} Quick Start`,
            hint: 'Google Gemini (free) - no account needed',
        },
        {
            value: 'custom',
            label: `${chalk.cyan('в—Џ')} Custom Setup`,
            hint: 'Choose your provider (OpenAI, Anthropic, Ollama, etc.)',
        }
    );

    const setupType = await p.select({
        message: 'How would you like to set up Fius?',
        options,
    });

    if (p.isCancel(setupType)) {
        p.cancel('Setup cancelled');
        process.exit(0);
    }

    if (setupType === 'quick') {
        const result = await handleQuickStart({
            onCancel: 'back',
            preferredDefaultMode: state.preferredDefaultMode,
        });
        if (result === 'cancelled') {
            return { ...state, step: 'setupType' };
        }
        return { ...state, step: 'complete', quickStartHandled: true };
    }

    return { ...state, step: 'provider', setupType: 'custom' };
}

async function wizardStepProvider(state: SetupWizardState): Promise<SetupWizardState> {
    showStepProgress('provider', state.provider);

    const provider = await selectProvider();

    if (provider === null) {
        return { ...state, step: 'setupType', provider: undefined };
    }

    if (provider === '_back') {
        return { ...state, step: 'setupType', provider: undefined };
    }

    return { ...state, step: 'model', provider };
}

async function wizardStepModel(state: SetupWizardState): Promise<SetupWizardState> {
    const provider = state.provider!;
    showStepProgress('model', provider);

    if (provider === 'local') {
        const localResult = await setupLocalModels();
        if (!hasSelectedModel(localResult)) {
            return { ...state, step: 'provider', model: undefined };
        }
        const model = getModelFromResult(localResult);
        const nextStep = getReasoningProfile(provider, model).capable ? 'reasoning' : 'mode';
        return { ...state, step: nextStep, model };
    }

    if (provider === 'ollama') {
        const ollamaResult = await setupOllamaModels();
        if (!hasSelectedModel(ollamaResult)) {
            return { ...state, step: 'provider', model: undefined };
        }
        const model = getModelFromResult(ollamaResult);
        const nextStep = getReasoningProfile(provider, model).capable ? 'reasoning' : 'mode';
        return { ...state, step: nextStep, model };
    }

    let baseURL: string | undefined;
    if (providerRequiresBaseURL(provider)) {
        const result = await promptForBaseURL(provider);
        if (result === null) {
            return { ...state, step: 'provider', model: undefined, baseURL: undefined };
        }
        baseURL = result;
    }

    const selection = await selectModelWithBack(provider);

    if (selection === '_back') {
        return { ...state, step: 'provider', model: undefined, baseURL: undefined };
    }

    const model = selection.model;
    const nextStep = getReasoningProfile(provider, model).capable ? 'reasoning' : 'apiKey';
    return { ...state, step: nextStep, model, baseURL };
}

async function wizardStepReasoning(state: SetupWizardState): Promise<SetupWizardState> {
    const provider = state.provider!;
    const model = state.model!;
    const isLocalProvider = provider === 'local' || provider === 'ollama';
    showStepProgress('reasoning', provider, model);

    const support = getReasoningProfile(provider, model);
    const initialValue = support.defaultVariant ?? support.supportedVariants[0];

    const result = await p.select({
        message: 'Select reasoning variant',
        options: [
            ...getReasoningVariantSelectOptions(support.supportedVariants, support.defaultVariant),
            { value: '_back' as const, label: chalk.gray('в†ђ Back'), hint: 'Change model' },
        ],
        ...(initialValue ? { initialValue } : {}),
    });

    if (p.isCancel(result)) {
        return { ...state, step: 'model', reasoningPreset: undefined };
    }

    if (result === '_back') {
        return { ...state, step: 'model', reasoningPreset: undefined };
    }

    const nextStep = isLocalProvider ? 'mode' : 'apiKey';
    const shouldPersistOverride = result !== support.defaultVariant;
    return {
        ...state,
        step: nextStep,
        reasoningPreset: shouldPersistOverride ? result : undefined,
    };
}

async function wizardStepApiKey(state: SetupWizardState): Promise<SetupWizardState> {
    const provider = state.provider!;
    const model = state.model!;
    showStepProgress('apiKey', provider, model);

    const hasKey = hasApiKeyConfigured(provider) || hasUsableModelAuthProfile(provider);
    const needsApiKey = requiresApiKey(provider);

    if (needsApiKey && !hasKey) {
        const result = await interactiveApiKeySetup(provider, {
            exitOnCancel: false,
            model,
        });

        if (result.cancelled) {
            const prevStep = getReasoningProfile(provider, model).capable ? 'reasoning' : 'model';
            return { ...state, step: prevStep, apiKeySkipped: undefined };
        }

        const apiKeySkipped = result.skipped || !result.success;
        return { ...state, step: 'mode', apiKeySkipped };
    } else if (needsApiKey && hasKey) {
        p.log.success(`API key for ${getProviderDisplayName(provider)} already configured`);
    } else if (!needsApiKey) {
        p.log.info(`${getProviderDisplayName(provider)} does not require an API key`);
    }

    return { ...state, step: 'mode', apiKeySkipped: false };
}

async function wizardStepMode(state: SetupWizardState): Promise<SetupWizardState> {
    const provider = state.provider!;
    const model = state.model!;
    const isLocalProvider = provider === 'local' || provider === 'ollama';
    const hasReasoningStep = getReasoningProfile(provider, model).capable;
    showStepProgress('mode', provider, model);

    const mode = await selectDefaultModeWithBack(state.preferredDefaultMode);

    if (mode === '_back') {
        if (isLocalProvider) {
            return {
                ...state,
                step: hasReasoningStep ? 'reasoning' : 'model',
                defaultMode: undefined,
            };
        }

        const canShowApiKeyStep =
            requiresApiKey(provider) &&
            !hasApiKeyConfigured(provider) &&
            !hasUsableModelAuthProfile(provider);
        let prevStep: SetupWizardState['step'] = 'model';
        if (canShowApiKeyStep) {
            prevStep = 'apiKey';
        } else if (hasReasoningStep) {
            prevStep = 'reasoning';
        }
        return {
            ...state,
            step: prevStep,
            defaultMode: undefined,
        };
    }

    return { ...state, step: 'complete', defaultMode: mode };
}

async function selectModelWithBack(
    provider: LLMProvider
): Promise<{ model: string; isCustomSelection?: boolean } | '_back'> {
    const providerInfo = LLM_REGISTRY[provider];

    if (providerInfo?.models && providerInfo.models.length > 0) {
        const curatedModels = getCuratedModelsForProvider(provider);

        if (provider === 'openrouter') {
            const curatedOptions = curatedModels
                .slice(0, 8)
                .filter((m) => m.name !== 'openrouter/free')
                .map((m) => ({
                    value: m.name,
                    label: m.displayName || m.name,
                }));

            if (supportsCustomModels(provider)) {
                p.log.info(chalk.gray('Tip: You can add or edit custom models via /models'));

                const manageCustomModels = await p.confirm({
                    message: 'Manage custom models now?',
                    initialValue: false,
                });

                if (p.isCancel(manageCustomModels)) {
                    return '_back';
                }

                if (manageCustomModels) {
                    const customModel = await handleCustomModelManagement(provider);
                    if (customModel) {
                        return { model: customModel, isCustomSelection: true };
                    }
                }
            }

            const result = await p.select({
                message: `Select a model for ${getProviderDisplayName(provider)}`,
                options: [
                    {
                        value: 'openrouter/free' as const,
                        label: 'OpenRouter Free Models',
                        hint: '(recommended)',
                    },
                    ...curatedOptions,
                    {
                        value: '_back' as const,
                        label: chalk.gray('в†ђ Back'),
                        hint: 'Change provider',
                    },
                ],
            });

            if (p.isCancel(result) || result === '_back') {
                return '_back';
            }

            return { model: result as string };
        }

        const defaultModel =
            curatedModels.find((m) => m.default) ??
            providerInfo.models.find((m) => m.default) ??
            curatedModels[0] ??
            providerInfo.models[0];
        if (!defaultModel) {
            p.log.warn('No models available for this provider');
            return '_back';
        }

        const curatedOptions = curatedModels
            .slice(0, 8)
            .filter((m) => m.name !== defaultModel.name)
            .map((m) => ({
                value: m.name,
                label: m.displayName || m.name,
            }));

        if (supportsCustomModels(provider)) {
            p.log.info(chalk.gray('Tip: You can add or edit custom models via /model'));

            const manageCustomModels = await p.confirm({
                message: 'Manage custom models now?',
                initialValue: false,
            });

            if (p.isCancel(manageCustomModels)) {
                return '_back';
            }

            if (manageCustomModels) {
                const customModel = await handleCustomModelManagement(provider);
                if (customModel) {
                    return { model: customModel, isCustomSelection: true };
                }
            }
        }

        const result = await p.select({
            message: `Select a model for ${getProviderDisplayName(provider)}`,
            options: [
                {
                    value: defaultModel.name,
                    label: defaultModel.displayName || defaultModel.name,
                    hint: '(recommended)',
                },
                ...curatedOptions,
                {
                    value: '_back' as const,
                    label: chalk.gray('в†ђ Back'),
                    hint: 'Change provider',
                },
            ],
        });

        if (p.isCancel(result) || result === '_back') {
            return '_back';
        }

        return { model: result as string };
    }

    p.log.info(chalk.gray('Press Ctrl+C to go back'));
    const defaultModel = providerInfo?.models?.find((m) => m.default)?.name;
    const model = await p.text({
        message: `Enter model name for ${getProviderDisplayName(provider)}`,
        placeholder: defaultModel || 'e.g., gpt-4-turbo',
        validate: (value) => {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (!trimmed) return 'Model name is required';
            return undefined;
        },
    });

    if (p.isCancel(model)) {
        return '_back';
    }

    return { model: typeof model === 'string' ? model.trim() : '' };
}

async function handleCustomModelManagement(providerOverride?: LLMProvider): Promise<string | null> {
    const models = await loadCustomModels();

    const choices = [
        { value: 'add' as const, label: 'Add custom model' },
        ...(models.length > 0 ? [{ value: 'edit' as const, label: 'Edit custom model' }] : []),
        ...(models.length > 0 ? [{ value: 'delete' as const, label: 'Delete custom model' }] : []),
        { value: 'back' as const, label: 'Back' },
    ];

    const action = await p.select({
        message: 'Custom models',
        options: choices,
    });

    if (p.isCancel(action) || action === 'back') {
        return null;
    }

    if (action === 'add') {
        const created = await runCustomModelWizard(null, providerOverride);
        return created?.name ?? null;
    }

    if (action === 'edit') {
        const selected = await selectCustomModel(models);
        if (!selected) {
            return null;
        }
        const updated = await runCustomModelWizard(selected, providerOverride);
        return updated?.name ?? null;
    }

    if (action === 'delete') {
        const model = await selectCustomModel(models);
        if (!model) {
            return null;
        }
        const confirm = await p.confirm({
            message: `Delete custom model "${model.displayName || model.name}"?`,
            initialValue: false,
        });
        if (p.isCancel(confirm) || !confirm) {
            return null;
        }
        await deleteCustomModel(model.name);
        p.log.success(`Deleted ${model.displayName || model.name}`);
        return null;
    }

    return null;
}

async function selectCustomModel(models: CustomModel[]): Promise<CustomModel | null> {
    if (models.length === 0) {
        p.log.info('No custom models available.');
        return null;
    }

    const selection = await p.select({
        message: 'Select a custom model',
        options: models.map((model) => ({
            value: model.name,
            label: model.displayName || model.name,
        })),
    });

    if (p.isCancel(selection)) {
        return null;
    }

    return models.find((model) => model.name === selection) ?? null;
}

async function runCustomModelWizard(
    initialModel?: CustomModel | null,
    providerOverride?: LLMProvider
): Promise<CustomModel | null> {
    const values = await promptCustomModelValues(initialModel ?? null, providerOverride);
    if (!values) {
        return null;
    }

    const model: CustomModel = {
        name: values.name,
        provider: values.provider,
        ...(values.baseURL ? { baseURL: values.baseURL } : {}),
        ...(values.displayName ? { displayName: values.displayName } : {}),
        ...(values.maxInputTokens ? { maxInputTokens: values.maxInputTokens } : {}),
        ...(values.apiKey ? { apiKey: values.apiKey } : {}),
        ...(values.filePath ? { filePath: values.filePath } : {}),
        ...(values.reasoningPreset ? { reasoning: { variant: values.reasoningPreset } } : {}),
    };

    await saveCustomModel(model);
    if (initialModel && initialModel.name !== model.name) {
        await deleteCustomModel(initialModel.name);
    }
    p.log.success(`${initialModel ? 'Updated' : 'Saved'} ${model.displayName || model.name}`);
    return model;
}

async function promptCustomModelValues(
    initialModel: CustomModel | null,
    providerOverride?: LLMProvider
): Promise<{
    name: string;
    provider: CustomModel['provider'];
    baseURL?: string;
    displayName?: string;
    maxInputTokens?: number;
    apiKey?: string;
    filePath?: string;
    reasoningPreset?: ReasoningVariant;
} | null> {
    const providers = [
        'openai-compatible',
        'openrouter',
        'litellm',
        'glama',
        'bedrock',
        'ollama',
        'local',
        'vertex',
    ] as const;

    const effectiveProvider = initialModel?.provider ?? providerOverride;

    let provider: CustomModel['provider'] | symbol;
    if (effectiveProvider) {
        provider = effectiveProvider as CustomModel['provider'];
    } else {
        provider = (await p.select({
            message: 'Custom model provider',
            options: providers.map((value) => ({ value, label: value })),
            initialValue: 'openai-compatible',
        })) as CustomModel['provider'] | symbol;

        if (p.isCancel(provider)) {
            return null;
        }
    }

    const name = await p.text({
        message: 'Model name',
        initialValue: initialModel?.name ?? '',
        validate: (value) => {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            return trimmed ? undefined : 'Model name is required';
        },
    });

    if (p.isCancel(name)) {
        return null;
    }

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (provider === 'openrouter' || provider === 'glama') {
        const isValidFormat = trimmedName.includes('/');
        if (!isValidFormat) {
            p.log.warn('Model name should include a provider prefix, e.g. anthropic/claude-3.5');
        }
    }

    const displayName = await p.text({
        message: 'Display name (optional)',
        initialValue: initialModel?.displayName ?? '',
    });

    if (p.isCancel(displayName)) {
        return null;
    }

    let baseURL: string | undefined;
    if (provider === 'openai-compatible' || provider === 'litellm') {
        const baseURLInput = await p.text({
            message: 'Base URL',
            initialValue: initialModel?.baseURL?.trim() ?? '',
            validate: (value) => {
                const trimmed = typeof value === 'string' ? value.trim() : '';
                if (!trimmed) return 'Base URL is required';
                try {
                    new URL(trimmed);
                    return undefined;
                } catch {
                    return 'Base URL must be a valid URL';
                }
            },
        });
        if (p.isCancel(baseURLInput)) {
            return null;
        }
        const baseURLValue = typeof baseURLInput === 'string' ? baseURLInput.trim() : '';
        baseURL = baseURLValue || undefined;
    }

    const maxInputTokensInput = await p.text({
        message: 'Max input tokens (optional)',
        initialValue: initialModel?.maxInputTokens?.toString() ?? '',
        validate: (value) => {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (!trimmed) return undefined;
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                return 'Enter a positive integer';
            }
            return undefined;
        },
    });

    if (p.isCancel(maxInputTokensInput)) {
        return null;
    }

    let apiKey: string | undefined;
    if (provider !== 'bedrock' && provider !== 'vertex') {
        const apiKeyInput = await p.text({
            message: 'API key (optional)',
            initialValue: initialModel?.apiKey ?? '',
        });

        if (p.isCancel(apiKeyInput)) {
            return null;
        }

        const apiKeyValue = typeof apiKeyInput === 'string' ? apiKeyInput.trim() : '';
        apiKey = apiKeyValue || undefined;
    }

    let filePath: string | undefined;
    if (provider === 'local') {
        const filePathInput = await p.text({
            message: 'GGUF file path',
            initialValue: initialModel?.filePath ?? '',
            validate: (value) => {
                const trimmed = typeof value === 'string' ? value.trim() : '';
                if (!trimmed) return 'File path is required';
                if (!trimmed.toLowerCase().endsWith('.gguf')) {
                    return 'File path must end with .gguf';
                }
                return undefined;
            },
        });
        if (p.isCancel(filePathInput)) {
            return null;
        }
        const filePathValue = typeof filePathInput === 'string' ? filePathInput.trim() : '';
        filePath = filePathValue || undefined;
    }

    let reasoningPreset: ReasoningVariant | undefined;
    const reasoningSupport = getReasoningProfile(provider, trimmedName);
    if (reasoningSupport.capable) {
        const preset = await selectReasoningVariant(provider, trimmedName);
        if (preset === null) {
            return null;
        }
        if (preset !== reasoningSupport.defaultVariant) {
            reasoningPreset = preset;
        }
    }

    const trimmedDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
    const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const trimmedMaxInputTokens =
        typeof maxInputTokensInput === 'string' ? maxInputTokensInput.trim() : '';

    return {
        name: trimmedName,
        provider,
        ...(baseURL ? { baseURL } : {}),
        ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
        ...(trimmedMaxInputTokens ? { maxInputTokens: Number(trimmedMaxInputTokens) } : {}),
        ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
        ...(filePath ? { filePath } : {}),
        ...(reasoningPreset ? { reasoningPreset } : {}),
    };
}

async function selectDefaultModeWithBack(
    preferredDefaultMode?: CLISetupOptions['defaultMode']
): Promise<'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp' | '_back'> {
    const result = await p.select({
        message: 'How do you want to use Fius by default?',
        options: [
            {
                value: 'cli' as const,
                label: `${chalk.green('в—Џ')} Terminal`,
                hint: 'Chat in your terminal (most popular)',
            },
            {
                value: 'web' as const,
                label: `${chalk.blue('в—Џ')} Browser`,
                hint: 'Web UI at localhost:3000',
            },
            {
                value: 'server' as const,
                label: `${chalk.cyan('в—Џ')} API Server`,
                hint: 'REST API for integrations',
            },
            { value: '_back' as const, label: chalk.gray('в†ђ Back'), hint: 'Go to previous step' },
        ],
        ...(preferredDefaultMode ? { initialValue: preferredDefaultMode } : {}),
    });

    if (p.isCancel(result)) {
        return '_back';
    }

    return result as 'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp' | '_back';
}

async function saveWizardPreferences(state: SetupWizardState): Promise<void> {
    const provider = state.provider!;
    const model = state.model!;
    const defaultMode = state.defaultMode!;
    const apiKeySkipped = state.apiKeySkipped || false;

    const needsApiKey = requiresApiKey(provider);
    const apiKeyVar = getProviderEnvVar(provider);

    if (provider === 'local') {
        await setActiveModel(model);
    }

    const preferencesOptions: CreatePreferencesOptions = {
        provider,
        model,
        defaultMode,
        setupCompleted: true,
        apiKeyPending: apiKeySkipped,
    };

    if (needsApiKey && !apiKeySkipped && hasApiKeyConfigured(provider)) {
        preferencesOptions.apiKeyVar = apiKeyVar;
    }
    if (state.baseURL) {
        preferencesOptions.baseURL = state.baseURL;
    }
    if (state.reasoningPreset) {
        preferencesOptions.reasoning = { variant: state.reasoningPreset };
    }

    const preferences = createInitialPreferences(preferencesOptions);
    await saveGlobalPreferences(preferences);

    capture('fius_setup', {
        provider,
        model,
        setupMode: 'interactive',
        setupVariant: 'custom',
        defaultMode,
        hasBaseURL: Boolean(state.baseURL),
        apiKeySkipped,
    });

    await showSetupComplete(provider, model, defaultMode, apiKeySkipped);
}

async function handleNonInteractiveSetup(options: CLISetupOptions): Promise<void> {
    const provider = options.provider!;
    const model = options.model || getDefaultModel(provider);

    if (!model) {
        console.error(chalk.red(`вќЊ Model is required for provider '${provider}'.`));
        console.error(chalk.gray(`   Use --model option to specify a model.`));
        process.exit(1);
    }

    const apiKeyVar = getProviderEnvVar(provider);
    const hadApiKeyBefore = Boolean(resolveApiKeyForProvider(provider));

    const preferencesOptions: {
        provider: NonNullable<CLISetupOptions['provider']>;
        model: string;
        apiKeyVar: string;
        defaultAgent: string;
        setupCompleted: true;
        defaultMode?: NonNullable<CLISetupOptions['defaultMode']>;
    } = {
        provider,
        model,
        apiKeyVar,
        defaultAgent: options.defaultAgent,
        setupCompleted: true,
    };
    if (options.defaultMode) {
        preferencesOptions.defaultMode = options.defaultMode;
    }

    const preferences = createInitialPreferences(preferencesOptions);

    await saveGlobalPreferences(preferences);

    if (provider === 'local') {
        await setActiveModel(model);
    }

    capture('fius_setup', {
        provider,
        model,
        hadApiKeyBefore,
        setupMode: 'non-interactive',
    });

    console.log(chalk.green('\nвњЁ Setup complete! Fius is ready to use.\n'));
}

async function showSettingsMenu(): Promise<void> {
    p.intro(chalk.cyan('вљ™пёЏ  Fius Settings'));

    while (true) {
        let currentPrefs;
        try {
            currentPrefs = await loadGlobalPreferences();
        } catch {
            currentPrefs = null;
        }

        if (!currentPrefs && !globalPreferencesExist()) {
            p.log.warn('No preferences found yet. Run setup to create them.');
            await handleInteractiveSetup({
                interactive: true,
                force: false,
                quickStart: false,
                defaultAgent: 'fius',
            });
            return;
        }

        if (currentPrefs) {
            const currentConfig = [
                `Provider: ${chalk.cyan(getProviderDisplayName(currentPrefs.llm.provider))}`,
                `Model: ${chalk.cyan(currentPrefs.llm.model)}`,
                `Default Mode: ${chalk.cyan(currentPrefs.defaults.defaultMode)}`,
                ...(currentPrefs.llm.baseURL
                    ? [`Base URL: ${chalk.cyan(currentPrefs.llm.baseURL)}`]
                    : []),
                ...(currentPrefs.llm.reasoning
                    ? [
                          `Reasoning Variant: ${chalk.cyan(currentPrefs.llm.reasoning.variant)}` +
                              (currentPrefs.llm.reasoning.budgetTokens != null
                                  ? ` (budgetTokens=${chalk.cyan(String(currentPrefs.llm.reasoning.budgetTokens))})`
                                  : ''),
                      ]
                    : []),
            ].join('\n');

            p.note(currentConfig, 'Current Configuration');
        }

        const currentProviderLabel = currentPrefs
            ? getProviderDisplayName(currentPrefs.llm.provider)
            : 'not set';
        const currentModelLabel = currentPrefs?.llm.model || 'not set';

        const options: Array<{ value: string; label: string; hint: string }> = [
            {
                value: 'model',
                label: 'Change model',
                hint: `Currently: ${currentProviderLabel} / ${currentModelLabel}`,
            },
            {
                value: 'mode',
                label: 'Change default mode',
                hint: `Currently: ${currentPrefs?.defaults.defaultMode || 'cli'}`,
            },
            {
                value: 'auth',
                label: 'Update API key',
                hint: 'Re-enter your API key',
            },
            {
                value: 'reset',
                label: 'Reset to defaults',
                hint: 'Start fresh with a new configuration',
            },
            {
                value: 'file',
                label: 'View preferences file',
                hint: 'See where your settings are stored',
            },
            {
                value: 'exit',
                label: 'Exit',
                hint: 'Done making changes',
            },
        ];

        const action = await p.select({
            message: 'What would you like to do?',
            options,
        });

        if (p.isCancel(action) || action === 'exit') {
            p.outro(`Run ${chalk.cyan('fius')} to start Fius`);
            return;
        }

        switch (action) {
            case 'model':
                await changeModel();
                break;
            case 'mode':
                await changeDefaultMode();
                break;
            case 'credits':
                await openCreditsPage();
                break;
            case 'auth':
                await updateApiKey(currentPrefs?.llm.provider);
                break;
            case 'reset': {
                const resetCompleted = await resetSetup();
                if (resetCompleted) {
                    return;
                }
                break;
            }
            case 'file':
                showPreferencesFilePath();
                break;
        }

        console.log('');
    }
}

async function changeModel(currentProvider?: LLMProvider): Promise<void> {
    let provider: LLMProvider | null | '_back' = currentProvider ?? null;

    if (!provider) {
        const sourceOptions: Array<{ value: string; label: string; hint: string }> = [];

        sourceOptions.push({
            value: 'other',
            label: `${chalk.blue('в—Џ')} Other providers`,
            hint: 'OpenAI, Anthropic, Gemini, Ollama, etc.',
        });

        const providerChoice = await p.select({
            message: 'Choose your model source',
            options: sourceOptions,
        });

        if (p.isCancel(providerChoice)) {
            p.log.warn('Model change cancelled');
            return;
        }

    }

    if (!provider) {
        provider = await selectProvider();
    }

    if (provider === null || provider === '_back') {
        p.log.warn('Model change cancelled');
        return;
    }

    if (provider === 'local') {
        const localResult = await setupLocalModels();
        if (!hasSelectedModel(localResult)) {
            p.log.warn('Model change cancelled');
            return;
        }
        const model = getModelFromResult(localResult);
        const llmUpdate: {
            provider: LLMProvider;
            model: string;
            reasoning?: { variant: ReasoningVariant };
        } = {
            provider,
            model,
        };

        if (getReasoningProfile(provider, model).capable) {
            const reasoningPreset = await selectReasoningVariant(provider, model);
            if (reasoningPreset === null) {
                p.log.warn('Model change cancelled');
                return;
            }
            const defaultReasoningVariant = getReasoningProfile(provider, model).defaultVariant;
            if (reasoningPreset !== defaultReasoningVariant) {
                llmUpdate.reasoning = { variant: reasoningPreset };
            }
        }

        await updateGlobalPreferences({ llm: llmUpdate });
        p.log.success(`Model changed to ${model}`);
        return;
    }

    if (provider === 'ollama') {
        const ollamaResult = await setupOllamaModels();
        if (!hasSelectedModel(ollamaResult)) {
            p.log.warn('Model change cancelled');
            return;
        }
        const model = getModelFromResult(ollamaResult);
        const llmUpdate: {
            provider: LLMProvider;
            model: string;
            reasoning?: { variant: ReasoningVariant };
        } = {
            provider,
            model,
        };

        if (getReasoningProfile(provider, model).capable) {
            const reasoningPreset = await selectReasoningVariant(provider, model);
            if (reasoningPreset === null) {
                p.log.warn('Model change cancelled');
                return;
            }
            const defaultReasoningVariant = getReasoningProfile(provider, model).defaultVariant;
            if (reasoningPreset !== defaultReasoningVariant) {
                llmUpdate.reasoning = { variant: reasoningPreset };
            }
        }

        await updateGlobalPreferences({ llm: llmUpdate });
        p.log.success(`Model changed to ${model}`);
        return;
    }

    const model = await selectModel(provider);

    if (model === null) {
        p.log.warn('Model change cancelled');
        return;
    }

    const apiKeyVar = getProviderEnvVar(provider);
    const needsApiKey = requiresApiKey(provider);
    const hasKey = hasApiKeyConfigured(provider) || hasUsableModelAuthProfile(provider);

    if (needsApiKey && !hasKey) {
        const result = await interactiveApiKeySetup(provider, {
            exitOnCancel: false,
            model,
        });

        if (result.cancelled) {
            p.log.warn('Model change cancelled');
            return;
        }

        if (result.skipped || !result.success) {
            p.log.warn(
                `API key setup was skipped. You'll need to configure ${apiKeyVar} before using this model.`
            );
        }
    }

    const llmUpdate: {
        provider: LLMProvider;
        model: string;
        apiKey?: string;
        reasoning?: { variant: ReasoningVariant };
    } = {
        provider,
        model,
    };
    if (needsApiKey && hasApiKeyConfigured(provider)) {
        llmUpdate.apiKey = `$${apiKeyVar}`;
    }

        if (getReasoningProfile(provider, model).capable) {
        const reasoningPreset = await selectReasoningVariant(provider, model);
        if (reasoningPreset === null) {
            p.log.warn('Model change cancelled');
            return;
        }
        const defaultReasoningVariant = getReasoningProfile(provider, model).defaultVariant;
        if (reasoningPreset !== defaultReasoningVariant) {
            llmUpdate.reasoning = { variant: reasoningPreset };
        }
    }

    await updateGlobalPreferences({ llm: llmUpdate });

    p.log.success(`Model changed to ${model}`);
}

async function changeDefaultMode(): Promise<void> {
    const mode = await selectDefaultMode();

    if (mode === null) {
        p.log.warn('Mode change cancelled');
        return;
    }

    await updateGlobalPreferences({
        defaults: { defaultMode: mode },
    });

    p.log.success(`Default mode changed to ${mode}`);
}

async function updateApiKey(currentProvider?: LLMProvider): Promise<void> {
    const provider = currentProvider || (await selectProvider());

    if (provider === null || provider === '_back') {
        p.log.warn('API key update cancelled');
        return;
    }

    if (provider === 'vertex') {
        p.note(
            `Google Vertex AI uses Application Default Credentials (ADC).\n\n` +
                `To authenticate:\n` +
                `  1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install\n` +
                `  2. Run: gcloud auth application-default login\n` +
                `  3. Set GOOGLE_VERTEX_PROJECT environment variable`,
            'Google Cloud Authentication'
        );
        return;
    }

    if (provider === 'bedrock') {
        p.note(
            `Amazon Bedrock uses AWS credentials.\n\n` +
                `To authenticate, set these environment variables:\n` +
                `  вЂў AWS_REGION (required)\n` +
                `  вЂў AWS_ACCESS_KEY_ID (required)\n` +
                `  вЂў AWS_SECRET_ACCESS_KEY (required)\n` +
                `  вЂў AWS_SESSION_TOKEN (optional, for temporary credentials)`,
            'AWS Authentication'
        );
        return;
    }

    if (provider === 'openai-compatible' || provider === 'litellm') {
        const wantsKey = await p.confirm({
            message: `API key is optional for ${getProviderDisplayName(provider)}. Set one anyway?`,
            initialValue: true,
        });

        if (p.isCancel(wantsKey) || !wantsKey) {
            p.log.info('Skipped API key setup');
            return;
        }
    }

    const result = await interactiveApiKeySetup(provider, {
        exitOnCancel: false,
        skipVerification: false,
    });

    if (result.success) {
        p.log.success(`API key updated for ${getProviderDisplayName(provider)}`);
    } else {
        p.log.warn('API key update cancelled');
    }
}

async function resetSetup(): Promise<boolean> {
    const confirm = await p.confirm({
        message: 'This will erase your current configuration. Continue?',
        initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) {
        p.log.info('Reset cancelled');
        return false;
    }

    await handleInteractiveSetup({
        interactive: true,
        force: true,
        defaultAgent: 'fius',
        quickStart: false,
    });

    return true;
}

function showPreferencesFilePath(): void {
    const prefsPath = getGlobalPreferencesPath();

    p.note(
        [
            `Your preferences are stored at:`,
            ``,
            `  ${chalk.cyan(prefsPath)}`,
            ``,
            `You can edit this file directly with any text editor.`,
            `Changes take effect on the next run of fius.`,
            ``,
            chalk.gray('Example commands:'),
            chalk.gray(`  code ${prefsPath}     # Open in VS Code`),
            chalk.gray(`  nano ${prefsPath}     # Edit in terminal`),
            chalk.gray(`  cat ${prefsPath}      # View contents`),
        ].join('\n'),
        'Preferences File Location'
    );
}

async function selectDefaultMode(
    preferredDefaultMode?: CLISetupOptions['defaultMode']
): Promise<'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp' | null> {
    const mode = await p.select({
        message: 'How do you want to use Fius by default?',
        options: [
            {
                value: 'cli' as const,
                label: `${chalk.green('в—Џ')} Terminal`,
                hint: 'Chat in your terminal (most popular)',
            },
            {
                value: 'web' as const,
                label: `${chalk.blue('в—Џ')} Browser`,
                hint: 'Web UI at localhost:3000',
            },
            {
                value: 'server' as const,
                label: `${chalk.cyan('в—Џ')} API Server`,
                hint: 'REST API for integrations',
            },
        ],
        ...(preferredDefaultMode ? { initialValue: preferredDefaultMode } : {}),
    });

    if (p.isCancel(mode)) {
        return null;
    }

    return mode;
}

async function selectReasoningVariant(
    provider: LLMProvider,
    model: string
): Promise<ReasoningVariant | null> {
    const support = getReasoningProfile(provider, model);
    const initialValue = support.defaultVariant ?? support.supportedVariants[0];
    const variant = await p.select({
        message: 'Select reasoning variant',
        options: getReasoningVariantSelectOptions(
            support.supportedVariants,
            support.defaultVariant
        ),
        ...(initialValue ? { initialValue } : {}),
    });

    if (p.isCancel(variant)) {
        return null;
    }

    return variant;
}

async function selectModel(provider: LLMProvider): Promise<string | null> {
    const providerInfo = LLM_REGISTRY[provider];

    if (providerInfo?.models && providerInfo.models.length > 0) {
        const curatedModels = getCuratedModelsForProvider(provider);

        if (provider === 'openrouter') {
            const curatedOptions = curatedModels
                .slice(0, 8)
                .filter((m) => m.name !== 'openrouter/free')
                .map((m) => ({
                    value: m.name,
                    label: m.displayName || m.name,
                }));

            if (supportsCustomModels(provider)) {
                p.log.info(chalk.gray('Tip: You can add or edit custom models via /models'));

                const manageCustomModels = await p.confirm({
                    message: 'Manage custom models now?',
                    initialValue: false,
                });

                if (p.isCancel(manageCustomModels)) {
                    return null;
                }

                if (manageCustomModels) {
                    const customModel = await handleCustomModelManagement(provider);
                    if (customModel) {
                        return customModel;
                    }
                }
            }

            const selected = await p.select({
                message: `Select a model for ${getProviderDisplayName(provider)}`,
                options: [
                    {
                        value: 'openrouter/free' as const,
                        label: 'OpenRouter Free Models',
                        hint: '(recommended)',
                    },
                    ...curatedOptions,
                ],
                initialValue: 'openrouter/free',
            });

            if (p.isCancel(selected)) {
                return null;
            }

            return selected as string;
        }

        const defaultModel =
            curatedModels.find((m) => m.default) ??
            providerInfo.models.find((m) => m.default) ??
            curatedModels[0] ??
            providerInfo.models[0];
        if (!defaultModel) {
            return null;
        }

        const curatedOptions = curatedModels
            .slice(0, 8)
            .filter((m) => m.name !== defaultModel.name)
            .map((m) => ({
                value: m.name,
                label: m.displayName || m.name,
            }));

        if (supportsCustomModels(provider)) {
            p.log.info(chalk.gray('Tip: You can add or edit custom models via /model'));

            const manageCustomModels = await p.confirm({
                message: 'Manage custom models now?',
                initialValue: false,
            });

            if (p.isCancel(manageCustomModels)) {
                return null;
            }

            if (manageCustomModels) {
                const customModel = await handleCustomModelManagement(provider);
                if (customModel) {
                    return customModel;
                }
            }
        }

        const selected = await p.select({
            message: `Select a model for ${getProviderDisplayName(provider)}`,
            options: [
                {
                    value: defaultModel.name,
                    label: defaultModel.displayName || defaultModel.name,
                    hint: '(recommended)',
                },
                ...curatedOptions,
            ],
            initialValue: defaultModel.name,
        });

        if (p.isCancel(selected)) {
            return null;
        }

        return selected as string;
    }

    const modelInput = await p.text({
        message: `Enter model name for ${getProviderDisplayName(provider)}`,
        placeholder:
            provider === 'openrouter' ? 'e.g., anthropic/claude-3.5-sonnet' : 'e.g., llama-3-70b',
        validate: (value) => {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (!trimmed) {
                return 'Model name is required';
            }
            return undefined;
        },
    });

    if (p.isCancel(modelInput)) {
        return null;
    }

    if (typeof modelInput !== 'string') {
        return null;
    }

    return modelInput.trim();
}

async function promptForBaseURL(provider: LLMProvider): Promise<string | null> {
    p.log.info(chalk.gray('Press Ctrl+C to go back'));

    const placeholder =
        provider === 'openai-compatible'
            ? 'http://localhost:11434/v1'
            : provider === 'litellm'
              ? 'http://localhost:4000'
              : 'https://your-api-endpoint.com/v1';

    const baseURL = await p.text({
        message: `Enter base URL for ${getProviderDisplayName(provider)}`,
        placeholder,
        validate: (value) => {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (!trimmed) {
                return 'Base URL is required for this provider';
            }
            try {
                new URL(trimmed);
            } catch {
                return 'Please enter a valid URL';
            }
            return undefined;
        },
    });

    if (p.isCancel(baseURL)) {
        return null;
    }

    return typeof baseURL === 'string' ? baseURL.trim() : '';
}

async function showSetupComplete(
    provider: LLMProvider,
    model: string,
    defaultMode: string,
    apiKeySkipped: boolean = false,
    options: {
        providerLabel?: string;
        authLabel?: string;
        baseURL?: string;
    } = {}
): Promise<void> {
        const modeCommand = defaultMode === 'web' ? 'fius' : `fius --mode ${defaultMode}`;
    const isLocalProvider = provider === 'local' || provider === 'ollama';
    const providerLabel = options.providerLabel ?? getProviderDisplayName(provider);

    if (apiKeySkipped) {
        console.log(chalk.rgb(255, 165, 0)('\nвљ пёЏ  Setup complete (API key pending)\n'));
    } else {
        console.log(chalk.green('\nвњ“ Logged in successfully! Fius is ready.\n'));
    }

    const summary = [
        `${chalk.bold('Configuration:')}`,
        `  Provider: ${chalk.cyan(providerLabel)}`,
        `  Model: ${chalk.cyan(model)}`,
        `  Mode: ${chalk.cyan(defaultMode)}`,
        ...(options.authLabel ? [`  Authentication: ${chalk.cyan(options.authLabel)}`] : []),
        ...(options.baseURL ? [`  Base URL: ${chalk.cyan(options.baseURL)}`] : []),
        ...(apiKeySkipped
            ? [
                  `  API Key: ${chalk.rgb(255, 165, 0)('Not configured')}`,
                  ``,
                  `${chalk.bold('To complete setup:')}`,
                  `  Run ${chalk.cyan('fius setup')} to add your API key`,
                  `  Or set ${chalk.cyan(getProviderEnvVar(provider))} in your environment`,
              ]
            : []),
        ``,
        `${chalk.bold('Next steps:')}`,
        `  Run ${chalk.cyan(modeCommand)} to start`,
        `  Run ${chalk.cyan('fius setup')} to change settings`,
        ...(isLocalProvider
            ? [`  Run ${chalk.cyan('fius setup')} again to manage local models`]
            : []),
        `  In the interactive CLI, run ${chalk.cyan('/models')} to switch models`,
        `  Run ${chalk.cyan('fius --help')} for more options`,
    ].join('\n');

    console.log(summary);
    console.log('');
}