
import { existsSync, statSync } from 'fs';
import path from 'path';
import { z } from 'zod';
import * as p from '@clack/prompts';
import { getFiusGlobalPath, loadBundledRegistryAgents } from '@fiusdev/agent-management';
import { textOrExit } from '../../utils/prompt-helpers.js';
import { installBundledAgent, installCustomAgent } from '../../../utils/agent-helpers.js';
import { capture } from '../../../analytics/index.js';


const InstallCommandSchema = z
    .object({
        agents: z.array(z.string().min(1, 'Agent name cannot be empty')),
        all: z.boolean().default(false),
        force: z.boolean().default(false),
    })
    .strict();

export type InstallCommandOptions = z.output<typeof InstallCommandSchema>;

function isFilePath(input: string): boolean {
    return (
        input.includes('/') ||
        input.includes('\\') ||
        input.endsWith('.yml') ||
        input.endsWith('.yaml')
    );
}

function extractAgentNameFromPath(filePath: string): string {
    const basename = path.basename(filePath);


    let name = basename;
    if (basename.endsWith('.yml') || basename.endsWith('.yaml')) {
        name = basename.replace(/\.(yml|yaml)$/, '');
    }


    name = name
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    return name;
}

async function promptForMetadata(suggestedName: string): Promise<{
    agentName: string;
    description: string;
    author: string;
    tags: string[];
}> {
    p.intro('рџ“ќ Custom Agent Installation');

    const agentName = await textOrExit(
        {
            message: 'Agent name:',
            placeholder: suggestedName,
            defaultValue: suggestedName,
            validate: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Agent name is required';
                }
                if (!/^[a-z0-9-]+$/.test(value)) {
                    return 'Agent name must contain only lowercase letters, numbers, and hyphens';
                }
                return undefined;
            },
        },
        'Installation cancelled'
    );

    const description = await textOrExit(
        {
            message: 'Description:',
            placeholder: 'A custom agent for...',
            validate: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Description is required';
                }
                return undefined;
            },
        },
        'Installation cancelled'
    );

    const author = await textOrExit(
        {
            message: 'Author:',
            placeholder: 'Your Name',
            validate: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Author is required';
                }
                return undefined;
            },
        },
        'Installation cancelled'
    );

    const tagsInput = await textOrExit(
        {
            message: 'Tags (comma-separated):',
            placeholder: 'custom, coding, productivity',
            defaultValue: 'custom',
        },
        'Installation cancelled'
    );

    const tags = tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);




    return { agentName, description, author, tags };
}

function validateInstallCommand(
    agents: string[],
    options: Partial<InstallCommandOptions>
): InstallCommandOptions {

    const validated = InstallCommandSchema.parse({
        ...options,
        agents,
    });


    const availableAgents = loadBundledRegistryAgents();
    if (!validated.all && validated.agents.length === 0) {
        throw new Error(
            `No agents specified. Use agent names or --all flag.  Available agents: ${Object.keys(availableAgents).join(', ')}`
        );
    }

    if (!validated.all) {

        const filePaths = validated.agents.filter(isFilePath);
        const registryNames = validated.agents.filter((agent) => !isFilePath(agent));


        const invalidAgents = registryNames.filter((agent) => !(agent in availableAgents));
        if (invalidAgents.length > 0) {
            throw new Error(
                `Unknown agents: ${invalidAgents.join(', ')}. ` +
                    `Available agents: ${Object.keys(availableAgents).join(', ')}`
            );
        }


        for (const filePath of filePaths) {
            const resolved = path.resolve(filePath);
            if (!existsSync(resolved)) {
                throw new Error(`File not found: ${filePath}`);
            }
        }
    }

    return validated;
}


