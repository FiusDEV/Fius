import { z } from 'zod';
import * as path from 'path';
import { PROMPT_GENERATOR_SOURCES } from './registry.js';

const BaseContributorSchema = z
    .object({
        id: z.string().describe('Unique identifier for the contributor'),
        priority: z
            .number()
            .int()
            .nonnegative()
            .describe('Execution priority of the contributor (lower numbers run first)'),
        enabled: z
            .boolean()
            .optional()
            .default(true)
            .describe('Whether this contributor is currently active'),
    })
    .strict();
const StaticContributorSchema = BaseContributorSchema.extend({
    type: z.literal('static'),
    content: z.string().describe("Static content for the contributor (REQUIRED for 'static')"),
}).strict();
const DynamicContributorSchema = BaseContributorSchema.extend({
    type: z.literal('dynamic'),
    source: z
        .enum(PROMPT_GENERATOR_SOURCES)
        .describe("Source identifier for dynamic content (REQUIRED for 'dynamic')"),
}).strict();
const FileContributorSchema = BaseContributorSchema.extend({
    type: z.literal('file'),
    files: z
        .array(
            z.string().superRefine((filePath, ctx) => {
                if (!path.isAbsolute(filePath)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message:
                             'FileContributor paths must be absolute after template expansion (use ${{fius.agent_dir}} or provide an absolute path).',
                    });
                }
            })
        )
        .min(1)
        .describe('Array of file paths to include as context (.md and .txt files)'),
    options: z
        .object({
            includeFilenames: z
                .boolean()
                .optional()
                .default(true)
                .describe('Whether to include the filename as a header for each file'),
            separator: z
                .string()
                .optional()
                .default('\n\n---\n\n')
                .describe('Separator to use between multiple files'),
            errorHandling: z
                .enum(['skip', 'error'])
                .optional()
                .default('skip')
                .describe(
                    'How to handle missing or unreadable files: skip (ignore) or error (throw)'
                ),
            maxFileSize: z
                .number()
                .int()
                .positive()
                .optional()
                .default(100000)
                .describe('Maximum file size in bytes (default: 100KB)'),
            includeMetadata: z
                .boolean()
                .optional()
                .default(false)
                .describe(
                    'Whether to include file metadata (size, modification time) in the context'
                ),
        })
        .strict()
        .optional()
        .prefault({}),
}).strict();

export const ContributorConfigSchema = z
    .discriminatedUnion(
        'type',
        [StaticContributorSchema, DynamicContributorSchema, FileContributorSchema],
        {
            error: `Invalid contributor type. Expected 'static', 'dynamic', or 'file'. Note: memory contributors are now configured via the top-level 'memories' config.`,
        }
    )
    .describe(
        "Configuration for a system prompt contributor. Type 'static' requires 'content', type 'dynamic' requires 'source', type 'file' requires 'files'."
    );

export type ContributorConfig = z.input<typeof ContributorConfigSchema>;
export type ValidatedContributorConfig = z.output<typeof ContributorConfigSchema>;

export const SessionPromptContributorSchema = z
    .object({
        id: z.string().min(1).describe('Unique identifier for the session contributor'),
        priority: z
            .number()
            .int()
            .nonnegative()
            .describe('Execution priority of the session contributor (lower numbers run first)'),
        content: z
            .string()
            .describe('Static content to include in the system prompt for this session only'),
    })
    .strict();

export type SessionPromptContributor = z.output<typeof SessionPromptContributorSchema>;

export const SystemPromptContributorsSchema = z
    .object({
        contributors: z
            .array(ContributorConfigSchema)
            .min(1)
            .default([
                {
                    id: 'date',
                    type: 'dynamic',
                    priority: 10,
                    source: 'date',
                    enabled: true,
                },
                {
                    id: 'env',
                    type: 'dynamic',
                    priority: 15,
                    source: 'env',
                    enabled: true,
                },
                {
                    id: 'resources',
                    type: 'dynamic',
                    priority: 20,
                    source: 'resources',
                    enabled: false,
                },
            ] as const)
            .describe('An array of contributor configurations that make up the system prompt'),
    })
    .strict();

export const SystemPromptConfigSchema = z
    .union([
        z.string().transform((str) => ({
            contributors: [
                { id: 'inline', type: 'static' as const, content: str, priority: 0, enabled: true },
            ],
        })),
        SystemPromptContributorsSchema,
    ])
    .describe('Plain string or structured contributors object')
    .brand<'ValidatedSystemPromptConfig'>();

export type SystemPromptConfig = z.input<typeof SystemPromptConfigSchema>;
export type ValidatedSystemPromptConfig = z.output<typeof SystemPromptConfigSchema>;
