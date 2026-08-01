
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { z } from 'zod';
import {
    getFiusGlobalPath,
    globalPreferencesExist,
    loadGlobalPreferences,
    loadBundledRegistryAgents,
} from '@fiusdev/agent-management';
import { getProviderDisplayName } from '../../utils/provider-setup.js';


const ListAgentsCommandSchema = z
    .object({
        verbose: z.boolean().default(false),
        installed: z.boolean().default(false),
        available: z.boolean().default(false),
    })
    .strict();

export type ListAgentsCommandOptions = z.output<typeof ListAgentsCommandSchema>;
export type ListAgentsCommandOptionsInput = z.input<typeof ListAgentsCommandSchema>;

interface InstalledAgentInfo {
    name: string;
    description: string;
    path: string;
    llmProvider?: string;
    llmModel?: string;
    installedAt?: Date;
}

interface AvailableAgentInfo {
    name: string;
    description: string;
    author: string;
    tags: string[];
    type: 'builtin' | 'custom';
}

async function getInstalledAgents(): Promise<InstalledAgentInfo[]> {
    const globalAgentsDir = getFiusGlobalPath('agents');

    if (!existsSync(globalAgentsDir)) {
        return [];
    }

    const bundledRegistry = loadBundledRegistryAgents();
    const installedAgents: InstalledAgentInfo[] = [];

    try {
        const entries = await fs.readdir(globalAgentsDir, { withFileTypes: true });

        for (const entry of entries) {

            if (entry.name === 'registry.json' || entry.name.includes('.tmp.')) {
                continue;
            }

            if (entry.isDirectory()) {
                const agentName = entry.name;
                const agentPath = path.join(globalAgentsDir, entry.name);

                try {


                    const bundledEntry = bundledRegistry[agentName];
                    const mainFile = bundledEntry?.main || 'agent.yml';
                    const mainConfigPath = path.join(agentPath, mainFile);


                    if (!existsSync(mainConfigPath)) {
                        console.warn(
                            `Warning: Could not find main config for agent '${agentName}' at ${mainConfigPath}`
                        );
                        continue;
                    }


                    const stats = await fs.stat(agentPath);


                    let llmProvider: string | undefined;
                    let llmModel: string | undefined;

                    try {
                        const configContent = await fs.readFile(mainConfigPath, 'utf-8');
                        const configMatch = configContent.match(/provider:\s*([^\n\r]+)/);
                        const modelMatch = configContent.match(/model:\s*([^\n\r]+)/);

                        llmProvider = configMatch?.[1]?.trim();
                        llmModel = modelMatch?.[1]?.trim();
                    } catch (_error) {

                    }


                    const description = bundledEntry?.description || 'Custom agent';

                    const agentInfo: InstalledAgentInfo = {
                        name: agentName,
                        description,
                        path: mainConfigPath,
                        installedAt: stats.birthtime || stats.mtime,
                    };

                    if (llmProvider) agentInfo.llmProvider = llmProvider;
                    if (llmModel) agentInfo.llmModel = llmModel;

                    installedAgents.push(agentInfo);
                } catch (error) {

                    console.warn(`Warning: Could not process agent '${agentName}': ${error}`);
                }
            }
        }
    } catch (_error) {

        return [];
    }

    return installedAgents.sort((a, b) => a.name.localeCompare(b.name));
}

