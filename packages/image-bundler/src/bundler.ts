/**
 * Main bundler logic
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateImageDefinition } from './image-definition/validate-image-definition.js';
import type { ImageDefinition } from './image-definition/types.js';
import type { BundleOptions, BundleResult } from './types.js';
import { generateEntryPoint } from './generator.js';
import { build } from 'esbuild';
import ts from 'typescript';

/**
 * Bundle a Fius base image
 */
export async function bundle(options: BundleOptions): Promise<BundleResult> {
    const warnings: string[] = [];

    console.log(`📦 Loading image definition from ${options.imagePath}`);
    const definition = await loadImageDefinition(options.imagePath);

    console.log(`✅ Loaded image: ${definition.name} v${definition.version}`);

    console.log(`🔍 Validating image definition...`);
    try {
        validateImageDefinition(definition);
        console.log(`✅ Image definition is valid`);
    } catch (error) {
        throw new Error(`Image validation failed: ${error}`);
    }

    const coreVersion = getCoreVersion();

    console.log(`🔍 Discovering factories from folders...`);
    const imageDir = dirname(options.imagePath);
    const discoveredFactories = discoverFactories(imageDir, warnings);
    console.log(`✅ Discovered ${discoveredFactories.totalCount} factory(ies)`);

    console.log(`🔨 Generating entry point...`);
    const generated = generateEntryPoint(definition, discoveredFactories);

    const outDir = resolve(options.outDir);
    if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
    }

    console.log(`🔨 Compiling factory source files...`);
    let compiledCount = 0;

    const toolsDir = join(imageDir, 'tools');
    if (existsSync(toolsDir)) {
        compileSourceFiles(toolsDir, join(outDir, 'tools'));
        compiledCount++;
    }

    const hooksDir = join(imageDir, 'hooks');
    if (existsSync(hooksDir)) {
        compileSourceFiles(hooksDir, join(outDir, 'hooks'));
        compiledCount++;
    }

    const compactionDir = join(imageDir, 'compaction');
    if (existsSync(compactionDir)) {
        compileSourceFiles(compactionDir, join(outDir, 'compaction'));
        compiledCount++;
    }

    if (compiledCount > 0) {
        console.log(
            `✅ Compiled ${compiledCount} factory categor${compiledCount === 1 ? 'y' : 'ies'}`
        );
    }

    console.log(`🔍 Validating factory exports...`);
    await validateDiscoveredFactories(outDir, discoveredFactories);

    const entryFile = join(outDir, 'index.js');
    const typesFile = join(outDir, 'index.d.ts');

    console.log(`📝 Writing ${entryFile}...`);
    writeFileSync(entryFile, generated.js, 'utf-8');

    console.log(`📝 Writing ${typesFile}...`);
    writeFileSync(typesFile, generated.dts, 'utf-8');

    updatePackageJson(dirname(options.imagePath), outDir);

    console.log(`✨ Build complete!`);
    console.log(`   Entry: ${entryFile}`);
    console.log(`   Types: ${typesFile}`);

    const metadata = {
        name: definition.name,
        version: definition.version,
        description: definition.description,
        target: definition.target || 'custom',
        constraints: definition.constraints || [],
        builtAt: new Date().toISOString(),
        coreVersion,
    };

    return {
        entryFile,
        typesFile,
        metadata,
        warnings,
    };
}

/**
 * Load image definition from file
 */
