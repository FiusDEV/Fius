import { walkUpDirectories } from './fs-walk.js';
import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

export type ExecutionContext = 'fius-source' | 'fius-project' | 'global-cli';

const DIRECT_PROJECT_ROOT_MARKERS = [
    path.join('.fius', 'deploy.json'),
    path.join('.fius', 'cloud', 'bootstrap.json'),
    'coding-agent.yml',
    'coding-agent.yaml',
    path.join('agents', 'registry.json'),
    path.join('agents', 'agent-registry.json'),
    path.join('agents', 'coding-agent.yml'),
    path.join('agents', 'coding-agent.yaml'),
    path.join('agents', 'coding-agent', 'coding-agent.yml'),
    path.join('agents', 'coding-agent', 'coding-agent.yaml'),
    path.join('src', 'fius', 'agents', 'coding-agent.yml'),
    path.join('src', 'fius', 'agents', 'coding-agent.yaml'),
] as const;

function getCaseInsensitiveRootFilename(dirPath: string, filename: string): string | null {
    try {
        return (
            readdirSync(dirPath).find((entry) => entry.toLowerCase() === filename.toLowerCase()) ??
            null
        );
    } catch {
        return null;
    }
}

function hasWorkspaceAuthoringDirectory(dirPath: string, name: 'agents' | 'skills'): boolean {
    try {
        return statSync(path.join(dirPath, name)).isDirectory();
    } catch {
        return false;
    }
}

function hasFiusWorkspaceAgentsFile(dirPath: string): boolean {
    const agentsFilename = getCaseInsensitiveRootFilename(dirPath, 'agents.md');
    if (!agentsFilename) {
        return false;
    }

    try {
        const content = readFileSync(path.join(dirPath, agentsFilename), 'utf-8').toLowerCase();
        return content.includes('fius workspace') || content.includes('fius-workspace');
    } catch {
        return false;
    }
}

function hasWorkspaceScaffoldMarker(dirPath: string): boolean {
    return (
        hasFiusWorkspaceAgentsFile(dirPath) &&
        (hasWorkspaceAuthoringDirectory(dirPath, 'agents') ||
            hasWorkspaceAuthoringDirectory(dirPath, 'skills'))
    );
}

function readPackageName(dirPath: string): string | null {
    try {
        const pkg = JSON.parse(readFileSync(path.join(dirPath, 'package.json'), 'utf-8'));
        return typeof pkg.name === 'string' ? pkg.name : null;
    } catch {
        return null;
    }
}

function isInternalFiusPackage(dirPath: string): boolean {
    const packageName = readPackageName(dirPath);
    return packageName === 'fius' || packageName?.startsWith('@fius/') === true;
}

function hasProjectRootMarker(dirPath: string): boolean {
    if (hasWorkspaceScaffoldMarker(dirPath)) {
        return true;
    }

    return DIRECT_PROJECT_ROOT_MARKERS.some((relativePath) =>
        existsSync(path.join(dirPath, relativePath))
    );
}

function getForcedProjectRoot(): string | null {
    const value = process.env.FIUS_PROJECT_ROOT?.trim();
    if (!value) {
        return null;
    }

    try {
        const resolved = path.resolve(value);
        if (!statSync(resolved).isDirectory()) {
            return null;
        }

        const root = realpathSync(resolved);
        if (
            isFiusProjectDirectory(root) ||
            isFiusSourceDirectory(root) ||
            hasProjectRootMarker(root)
        ) {
            return root;
        }

        return null;
    } catch {
        return null;
    }
}


function isFiusSourceDirectory(dirPath: string): boolean {
    return readPackageName(dirPath) === 'fius-monorepo';
}


function isFiusProjectDirectory(dirPath: string): boolean {
    if (isFiusSourceDirectory(dirPath)) {
        return false;
    }

    if (isInternalFiusPackage(dirPath)) {
        return false;
    }

    if (hasProjectRootMarker(dirPath)) {
        return true;
    }

    try {
        const pkg = JSON.parse(readFileSync(path.join(dirPath, 'package.json'), 'utf-8'));
        const allDeps = {
            ...(pkg.dependencies ?? {}),
            ...(pkg.devDependencies ?? {}),
            ...(pkg.peerDependencies ?? {}),
        };

        return 'fius' in allDeps || '@fius/core' in allDeps;
    } catch {
        return false;
    }
}


export function findFiusSourceRoot(startPath: string = process.cwd()): string | null {
    return walkUpDirectories(startPath, isFiusSourceDirectory);
}


export function findFiusProjectRoot(startPath: string = process.cwd()): string | null {
    const forcedProjectRoot = getForcedProjectRoot();
    if (forcedProjectRoot) {
        return forcedProjectRoot;
    }
    return walkUpDirectories(startPath, isFiusProjectDirectory);
}


export function getExecutionContext(startPath: string = process.cwd()): ExecutionContext {
    if (getForcedProjectRoot()) {
        return 'fius-project';
    }

    if (findFiusSourceRoot(startPath)) {
        return 'fius-source';
    }

    if (findFiusProjectRoot(startPath)) {
        return 'fius-project';
    }

    return 'global-cli';
}
