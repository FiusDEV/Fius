import { z } from 'zod';


const FileExtensionSchema = z
    .string()
    .regex(
        /^\.[A-Za-z0-9][A-Za-z0-9._-]*$/,
        'Extensions must start with a dot and may include alphanumerics, dot, underscore, or hyphen (e.g., .d.ts, .tar.gz)'
    )
    .describe('File extension pattern starting with a dot; supports multi-part extensions');


const FileSystemResourceSchema = z
    .object({
        type: z.literal('filesystem'),
        paths: z
            .array(z.string())
            .min(1)
            .describe('File paths or directories to expose as resources (at least one required)'),
        maxDepth: z
            .number()
            .min(1)
            .max(10)
            .default(3)
            .describe('Maximum directory depth to traverse (default: 3)'),
        maxFiles: z
            .number()
            .min(1)
            .max(10000)
            .default(1000)
            .describe('Maximum number of files to include (default: 1000)'),
        includeHidden: z
            .boolean()
            .default(false)
            .describe('Include hidden files and directories (default: false)'),
        includeExtensions: z
            .array(FileExtensionSchema)
            .default([
                '.txt',
                '.md',
                '.js',
                '.ts',
                '.json',
                '.html',
                '.css',
                '.py',
                '.yaml',
                '.yml',
                '.xml',
                '.jsx',
                '.tsx',
                '.vue',
                '.php',
                '.rb',
                '.go',
                '.rs',
                '.java',
                '.kt',
                '.swift',
                '.sql',
                '.sh',
                '.bash',
                '.zsh',
            ])
            .describe('File extensions to include (default: common text files)'),
    })
    .strict();


export type ValidatedFileSystemResourceConfig = z.output<typeof FileSystemResourceSchema>;


const BlobResourceSchema = z
    .object({
        type: z.literal('blob').describe('Enable blob storage resource provider'),
    })
    .strict()
    .describe(
        'Blob resource provider configuration - actual storage settings come from the image storage implementation'
    );


export type ValidatedBlobResourceConfig = z.output<typeof BlobResourceSchema>;


export const ResourceConfigSchema = z.discriminatedUnion('type', [
    FileSystemResourceSchema,
    BlobResourceSchema,
]);


export type ValidatedResourceConfig = z.output<typeof ResourceConfigSchema>;


export const ResourcesConfigSchema = z
    .array(ResourceConfigSchema)
    .default([])
    .describe('Agent-managed resource configuration');

export type ResourcesConfig = z.input<typeof ResourcesConfigSchema>;
export type ValidatedResourcesConfig = z.output<typeof ResourcesConfigSchema>;
