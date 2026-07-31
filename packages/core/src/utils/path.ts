import * as path from 'path';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { walkUpDirectories } from './fs-walk.js';
import {
    getExecutionContext,
    findFiusSourceRoot,
    findFiusProjectRoot,
} from './execution-context.js';
import type { Logger } from '../logger/v2/types.js';


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


export function isPath(str: string): boolean {
    if (path.isAbsolute(str)) return true;

    if (/[\\/]/.test(str)) return true;

    if (/\.(ya?ml|json)$/i.test(str)) return true;

    return false;
}


export function findPackageRoot(startPath: string = process.cwd()): string | null {
    return walkUpDirectories(startPath, (dirPath) => {
        const pkgPath = path.join(dirPath, 'package.json');
        return existsSync(pkgPath);
    });
}


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


export function getFiusEnvPath(startPath: string = process.cwd(), logger?: Logger): string {
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
    logger?.debug(`Fius env path: ${envPath}, context: ${context}`);
    return envPath;
}
