import { readFileSync } from 'fs';
import chalk from 'chalk';
import { z } from 'zod';
import { resolveAgentPath, resolveBundledScript } from '@fiusdev/agent-management';

const WhichCommandSchema = z
    .object({
        agentName: z.string().min(1, 'Agent name cannot be empty'),
    })
    .strict();

export type WhichCommandOptions = z.output<typeof WhichCommandSchema>;

function getAvailableAgentNames(): string[] {
    try {
        const registryPath = resolveBundledScript('agents/agent-registry.json');
        const content = readFileSync(registryPath, 'utf-8');
        const registry = JSON.parse(content);
        return Object.keys(registry.agents || {});
    } catch (_error) {
        return [];
    }
}

export async function handleWhichCommand(agentName: string): Promise<void> {
    const validated = WhichCommandSchema.parse({ agentName });
    const availableAgents = getAvailableAgentNames();

    try {
        const resolvedPath = await resolveAgentPath(validated.agentName, false);
        console.log(resolvedPath);
    } catch (error) {
        console.error(
            chalk.red(
                `вќЊ fius which command failed: ${error instanceof Error ? error.message : String(error)}. Available agents: ${availableAgents.join(', ')}`
            )
        );
        process.exit(1);
    }
}