async function loadImageDefinition(imagePath: string): Promise<ImageDefinition> {
    const absolutePath = resolve(imagePath);

    if (!existsSync(absolutePath)) {
        throw new Error(`Image file not found: ${absolutePath}`);
    }

    try {
        const imageDir = dirname(absolutePath);
        const tempDir = await mkdtemp(join(imageDir, '.fius-image-definition-'));
        const compiledPath = join(tempDir, 'fius.image.mjs');

        try {
            await build({
                entryPoints: [absolutePath],
                outfile: compiledPath,
                bundle: true,
                platform: 'node',
                format: 'esm',
                target: 'node20',
                packages: 'external',
                logLevel: 'silent',
            });

            const module = await import(pathToFileURL(compiledPath).href);

            const definition = module.default as ImageDefinition;

            if (!definition) {
                throw new Error('Image file must have a default export');
            }

            return definition;
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to load image definition: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Get @fiusdev/core version
 */
function getCoreVersion(): string {
    try {
        const require = createRequire(import.meta.url);
        const pkg = require('@fiusdev/core/package.json') as { version?: unknown };
        return typeof pkg.version === 'string' ? pkg.version : '1.0.0';
    } catch {
        return '1.0.0';
    }
}

/**
 * Update or create package.json with proper exports
 */
function updatePackageJson(imageDir: string, outDir: string): void {
    const packageJsonPath = join(imageDir, 'package.json');

    if (!existsSync(packageJsonPath)) {
        console.log(`⚠️  No package.json found, skipping exports update`);
        return;
    }

    try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

        pkg.exports = {
            '.': {
                types: './dist/index.d.ts',
                import: './dist/index.js',
            },
        };

        pkg.main = './dist/index.js';
        pkg.types = './dist/index.d.ts';

        writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2), 'utf-8');
        console.log(`✅ Updated package.json exports`);
    } catch (error) {
        console.warn(`⚠️  Failed to update package.json: ${error}`);
    }
}

/**
 * Compile TypeScript source files to JavaScript
 */
