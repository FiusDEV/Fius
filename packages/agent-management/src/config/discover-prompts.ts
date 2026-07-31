/**
 * Command Prompt Discovery
 *
 * Discovers command prompts from commands/ directories based on execution context.
 * Extracted to separate file to enable proper unit testing with mocks.
 *
 * Discovery locations (in priority order):
 *
 * Local commands (project-specific):
 * 1. <projectRoot>/commands/ (fius-source dev mode or fius-project only)
 * 2. <cwd>/.fius/commands/
 * 3. <cwd>/.claude/commands/ (Claude Code compatibility)
 * 4. <cwd>/.cursor/commands/ (Cursor compatibility)
 *
 * Global commands (user-wide):
 * 5. ~/.fius/commands/
 * 6. ~/.claude/commands/ (Claude Code compatibility)
 * 7. ~/.cursor/commands/ (Cursor compatibility)
 *
 * Files with the same basename are deduplicated (first found wins).
 */

import {
    getExecutionContext,
    findFiusSourceRoot,
    findFiusProjectRoot,
} from '../utils/execution-context.js';
import { getFiusGlobalPath } from '../utils/path.js';
import * as path from 'path';
import { existsSync, readdirSync } from 'fs';

/**
 * File prompt entry for discovered commands
 */
export interface FilePromptEntry {
    type: 'file';
    file: string;
    showInStarters?: boolean;
}

/**
 * Discovers command prompts from commands/ directories.
 *
 * @param searchRoot Optional workspace root to scope discovery to
 * @returns Array of file prompt entries for discovered .md files
 */
export function discoverCommandPrompts(searchRoot?: string): FilePromptEntry[] {
    const prompts: FilePromptEntry[] = [];
    const seenFiles = new Set<string>();
    const cwd = path.resolve(searchRoot ?? process.cwd());
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';

    const scanAndAdd = (dir: string): void => {
        if (!existsSync(dir)) return;
        const files = scanCommandsDirectory(dir);
        for (const file of files) {
            const basename = path.basename(file).toLowerCase();
            if (!seenFiles.has(basename)) {
                seenFiles.add(basename);
                prompts.push({ type: 'file', file });
            }
        }
    };

    const context = getExecutionContext(cwd);
    let localCommandsDir: string | null = null;

    switch (context) {
        case 'fius-source': {
            const isDevMode = process.env.FIUS_DEV_MODE === 'true';
            if (isDevMode) {
                const sourceRoot = findFiusSourceRoot(cwd);
                if (sourceRoot) {
                    localCommandsDir = path.join(sourceRoot, 'commands');
                }
            }
            break;
        }
        case 'fius-project': {
            const projectRoot = findFiusProjectRoot(cwd);
            if (projectRoot) {
                localCommandsDir = path.join(projectRoot, 'commands');
            }
            break;
        }
        case 'global-cli':
            break;
    }

    if (localCommandsDir) {
        scanAndAdd(localCommandsDir);
    }

    scanAndAdd(path.join(cwd, '.fius', 'commands'));
    scanAndAdd(path.join(cwd, '.claude', 'commands'));
    scanAndAdd(path.join(cwd, '.cursor', 'commands'));

    scanAndAdd(getFiusGlobalPath('commands'));

    if (homeDir) {
        scanAndAdd(path.join(homeDir, '.claude', 'commands'));
    }

    if (homeDir) {
        scanAndAdd(path.join(homeDir, '.cursor', 'commands'));
    }

    return prompts;
}

/**
 * Scans a directory for .md command files
 * @param dir Directory to scan
 * @returns Array of absolute file paths
 */
function scanCommandsDirectory(dir: string): string[] {
    const files: string[] = [];
    try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
                files.push(path.join(dir, entry.name));
            }
        }
    } catch {
    }
    return files;
}

/**
 * Agent instruction file names to discover (in priority order, case-insensitive)
 * First found file wins - only one file is used
 *
 * Conventions:
 * - AGENTS.md: Open standard for AI coding agents (Linux Foundation/AAIF)
 * - CLAUDE.md: Anthropic's Claude Code instruction format
 * - GEMINI.md: Google's Gemini CLI instruction format
 */
const AGENT_INSTRUCTION_FILES = ['agents.md', 'claude.md', 'gemini.md'] as const;

/**
 * Discovers agent instruction files from the provided directory.
 *
 * Looks for files in this order of priority (case-insensitive):
 * 1. AGENTS.md (or agents.md, Agents.md, etc.)
 * 2. CLAUDE.md (or claude.md, Claude.md, etc.)
 * 3. GEMINI.md (or gemini.md, Gemini.md, etc.)
 *
 * Only the first found file is returned (we don't want multiple instruction files).
 *
 * @param searchDir Directory to search
 * @returns The absolute path to the first found instruction file, or null if none found
 */
export function discoverAgentInstructionFile(searchDir: string): string | null {
    const cwd = path.resolve(searchDir);

    let dirEntries: string[];
    try {
        dirEntries = readdirSync(cwd);
    } catch {
        return null;
    }

    const lowercaseMap = new Map<string, string>();
    for (const entry of dirEntries) {
        lowercaseMap.set(entry.toLowerCase(), entry);
    }

    for (const filename of AGENT_INSTRUCTION_FILES) {
        const actualFilename = lowercaseMap.get(filename);
        if (actualFilename) {
            return path.join(cwd, actualFilename);
        }
    }

    return null;
}
