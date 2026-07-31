import * as path from 'path';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { walkUpDirectories } from './fs-walk.js';
import {
    getExecutionContext,
    findFiusSourceRoot,
    findFiusProjectRoot,
} from './execution-context.js';

/**
 * Returns the package root for standalone binary installs.
 *
 * This is intentionally `undefined` for normal npm/pnpm installs.
 * The env var is set by the CLI bootstrap (`packages/cli/src/index.ts`)
 * when it detects executable-based distribution layout.
 */
export function getFiusPackageRoot(): string | undefined {
    const packageRoot = process.env.FIUS_PACKAGE_ROOT;
    return typeof packageRoot === 'string' && packageRoot.length > 0 ? packageRoot : undefined;
}

/**
 * Standard path resolver for logs/db/config/anything in fius projects
 * Context-aware with dev mode support:
 * - fius-source + FIUS_DEV_MODE=true: Use local repo .fius (isolated testing)
 * - fius-source (normal): Use global ~/.fius (user experience)
 * - fius-project: Use project-local .fius
 * - global-cli: Use global ~/.fius
 * @param type Path type (logs, database, config, etc.)
 * @param filename Optional filename to append
 * @param startPath Starting directory for project detection
 * @returns Absolute path to the requested location
 */
export function getFiusPath(type: string, filename?: string, startPath?: string): string {
    const context = getExecutionContext(startPath);

    let basePath: string;

    switch (context) {
        case 'fius-source': {
            const isDevMode = process.env.FIUS_DEV_MODE === 'true';
            if (isDevMode) {
                const sourceRoot = findFiusSourceRoot(startPath);
                if (!sourceRoot) {
                    throw new Error('Not in fius source context');
                }
                basePath = path.join(sourceRoot, '.fius', type);
            } else {
                basePath = path.join(homedir(), '.fius', type);
            }
            break;
        }
        case 'fius-project': {
            const projectRoot = findFiusProjectRoot(startPath);
            if (!projectRoot) {
                throw new Error('Not in fius project context');
            }
            basePath = path.join(projectRoot, '.fius', type);
            break;
        }
        case 'global-cli': {
            basePath = path.join(homedir(), '.fius', type);
            break;
        }
        default: {
            throw new Error(`Unknown execution context: ${context}`);
        }
    }

    return filename ? path.join(basePath, filename) : basePath;
}

/**
 * Global path resolver for user-global resources that should not be project-relative.
 *
 * Dev mode support:
 * - fius-source + FIUS_DEV_MODE=true: Use repo-local `.fius` (isolated testing)
 * - otherwise: Use global `~/.fius` (user experience)
 * @param type Path type (agents, cache, etc.)
 * @param filename Optional filename to append
 * @returns Absolute path to the global location (~/.fius/...)
 */
export function getFiusGlobalPath(type: string, filename?: string): string {
    const isDevMode = process.env.FIUS_DEV_MODE === 'true';
    if (isDevMode && getExecutionContext() === 'fius-source') {
        const sourceRoot = findFiusSourceRoot();
        if (!sourceRoot) {
            throw new Error('Not in fius source context');
        }

        const devBasePath = path.join(sourceRoot, '.fius', type);
        return filename ? path.join(devBasePath, filename) : devBasePath;
    }

    const basePath = path.join(homedir(), '.fius', type);
    return filename ? path.join(basePath, filename) : basePath;
}

/**
 * Copy entire directory recursively
 * @param src Source directory path
 * @param dest Destination directory path
 */
export async function copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });

    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        } else {
            await fs.copyFile(srcPath, destPath);
        }
    }
}

/**
 * Check if string looks like a file path vs registry name
 * @param str String to check
 * @returns True if looks like a path, false if looks like a registry name
 */
export function isPath(str: string): boolean {
    if (path.isAbsolute(str)) return true;

    if (/[\\/]/.test(str)) return true;

    if (/\.(ya?ml|json)$/i.test(str)) return true;

    return false;
}

/**
 * Find package root (for other utilities)
 * @param startPath Starting directory path
 * @returns Directory containing package.json or null
 */
export function findPackageRoot(startPath: string = process.cwd()): string | null {
    return walkUpDirectories(startPath, (dirPath) => {
        const pkgPath = path.join(dirPath, 'package.json');
        return existsSync(pkgPath);
    });
}

/**
 * Resolve bundled script paths for MCP servers
 * @param scriptPath Relative script path
 * @returns Absolute path to bundled script
 */
export function resolveBundledScript(scriptPath: string): string {
    const candidates = scriptPath.startsWith('dist/')
        ? [scriptPath, scriptPath.replace(/^dist\//, '')]
        : [`dist/${scriptPath}`, scriptPath];

    const triedAbs: string[] = [];

    const tryRoots = (roots: Array<string | null | undefined>): string | null => {
        for (const root of roots) {
            if (!root) continue;
            for (const rel of candidates) {
                const abs = path.resolve(root, rel);
                if (existsSync(abs)) return abs;
                triedAbs.push(abs);
            }
        }
        return null;
    };

    const envRoot = getFiusPackageRoot();
    const fromEnv = tryRoots([envRoot]);
    if (fromEnv) return fromEnv;

    try {
        const require = createRequire(import.meta.url);
        const pkgJson = require.resolve('fius/package.json');
        const pkgRoot = path.dirname(pkgJson);
        const fromPkg = tryRoots([pkgRoot]);
        if (fromPkg) return fromPkg;
    } catch {
    }

    try {
        const thisModuleDir = path.dirname(fileURLToPath(import.meta.url));
        const sourceRoot = findFiusSourceRoot(thisModuleDir);
        const fromSource = tryRoots([sourceRoot ?? undefined]);
        if (fromSource) return fromSource;
    } catch {
    }

    const repoRoot = findPackageRoot();
    const fromCwd = tryRoots([repoRoot ?? undefined]);
    if (fromCwd) return fromCwd;

    throw new Error(
        `Bundled script not found: ${scriptPath} (tried absolute: ${triedAbs.join(', ')})`
    );
}

/**
 * Ensure ~/.fius directory exists for global storage
 */
export async function ensureFiusGlobalDirectory(): Promise<void> {
    const fiusDir = getFiusGlobalPath('');
    try {
        await fs.mkdir(fiusDir, { recursive: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }
    }
}

/**
 * Get the appropriate .env file path for saving API keys.
 * Uses the same project detection logic as other fius paths.
 *
 * @param startPath Starting directory for project detection
 * @returns Absolute path to .env file for saving
 */
export function getFiusEnvPath(startPath: string = process.cwd()): string {
    const context = getExecutionContext(startPath);
    let envPath = '';
    switch (context) {
        case 'fius-source': {
            const isDevMode = process.env.FIUS_DEV_MODE === 'true';
            if (isDevMode) {
                const sourceRoot = findFiusSourceRoot(startPath);
                if (!sourceRoot) {
                    throw new Error('Not in fius source context');
                }
                envPath = path.join(sourceRoot, '.env');
            } else {
                envPath = path.join(homedir(), '.fius', '.env');
            }
            break;
        }
        case 'fius-project': {
            const projectRoot = findFiusProjectRoot(startPath);
            if (!projectRoot) {
                throw new Error('Not in fius project context');
            }
            envPath = path.join(projectRoot, '.env');
            break;
        }
        case 'global-cli': {
            envPath = path.join(homedir(), '.fius', '.env');
            break;
        }
    }
    return envPath;
}
