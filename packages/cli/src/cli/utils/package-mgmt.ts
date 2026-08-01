import { findPackageRoot, logger } from '@fiusdev/core';
import fsExtra from 'fs-extra';
import path from 'path';
import { PackageJson } from 'type-fest';

export function getPackageManagerInstallCommand(pm: string): string {
    switch (pm) {
        case 'npm':
            return 'install';
        case 'yarn':
            return 'add';
        case 'pnpm':
            return 'add';
        case 'bun':
            return 'add';
        default:
            return 'install';
    }
}

export function getPackageManager(): string {
    const projectRoot = findPackageRoot(process.cwd());
    if (!projectRoot) {
        return 'npm';
    }
    if (fsExtra.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (fsExtra.existsSync(path.join(projectRoot, 'yarn.lock'))) {
        return 'yarn';
    }
    if (
        fsExtra.existsSync(path.join(projectRoot, 'bun.lockb')) ||
        fsExtra.existsSync(path.join(projectRoot, 'bun.lock'))
    ) {
        return 'bun';
    }
    return 'npm';
}

export async function getPackageVersion(): Promise<string> {
    const projectRoot = findPackageRoot(process.cwd());
    if (!projectRoot) {
        throw new Error('Could not find project root');
    }
    const pkgJsonPath = path.join(projectRoot, 'package.json');
    const content = (await fsExtra.readJSON(pkgJsonPath)) as PackageJson;
    if (!content.version) {
        throw new Error('Could not find version in package.json');
    }
    return content.version;
}

export async function addScriptsToPackageJson(scripts: Record<string, string>) {
    let packageJson;
    try {
        packageJson = await fsExtra.readJSON('package.json');
    } catch (err) {
        throw new Error(
            `Failed to read package.json: ${err instanceof Error ? err.message : String(err)}`
        );
    }

    packageJson.scripts = {
        ...packageJson.scripts,
        ...scripts,
    };

    logger.debug(`Adding scripts to package.json: ${JSON.stringify(scripts, null, 2)}`);

    try {
        logger.debug(
            `Writing to package.json. \n Contents: ${JSON.stringify(packageJson, null, 2)}`
        );
        await fsExtra.writeJSON('package.json', packageJson, { spaces: 4 });
    } catch (err) {
        throw new Error(
            `Failed to write to package.json: ${err instanceof Error ? err.message : String(err)}`
        );
    }
}

export async function checkForFileInCurrentDirectory(fileName: string) {
    const file = path.join(process.cwd(), fileName);
    let isFilePresent = false;

    try {
        await fsExtra.readJSON(file);
        isFilePresent = true;
    } catch {
        isFilePresent = false;
    }

    if (isFilePresent) {
        return;
    }
    logger.debug(`${fileName} not found in the current directory.`);
    throw new FileNotFoundError(`${fileName} not found in the current directory.`);
}

export class FileNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FileNotFoundError';
    }
}