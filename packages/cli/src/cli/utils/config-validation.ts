import { z } from 'zod';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    AgentConfigSchema,
    type AgentConfig,
    type ValidatedAgentConfig,
} from '@fiusdev/agent-config';
import { getPrimaryApiKeyEnvVar, resolveApiKeyForProvider } from '@fiusdev/agent-management';
import { requiresApiKey, requiresBaseURL } from '@fiusdev/llm';
import { logger } from '@fiusdev/core';
import { getGlobalPreferencesPath } from '@fiusdev/agent-management';
import {
    getBundledSyncTargetForAgentPath,
    handleSyncAgentsCommand,
} from '../commands/agents/sync.js';

export interface ValidationResult {
    success: boolean;
    config?: ValidatedAgentConfig;
    errors?: string[];
    warnings?: string[];
    skipped?: boolean;
}

export interface ValidationOptions {
    agentPath?: string;
    credentialPolicy?: 'warn' | 'error' | 'ignore';
}

export async function validateAgentConfig(
    config: AgentConfig,
    interactive: boolean = false,
    options?: ValidationOptions
): Promise<ValidationResult> {
    const parseResult = AgentConfigSchema.safeParse(config);

    if (parseResult.success) {
        return { success: true, config: parseResult.data, warnings: [] };
    }

    logger.debug(`Agent config validation error: ${JSON.stringify(parseResult.error)}`);
    const errors = formatZodErrors(parseResult.error);

    if (!interactive) {
        showValidationErrors(errors);
        showNextSteps();
        return { success: false, errors };
    }

    return await handleOtherErrors(errors, options);
}

async function handleOtherErrors(
    errors: string[],
    options?: ValidationOptions
): Promise<ValidationResult> {
    const syncTarget = options?.agentPath
        ? getBundledSyncTargetForAgentPath(options.agentPath)
        : null;

    console.log(chalk.rgb(255, 165, 0)('\nвљ пёЏ  Configuration issues detected:\n'));
    for (const error of errors) {
        console.log(chalk.red(`  вЂў ${error}`));
    }
    console.log('');

    const selectOptions = [
        ...(syncTarget
            ? [
                  {
                      value: 'sync' as const,
                      label: 'Sync agent config',
                      hint: `Update bundled agent '${syncTarget.agentId}' from the registry`,
                  },
              ]
            : []),
        {
            value: 'skip' as const,
            label: 'Continue anyway',
            hint: 'Try to start despite errors (may fail)',
        },
        {
            value: 'edit' as const,
            label: 'Edit configuration manually',
            hint: 'Show file path and instructions',
        },
    ];

    const action = await p.select({
        message: 'How would you like to proceed?',
        options: selectOptions,
    });

    if (p.isCancel(action)) {
        showNextSteps();
        return { success: false, errors, skipped: true };
    }

    if (action === 'sync') {
        if (!syncTarget) {
            return { success: false, errors, skipped: true };
        }

        try {
            await handleSyncAgentsCommand({
                force: true,
                quiet: false,
                agentIds: [syncTarget.agentId],
            });
            p.outro(chalk.gray('Run fius to start Fius'));
            process.exit(0);
        } catch (error) {
            p.log.error(
                `Failed to sync agent: ${error instanceof Error ? error.message : String(error)}`
            );
            return { success: false, errors, skipped: true };
        }
    }

    if (action === 'edit') {
        showManualEditInstructions(options?.agentPath);
        return { success: false, errors, skipped: true };
    }

    p.log.warn('Continuing with validation errors - some features may not work correctly');
    return { success: false, errors, skipped: true };
}

function showValidationErrors(errors: string[]): void {
    console.log(chalk.rgb(255, 165, 0)('\nвљ пёЏ  Configuration issues detected:\n'));
    for (const error of errors) {
        console.log(chalk.red(`  вЂў ${error}`));
    }
    console.log('');
}

function showNextSteps(): void {
    const prefsPath = getGlobalPreferencesPath();
    console.log(chalk.bold('\nNext steps:'));
    console.log(`  вЂў Run ${chalk.cyan('fius setup')} to reconfigure interactively`);
    console.log(`  вЂў Edit ${chalk.cyan(prefsPath)} directly`);
    console.log(`  вЂў Check your environment variables\n`);
}

function showManualEditInstructions(agentPath?: string): void {
    const prefsPath = getGlobalPreferencesPath();
    const configPaths = [`  ${chalk.cyan('Global preferences:')} ${prefsPath}`];

    if (agentPath) {
        configPaths.push(`  ${chalk.cyan('Agent config:')} ${agentPath}`);
    } else {
        configPaths.push(`  ${chalk.cyan('Agent configs:')} ~/.fius/agents/*/`);
    }

    p.note(
        [
            `Your configuration files:`,
            ``,
            ...configPaths,
            ``,
            `Edit the appropriate file and run fius again.`,
            ``,
            chalk.gray('Example commands:'),
            ...(agentPath
                ? [
                      chalk.gray(`  code ${agentPath}     # Open in VS Code`),
                      chalk.gray(`  nano ${agentPath}     # Edit in terminal`),
                  ]
                : [
                      chalk.gray(`  code ${prefsPath}     # Open in VS Code`),
                      chalk.gray(`  nano ${prefsPath}     # Edit in terminal`),
                  ]),
        ].join('\n'),
        'Manual Configuration'
    );
}

function formatZodErrors(error: z.ZodError): string[] {
    return error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
        return `${path}: ${issue.message}`;
    });
}