function compileSourceFiles(srcDir: string, outDir: string): void {
    const tsFiles = findTypeScriptFiles(srcDir);

    if (tsFiles.length === 0) {
        console.log(`   No TypeScript files found in ${srcDir}`);
        return;
    }

    console.log(`   Found ${tsFiles.length} TypeScript file(s) to compile`);

    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        outDir: outDir,
        rootDir: srcDir,
        declaration: true,
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        resolveJsonModule: true,
    };

    const program = ts.createProgram(tsFiles, compilerOptions);

    const emitResult = program.emit();

    const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

    if (allDiagnostics.length > 0) {
        allDiagnostics.forEach((diagnostic) => {
            if (diagnostic.file) {
                const { line, character } = ts.getLineAndCharacterOfPosition(
                    diagnostic.file,
                    diagnostic.start!
                );
                const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
                console.error(
                    `   ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`
                );
            } else {
                console.error(
                    `   ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
                );
            }
        });

        if (emitResult.emitSkipped) {
            throw new Error('TypeScript compilation failed');
        }
    }
}

/**
 * Recursively find all TypeScript files in a directory
 */
function findTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];

    function walk(currentDir: string) {
        const entries = readdirSync(currentDir);

        for (const entry of entries) {
            const fullPath = join(currentDir, entry);
            const stat = statSync(fullPath);

            if (stat.isDirectory()) {
                walk(fullPath);
            } else if (stat.isFile() && extname(entry) === '.ts') {
                files.push(fullPath);
            }
        }
    }

    walk(dir);
    return files;
}

/**
 * Factory discovery result for a single category
 */
export interface DiscoveredFactory {
    type: string;
    importPath: string;
}

export interface DiscoveredFactories {
    tools: DiscoveredFactory[];
    hooks: DiscoveredFactory[];
    compaction: DiscoveredFactory[];
    totalCount: number;
}

/**
 * Discover factories from convention-based folder structure
 *
 * Convention (folder-based with index.ts):
 *   tools/           - ToolFactory folders
 *     weather/       - Factory folder
 *       index.ts     - Factory implementation (auto-discovered)
 *       helpers.ts   - Optional helper files
 *       types.ts     - Optional type definitions
 *   compaction/      - CompactionFactory folders
 *   hooks/           - HookFactory folders
 *   storage is an image-level createStores implementation, not convention-discovered
 *
 * Naming Convention (Node.js standard):
 *   <folder>/index.ts    - Auto-discovered and registered
 *   <folder>/other.ts    - Ignored unless imported by index.ts
 */
function discoverFactories(imageDir: string, warnings: string[]): DiscoveredFactories {
    const result: DiscoveredFactories = {
        tools: [],
        hooks: [],
        compaction: [],
        totalCount: 0,
    };

    const discoverFolder = (options: {
        srcDir: string;
        importBase: string;
        label: string;
    }): DiscoveredFactory[] => {
        const { srcDir, importBase, label } = options;

        if (!existsSync(srcDir)) {
            return [];
        }

        const factoryFolders = readdirSync(srcDir).filter((entry) => {
            const entryPath = join(srcDir, entry);
            const stat = statSync(entryPath);
            if (!stat.isDirectory()) {
                return false;
            }

            const indexPath = join(entryPath, 'index.ts');
            return existsSync(indexPath);
        });

        if (factoryFolders.length > 0) {
            console.log(`   Found ${factoryFolders.length} factory(ies) in ${label}`);
        }

        return factoryFolders.map((type) => ({
            type,
            importPath: `./${importBase}/${type}/index.js`,
        }));
    };

    result.tools = discoverFolder({
        srcDir: join(imageDir, 'tools'),
        importBase: 'tools',
        label: 'tools/',
    });

    result.hooks = discoverFolder({
        srcDir: join(imageDir, 'hooks'),
        importBase: 'hooks',
        label: 'hooks/',
    });

    result.compaction = discoverFolder({
        srcDir: join(imageDir, 'compaction'),
        importBase: 'compaction',
        label: 'compaction/',
    });

    result.totalCount = result.tools.length + result.hooks.length + result.compaction.length;

    if (result.totalCount === 0) {
        warnings.push(
            'No factories discovered from convention folders. This image will not be able to resolve tools/hooks/compaction unless it extends a base image.'
        );
    }

    return result;
}

async function validateFactoryExport(options: {
    outDir: string;
    kind: string;
    entry: DiscoveredFactory;
}): Promise<void> {
    const { outDir, kind, entry } = options;

    const absolutePath = resolve(outDir, entry.importPath);
    const fileUrl = pathToFileURL(absolutePath).href;

    let module: unknown;
    try {
        module = await import(fileUrl);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Failed to import ${kind} factory '${entry.type}' (${entry.importPath}): ${message}`
        );
    }

    if (!module || typeof module !== 'object') {
        throw new Error(
            `Invalid ${kind} factory '${entry.type}' (${entry.importPath}): expected an object module export`
        );
    }

    const factory = (module as Record<string, unknown>).factory;
    if (!factory || typeof factory !== 'object') {
        throw new Error(
            `Invalid ${kind} factory '${entry.type}' (${entry.importPath}): missing 'factory' export`
        );
    }

    const configSchema = (factory as Record<string, unknown>).configSchema;
    const create = (factory as Record<string, unknown>).create;

    const parse = (configSchema as { parse?: unknown } | null | undefined)?.parse;
    if (!configSchema || typeof configSchema !== 'object' || typeof parse !== 'function') {
        throw new Error(
            `Invalid ${kind} factory '${entry.type}' (${entry.importPath}): factory.configSchema must be a Zod schema`
        );
    }

    if (typeof create !== 'function') {
        throw new Error(
            `Invalid ${kind} factory '${entry.type}' (${entry.importPath}): factory.create must be a function`
        );
    }
}

async function validateDiscoveredFactories(
    outDir: string,
    discovered: DiscoveredFactories
): Promise<void> {
    const validations: Array<Promise<void>> = [];

    for (const entry of discovered.tools) {
        validations.push(validateFactoryExport({ outDir, kind: 'tool', entry }));
    }
    for (const entry of discovered.hooks) {
        validations.push(validateFactoryExport({ outDir, kind: 'hook', entry }));
    }
    for (const entry of discovered.compaction) {
        validations.push(validateFactoryExport({ outDir, kind: 'compaction', entry }));
    }
    await Promise.all(validations);
}
