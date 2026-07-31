
import { z } from 'zod';
import { getAgentRegistry } from '@fius/agent-management';
import { capture } from '../../../analytics/index.js';


const UninstallCommandSchema = z
    .object({
        agents: z.array(z.string().min(1, 'Agent name cannot be empty')),
        all: z.boolean().default(false),
        force: z.boolean().default(false),
    })
    .strict();

export type UninstallCommandOptions = z.output<typeof UninstallCommandSchema>;

async function validateUninstallCommand(
    agents: string[],
    options: Partial<UninstallCommandOptions>
): Promise<UninstallCommandOptions> {
    const registry = getAgentRegistry();


    const validated = UninstallCommandSchema.parse({
        ...options,
        agents,
    });


    const installedAgents = await registry.getInstalledAgents();

    if (installedAgents.length === 0) {
        throw new Error('No agents are currently installed.');
    }

    if (!validated.all && validated.agents.length === 0) {
        throw new Error(
            `No agents specified. Use agent names or --all flag. Installed agents: ${installedAgents.join(', ')}`
        );
    }

    return validated;
}

export async function handleUninstallCommand(
    agents: string[],
    options: Partial<UninstallCommandOptions>
): Promise<void> {
    const registry = getAgentRegistry();


    const validated = await validateUninstallCommand(agents, options);
    const installedAgents = await registry.getInstalledAgents();

    if (installedAgents.length === 0) {
        console.log('рџ“‹ No agents are currently installed.');
        return;
    }


    let agentsToUninstall: string[];
    if (validated.all) {
        agentsToUninstall = installedAgents;
        console.log(`рџ“‹ Uninstalling all ${agentsToUninstall.length} installed agents...`);
    } else {
        agentsToUninstall = validated.agents;


        const notInstalled = agentsToUninstall.filter((agent) => !installedAgents.includes(agent));
        if (notInstalled.length > 0) {
            throw new Error(
                `Agents not installed: ${notInstalled.join(', ')}. ` +
                    `Installed agents: ${installedAgents.join(', ')}`
            );
        }
    }

    console.log(`рџ—‘пёЏ  Uninstalling ${agentsToUninstall.length} agents...`);

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    const uninstalled: string[] = [];
    const failed: string[] = [];


    for (const agentName of agentsToUninstall) {
        try {
            console.log(`\nрџ—‘пёЏ  Uninstalling ${agentName}...`);
            await registry.uninstallAgent(agentName, validated.force);
            successCount++;
            console.log(`вњ… ${agentName} uninstalled successfully`);
            uninstalled.push(agentName);

            try {
                capture('fius_uninstall_agent', {
                    agent: agentName,
                    status: 'uninstalled',
                    force: validated.force,
                });
            } catch {

            }
        } catch (error) {
            errorCount++;
            const errorMsg = `Failed to uninstall ${agentName}: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            failed.push(agentName);
            console.error(`вќЊ ${errorMsg}`);

            try {
                capture('fius_uninstall_agent', {
                    agent: agentName,
                    status: 'failed',
                    error_message: error instanceof Error ? error.message : String(error),
                    force: validated.force,
                });
            } catch {

            }
        }
    }


    try {
        capture('fius_uninstall', {
            requested: agentsToUninstall,
            uninstalled,
            failed,
            successCount,
            errorCount,
        });
    } catch {

    }


    if (agentsToUninstall.length === 1) {
        if (errorCount > 0) {
            throw new Error(errors[0]);
        }
        return;
    }


    console.log(`\nрџ“Љ Uninstallation Summary:`);
    console.log(`вњ… Successfully uninstalled: ${successCount}`);
    if (errorCount > 0) {
        console.log(`вќЊ Failed to uninstall: ${errorCount}`);
        errors.forEach((error) => {
            console.log(`   вЂў ${error}`);
        });
    }

    if (errorCount > 0 && successCount === 0) {
        throw new Error('All uninstallations failed');
    } else if (errorCount > 0) {
        console.log(`вљ пёЏ  Some uninstallations failed, but ${successCount} succeeded.`);
    } else {
        console.log(`рџЋ‰ All agents uninstalled successfully!`);
    }
}