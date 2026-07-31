import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { ToolError, createLocalToolCallHeader, defineTool } from '@fius/core/tools';
import type { Tool } from '@fius/core/tools';

const AddSkillInputSchema = z
    .object({
        skillId: z
            .string()
            .min(1, 'Skill ID is required')
            .describe('Unique identifier for the skill (used as directory name)'),
        displayName: z
            .string()
            .min(1, 'Display name is required')
            .describe('Human-readable name shown in /skills list'),
        instructions: z
            .string()
            .min(1, 'Instructions are required')
            .describe('Full markdown instructions for the skill'),
        description: z
            .string()
            .optional()
            .describe('Short description of what the skill does'),
    })
    .strict();

export function createAddSkillTool(): Tool<typeof AddSkillInputSchema> {
    return defineTool({
        id: 'add_skill',
        description:
            'Install a skill to ~/.fius/skills/. Skills are markdown-based instruction sets that the AI can invoke via invoke_skill. Each skill is a directory containing a SKILL.md file.',
        inputSchema: AddSkillInputSchema,
        presentation: {
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Skill',
                    argsText: input.skillId,
                }),
        },
        async execute(input) {
            const skillsDir = path.join(homedir(), '.fius', 'skills');
            const skillDir = path.join(skillsDir, input.skillId);
            const skillFile = path.join(skillDir, 'SKILL.md');

            try {
                await fs.mkdir(skillDir, { recursive: true });
            } catch (error) {
                throw ToolError.configInvalid(
                    `Failed to create skill directory: ${error instanceof Error ? error.message : String(error)}`
                );
            }

            let content = `# ${input.displayName}\n\n`;
            if (input.description) {
                content += `---\ndescription: ${input.description}\n---\n\n`;
            }
            content += input.instructions;

            try {
                await fs.writeFile(skillFile, content, 'utf-8');
            } catch (error) {
                throw ToolError.configInvalid(
                    `Failed to write skill file: ${error instanceof Error ? error.message : String(error)}`
                );
            }

            return {
                success: true,
                skillId: input.skillId,
                path: skillFile,
                message: `Skill "${input.displayName}" installed at ${skillFile}`,
            };
        },
    });
}
