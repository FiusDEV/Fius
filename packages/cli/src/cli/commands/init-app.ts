import * as p from '@clack/prompts';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import fsExtra from 'fs-extra';
import path from 'node:path';
import { getPackageManager, getPackageManagerInstallCommand } from '../utils/package-mgmt.js';
import { executeWithTimeout } from '../utils/execute.js';
import { type LLMProvider, getDefaultModelForProvider } from '@fiusdev/llm';
import { saveProviderApiKey } from '@fiusdev/agent-management';
import {
    getProviderDisplayName,
    validateApiKeyFormat,
    PROVIDER_OPTIONS,
} from '../utils/provider-setup.js';
import { generateIndexForCodeFirstDI } from '../utils/template-engine.js';

function debug(message: string): void {
    if (process.env.FIUS_DEBUG_INIT === 'true' || process.env.FIUS_DEBUG_ALL === 'true') {
        console.error(`[fius:init] ${message}`);
    }
}

export async function getUserInputToInitFiusApp(): Promise<{
    llmProvider: LLMProvider;
    llmApiKey: string;
    directory: string;
    createExampleFile: boolean;
}> {
    const answers = await p.group(
        {
            llmProvider: () =>
                p.select({
                    message: 'Choose your AI provider',
                    options: PROVIDER_OPTIONS,
                }),
            llmApiKey: async ({ results }) => {
                const llmProvider = String(results.llmProvider ?? 'openai-compatible');
                const selection = await p.select({
                    message: `Enter your API key for ${getProviderDisplayName(llmProvider)}?`,
                    options: [
                        { value: 'enter', label: 'Enter', hint: 'recommended' },
                        { value: 'skip', label: 'Skip', hint: '' },
                    ],
                    initialValue: 'enter',
                });

                if (p.isCancel(selection)) {
                    p.cancel('Fius initialization cancelled');
                    process.exit(0);
                }

                if (selection === 'enter') {
                    const apiKey = await p.password({
                        message: `Enter your ${getProviderDisplayName(llmProvider)} API key`,
                        mask: '*',
                        validate: (value) => {
                            if (!value || value.trim().length === 0) {
                                return 'API key is required';
                            }
                            if (!validateApiKeyFormat(llmProvider, value.trim())) {
                                return `Invalid ${getProviderDisplayName(llmProvider)} API key format`;
                            }
                            return undefined;
                        },
                    });

                    if (p.isCancel(apiKey)) {
                        p.cancel('Fius initialization cancelled');
                        process.exit(0);
                    }

                    return apiKey;
                }
                return '';
            },
            directory: () =>
                p.text({
                    message: 'Enter the directory to add the fius files in',
                    placeholder: 'src/',
                    defaultValue: 'src/',
                }),
            createExampleFile: () =>
                p.confirm({
                    message: 'Create a fius example file? [Recommended]',
                    initialValue: true,
                }),
        },
        {
            onCancel: () => {
                p.cancel('Fius initialization cancelled');
                process.exit(0);
            },
        }
    );

    return answers as {
        llmProvider: LLMProvider;
        directory: string;
        llmApiKey: string;
        createExampleFile: boolean;
    };
}

export async function initFius(
    directory: string,
    createExampleFile = true,
    llmProvider?: LLMProvider,
    llmApiKey?: string
): Promise<void> {
    const spinner = p.spinner();

    try {
        const packageManager = getPackageManager();
        const installCommand = getPackageManagerInstallCommand(packageManager);
        spinner.start('Installing Fius...');
        const label = 'latest';
        debug(
            `Installing Fius using ${packageManager} with install command: ${installCommand} and label: ${label}`
        );
        try {
            await executeWithTimeout(
                packageManager,
                [
                    installCommand,
                    `@fiusdev/core@${label}`,
                    `@fiusdev/storage@${label}`,
                    'dotenv',
                    'tsx',
                ],
                { cwd: process.cwd() }
            );
        } catch (installError) {
            console.error(
                `Install error: ${
                    installError instanceof Error ? installError.message : String(installError)
                }`
            );
            if (
                packageManager === 'pnpm' &&
                installError instanceof Error &&
                /\bERR_PNPM_ADDING_TO_ROOT\b/.test(installError.message)
            ) {
                spinner.stop(chalk.red('Error: Cannot install in pnpm workspace root'));
                p.note(
                    'You are initializing fius in a pnpm workspace root. Go to a specific workspace package and run "pnpm add @fiusdev/core" there.',
                    chalk.rgb(255, 165, 0)('Workspace Error')
                );
                process.exit(1);
            }
            throw installError;
        }

        spinner.stop('Fius installed successfully!');

        spinner.start('Creating Fius files...');
        const result = await createFiusDirectories(directory);

        if (!result.ok) {
            spinner.stop(
                chalk.inverse(
                    `Fius already initialized in ${path.join(directory, 'fius')}. Would you like to overwrite it?`
                )
            );
            const overwrite = await p.confirm({
                message: 'Overwrite Fius?',
                initialValue: false,
            });

            if (p.isCancel(overwrite) || !overwrite) {
                p.cancel('Fius initialization cancelled');
                process.exit(1);
            }
        }

        const fiusDir = path.join(directory, 'fius');

        if (createExampleFile) {
            debug('Creating fius example file...');
            await createFiusExampleFile(fiusDir, { llmProvider });
            debug('Fius example file created successfully!');
        }


        spinner.start('Saving API key to .env file...');
        debug(`Saving API key: provider=${llmProvider ?? 'none'}, hasApiKey=${Boolean(llmApiKey)}`);
        if (llmProvider && llmApiKey) {
            await saveProviderApiKey(llmProvider, llmApiKey, process.cwd());
        }
        spinner.stop('Saved .env updates');
    } catch (err) {
        spinner.stop(chalk.inverse(`An error occurred initializing Fius project - ${err}`));
        debug(`Error: ${String(err)}`);
        process.exit(1);
    }
}

export async function postInitFius(directory: string) {
    const nextSteps = [
        `1. Run the example: ${chalk.cyan(`npx tsx ${path.join(directory, 'fius', 'fius-example.ts')}`)}`,
        `2. Add/update your API key(s) in ${chalk.cyan('.env')}`,
        `3. Customize the agent in ${chalk.cyan(path.join(directory, 'fius', 'fius-example.ts'))}`,
        `4. Read more about Fius: ${chalk.cyan('https://github.com/your-repo/fius')}`,
    ].join('\n');
    p.note(nextSteps, chalk.rgb(255, 165, 0)('Next steps:'));
}
export async function createFiusDirectories(
    directory: string
): Promise<{ ok: true; dirPath: string } | { ok: false }> {
    const dirPath = path.join(directory, 'fius');

    try {
        await fs.access(dirPath);
        return { ok: false };
    } catch {

        await fsExtra.ensureDir(dirPath);
        return { ok: true, dirPath };
    }
}

export async function createFiusExampleFile(
    directory: string,
    options?: { llmProvider?: LLMProvider | undefined } | undefined
): Promise<string> {
    const provider = options?.llmProvider ?? 'openai';
    const model = getDefaultModelForProvider(provider) ?? 'gpt-4o';

    const indexTsContent = generateIndexForCodeFirstDI({
        projectName: 'fius-example',
        packageName: 'fius-example',
        description: 'Fius example',
        llmProvider: provider,
        llmModel: model,
    });
    const outputPath = path.join(directory, 'fius-example.ts');


    await fs.writeFile(outputPath, indexTsContent);
    return outputPath;
}