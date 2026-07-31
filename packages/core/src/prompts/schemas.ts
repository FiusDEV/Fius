

import { z } from 'zod';
import { PROMPT_NAME_REGEX, PROMPT_NAME_GUIDANCE } from './name-validation.js';


export const InlinePromptSchema = z
    .object({
        type: z.literal('inline').describe('Inline prompt type'),
        id: z
            .string()
            .min(1)
            .max(64)
            .regex(PROMPT_NAME_REGEX, `Prompt id must be ${PROMPT_NAME_GUIDANCE}`)
            .describe('Kebab-case slug id for the prompt (e.g., quick-start)'),
        title: z.string().optional().describe('Display title for the prompt'),
        description: z
            .string()
            .optional()
            .default('')
            .describe('Description shown on hover or in the UI'),
        prompt: z.string().describe('The actual prompt text'),
        category: z
            .string()
            .optional()
            .default('general')
            .describe('Category for organizing prompts (e.g., general, coding, analysis, tools)'),
        priority: z
            .number()
            .optional()
            .default(0)
            .describe('Higher numbers appear first in the list'),
        showInStarters: z
            .boolean()
            .optional()
            .default(false)
            .describe('Show as a clickable button in WebUI starter prompts'),
        'user-invocable': z
            .boolean()
            .optional()
            .default(true)
            .describe('Show in slash command menu'),
    })
    .strict()
    .describe('Inline prompt with text defined directly in config');


export const FilePromptSchema = z
    .object({
        type: z.literal('file').describe('File-based prompt type'),
        file: z
            .string()
            .describe(
                'Path to markdown file containing prompt (supports ${{fius.agent_dir}} template)'
            ),
        showInStarters: z
            .boolean()
            .optional()
            .default(false)
            .describe('Show as a clickable button in WebUI starter prompts'),
        'user-invocable': z.boolean().optional().describe('Show in slash command menu'),
        namespace: z
            .string()
            .optional()
            .describe('Plugin namespace for command prefixing (e.g., plugin-name:command)'),
    })
    .strict()
    .describe('File-based prompt loaded from a markdown file');


export const PromptsSchema = z
    .array(z.discriminatedUnion('type', [InlinePromptSchema, FilePromptSchema]))
    .superRefine((arr, ctx) => {
        const seen = new Map<string, number>();
        arr.forEach((p, idx) => {
            if (p.type === 'inline') {
                if (seen.has(p.id)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Duplicate prompt id: ${p.id}`,
                        path: [idx, 'id'],
                    });
                } else {
                    seen.set(p.id, idx);
                }
            }
        });
    })
    .transform((arr) =>
        arr.map((p) => {
            if (p.type === 'inline') {
                return { ...p, title: p.title ?? p.id.replace(/-/g, ' ') };
            }
            return p;
        })
    )
    .default([])
    .describe('Agent prompts - inline text or file-based');


export type ValidatedInlinePrompt = z.output<typeof InlinePromptSchema>;


export type ValidatedFilePrompt = z.output<typeof FilePromptSchema>;


export type ValidatedPrompt = ValidatedInlinePrompt | ValidatedFilePrompt;


export type InlinePrompt = z.input<typeof InlinePromptSchema>;


export type FilePrompt = z.input<typeof FilePromptSchema>;


export type Prompt = InlinePrompt | FilePrompt;


export type ValidatedPromptsConfig = z.output<typeof PromptsSchema>;


export type PromptsConfig = z.input<typeof PromptsSchema>;