export async function handleInstallCommand(
    agents: string[],
    options: Partial<InstallCommandOptions>
): Promise<void> {

    const validated = validateInstallCommand(agents, options);


    let agentsToInstall: string[];
    if (validated.all) {

        const availableAgents = loadBundledRegistryAgents();
        agentsToInstall = Object.keys(availableAgents);
        console.log(`рџ“‹ Installing all ${agentsToInstall.length} available agents...`);
    } else {
        agentsToInstall = validated.agents;
    }

    console.log(`рџљЂ Installing ${agentsToInstall.length} agents...`);

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    const installed: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];


    for (const agentInput of agentsToInstall) {
        try {

            if (isFilePath(agentInput)) {

                console.log(`\nрџ“¦ Installing custom agent from ${agentInput}...`);

                const resolvedPath = path.resolve(agentInput);


                const stats = statSync(resolvedPath);
                const isDirectory = stats.isDirectory();


                const suggestedName = isDirectory
                    ? path.basename(resolvedPath)
                    : extractAgentNameFromPath(resolvedPath);


                const metadata = await promptForMetadata(suggestedName);


                const globalAgentsDir = getFiusGlobalPath('agents');
                const installedPath = path.join(globalAgentsDir, metadata.agentName);
                if (existsSync(installedPath) && !validated.force) {
                    console.log(
                        `вЏ­пёЏ  ${metadata.agentName} already installed (use --force to reinstall)`
                    );
                    skipped.push(metadata.agentName);
                    capture('fius_install_agent', {
                        agent: metadata.agentName,
                        status: 'skipped',
                        reason: 'already_installed',
                        force: validated.force,
                    });
                    continue;
                }


                await installCustomAgent(metadata.agentName, resolvedPath, {
                    name: metadata.agentName,
                    description: metadata.description,
                    author: metadata.author,
                    tags: metadata.tags,
                });

                successCount++;
                console.log(`вњ… ${metadata.agentName} installed successfully`);
                installed.push(metadata.agentName);

                p.outro('рџЋ‰ Custom agent installed successfully!');

                capture('fius_install_agent', {
                    agent: metadata.agentName,
                    status: 'installed',
                    force: validated.force,
                });
            } else {

                console.log(`\nрџ“¦ Installing ${agentInput}...`);


                const globalAgentsDir = getFiusGlobalPath('agents');
                const installedPath = path.join(globalAgentsDir, agentInput);
                if (existsSync(installedPath) && !validated.force) {
                    console.log(`вЏ­пёЏ  ${agentInput} already installed (use --force to reinstall)`);
                    skipped.push(agentInput);
                    capture('fius_install_agent', {
                        agent: agentInput,
                        status: 'skipped',
                        reason: 'already_installed',
                        force: validated.force,
                    });
                    continue;
                }

                await installBundledAgent(agentInput);
                successCount++;
                console.log(`вњ… ${agentInput} installed successfully`);
                installed.push(agentInput);

                capture('fius_install_agent', {
                    agent: agentInput,
                    status: 'installed',
                    force: validated.force,
                });
            }
        } catch (error) {
            errorCount++;
            const errorMsg = `Failed to install ${agentInput}: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            failed.push(agentInput);
            console.error(`вќЊ ${errorMsg}`);


            const safeAgentId = isFilePath(agentInput) ? path.basename(agentInput) : agentInput;
            capture('fius_install_agent', {
                agent: safeAgentId,
                status: 'failed',
                error_message: error instanceof Error ? error.message : String(error),
                force: validated.force,
            });
        }
    }


    try {
        capture('fius_install', {
            requested: agentsToInstall,
            installed,
            skipped,
            failed,
            successCount,
            errorCount,
        });
    } catch {

    }


    if (agentsToInstall.length === 1) {
        if (errorCount > 0) {
            throw new Error(errors[0]);
        }
        return;
    }


    console.log(`\nрџ“Љ Installation Summary:`);
    console.log(`вњ… Successfully installed: ${successCount}`);
    if (errorCount > 0) {
        console.log(`вќЊ Failed to install: ${errorCount}`);
        errors.forEach((error) => console.log(`   вЂў ${error}`));
    }

    if (errorCount > 0 && successCount === 0) {
        throw new Error('All installations failed');
    } else if (errorCount > 0) {
        console.log(`вљ пёЏ  Some installations failed, but ${successCount} succeeded.`);
    } else {
        console.log(`рџЋ‰ All agents installed successfully!`);
    }
}