function getAvailableAgents(): AvailableAgentInfo[] {
    const bundledRegistry = loadBundledRegistryAgents();

    return Object.entries(bundledRegistry)
        .map(([name, data]) => {
            const d = data as Record<string, string | string[] | undefined>;
            return {
                name,
                description: typeof d.description === 'string' ? d.description : 'No description',
                author: typeof d.author === 'string' ? d.author : 'Unknown',
                tags: Array.isArray(d.tags) ? d.tags : [],
                type: 'builtin' as const,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

export async function handleListAgentsCommand(
    options: ListAgentsCommandOptionsInput
): Promise<void> {

    const validated = ListAgentsCommandSchema.parse(options);

    console.log(chalk.cyan('\nрџ“‹ Fius Agents\n'));


    let globalLLM: string | undefined;
    if (globalPreferencesExist()) {
        try {
            const preferences = await loadGlobalPreferences();
            globalLLM = `${getProviderDisplayName(preferences.llm.provider)}/${preferences.llm.model}`;
        } catch {

        }
    }


    const installedAgents = await getInstalledAgents();
    const availableAgents = getAvailableAgents();


    const showInstalled = !validated.available || validated.installed;
    const showAvailable = !validated.installed || validated.available;


    if (showInstalled && installedAgents.length > 0) {
        console.log(chalk.green('вњ… Installed Agents:'));

        for (const agent of installedAgents) {
            const llmInfo =
                agent.llmProvider && agent.llmModel
                    ? `${getProviderDisplayName(agent.llmProvider)}/${agent.llmModel}`
                    : globalLLM || 'Unknown LLM';

            const llmDisplay = chalk.gray(`(${llmInfo})`);

            if (validated.verbose) {
                console.log(`  ${chalk.bold(agent.name)} ${llmDisplay}`);
                console.log(`    ${chalk.gray(agent.description)}`);
                console.log(`    ${chalk.gray('Path:')} ${agent.path}`);
                if (agent.installedAt) {
                    console.log(
                        `    ${chalk.gray('Installed:')} ${agent.installedAt.toLocaleDateString()}`
                    );
                }
                console.log();
            } else {
                console.log(`  вЂў ${chalk.bold(agent.name)} ${llmDisplay} - ${agent.description}`);
            }
        }
        console.log();
    } else if (showInstalled) {
        console.log(chalk.rgb(255, 165, 0)('рџ“¦ No agents installed yet.'));
        console.log(
            chalk.gray(
                '   Use `fius agents install <agent-name>` to install agents from the registry.\n'
            )
        );
    }


    if (showAvailable) {
        const availableNotInstalled = availableAgents.filter(
            (available) => !installedAgents.some((installed) => installed.name === available.name)
        );

        const builtinAgents = availableNotInstalled.filter((a) => a.type === 'builtin');
        const customAgents = availableNotInstalled.filter((a) => a.type === 'custom');

        if (builtinAgents.length > 0) {
            console.log(chalk.blue('рџ“‹ Builtin Agents Available to Install:'));

            for (const agent of builtinAgents) {
                if (validated.verbose) {
                    console.log(`  ${chalk.bold(agent.name)}`);
                    console.log(`    ${chalk.gray(agent.description)}`);
                    console.log(`    ${chalk.gray('Author:')} ${agent.author}`);
                    console.log(`    ${chalk.gray('Tags:')} ${agent.tags.join(', ')}`);
                    console.log();
                } else {
                    console.log(`  вЂў ${chalk.bold(agent.name)} - ${agent.description}`);
                }
            }
            console.log();
        }

        if (customAgents.length > 0) {
            console.log(chalk.cyan('рџ”§ Custom Agents Available:'));

            for (const agent of customAgents) {
                if (validated.verbose) {
                    console.log(`  ${chalk.bold(agent.name)}`);
                    console.log(`    ${chalk.gray(agent.description)}`);
                    console.log(`    ${chalk.gray('Author:')} ${agent.author}`);
                    console.log(`    ${chalk.gray('Tags:')} ${agent.tags.join(', ')}`);
                    console.log();
                } else {
                    console.log(`  вЂў ${chalk.bold(agent.name)} - ${agent.description}`);
                }
            }
            console.log();
        }
    }


    const totalInstalled = installedAgents.length;
    const availableToInstall = availableAgents.filter(
        (a) => !installedAgents.some((i) => i.name === a.name)
    ).length;

    if (!validated.verbose) {
        console.log(
            chalk.gray(
                `рџ“Љ Summary: ${totalInstalled} installed, ${availableToInstall} available to install`
            )
        );

        if (availableToInstall > 0) {
            console.log(
                chalk.gray(`   Use \`fius agents install <agent-name>\` to install more agents.`)
            );
        }

        console.log(chalk.gray(`   Use \`fius agents list --verbose\` for detailed information.`));
        console.log(
            chalk.gray(`   After installing an agent, use \`fius -a <agent-name>\` to run it.`)
        );
    }

    console.log();
}