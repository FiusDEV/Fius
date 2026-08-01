import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentConfig } from '@fiusdev/agent-config';
import type { Logger } from '@fiusdev/core';
import { ConfigError } from './errors.js';
import { getFiusPath } from '../utils/path.js';

/**
 * Template variables context for expansion
 */
interface TemplateContext {
    /** Agent directory (where the config file is located) */
    agentDir: string;
    /** Project .fius directory (context-aware via getFiusPath) */
    projectDir: string;
}

/**
 * Expand template variables in agent configuration
 *
 * Supported variables:
 * - ${{fius.agent_dir}} - Agent's directory path (where config is located)
 * - ${{fius.project_dir}} - Context-aware .fius directory:
 *   - fius-source + dev mode: <repo>/.fius
 *   - fius-project: <project>/.fius
 *   - global-cli: ~/.fius
 */
function expandTemplateVars(config: unknown, context: TemplateContext): unknown {
    const result = JSON.parse(JSON.stringify(config));


    function walk(obj: unknown): unknown {
        if (typeof obj === 'string') {
            return expandString(obj, context);
        }
        if (Array.isArray(obj)) {
            return obj.map(walk);
        }
        if (obj !== null && typeof obj === 'object') {
            const result: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = walk(value);
            }
            return result;
        }
        return obj;
    }

    return walk(result);
}

/**
 * Expand template variables in a string value
 */
function expandString(str: string, context: TemplateContext): string {
    let result = str;
    let hasAgentDirExpansion = false;
    let hasProjectDirExpansion = false;

    if (/\${{\s*fius\.agent_dir\s*}}/.test(result)) {
        result = result.replace(/\${{\s*fius\.agent_dir\s*}}/g, context.agentDir);
        hasAgentDirExpansion = true;
    }

    if (/\${{\s*fius\.project_dir\s*}}/.test(result)) {
        result = result.replace(/\${{\s*fius\.project_dir\s*}}/g, context.projectDir);
        hasProjectDirExpansion = true;
    }

    if (hasAgentDirExpansion) {
        validateExpandedPath(str, result, context.agentDir, 'agent_dir');
    }
    if (hasProjectDirExpansion) {
        validateExpandedPath(str, result, context.projectDir, 'project_dir');
    }

    return result;
}

/**
 * Validate that template expansion doesn't allow path traversal
 */
function validateExpandedPath(
    original: string,
    expanded: string,
    rootDir: string,
    varName: string
): void {
    const resolved = path.resolve(expanded);
    const root = path.resolve(rootDir);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(
            `Security: Template expansion attempted to escape ${varName} directory.\n` +
                `Original: ${original}\n` +
                `Expanded: ${expanded}\n` +
                `Root: ${root}`
        );
    }
}

/**
 * Asynchronously loads and processes an agent configuration file.
 * This function handles file reading, YAML parsing, and template variable expansion.
 * Environment variable expansion is handled by the Zod schema during validation.
 *
 * Note: Path resolution should be done before calling this function using resolveConfigPath().
 *
 * @param configPath - Path to the configuration file (absolute or relative)
 * @param logger - logger instance for logging
 * @returns A Promise that resolves to the parsed `AgentConfig` object with template variables expanded
 * @throws {ConfigError} with FILE_NOT_FOUND if the configuration file does not exist
 * @throws {ConfigError} with FILE_READ_ERROR if file read fails (e.g., permissions issues)
 * @throws {ConfigError} with PARSE_ERROR if the content is not valid YAML or template expansion fails
 */
export async function loadAgentConfig(configPath: string, logger?: Logger): Promise<AgentConfig> {
    const absolutePath = path.resolve(configPath);

    try {
        await fs.access(absolutePath);
    } catch (_error) {
        throw ConfigError.fileNotFound(absolutePath);
    }

    let fileContent: string;
    try {
        fileContent = await fs.readFile(absolutePath, 'utf-8');
    } catch (error) {
        throw ConfigError.fileReadError(
            absolutePath,
            error instanceof Error ? error.message : String(error)
        );
    }

    let config: unknown;
    try {
        config = parseYaml(fileContent);
    } catch (error) {
        throw ConfigError.parseError(
            absolutePath,
            error instanceof Error ? error.message : String(error)
        );
    }

    try {
        const agentDir = path.dirname(absolutePath);
        const projectDir = getFiusPath('');
        const context: TemplateContext = { agentDir, projectDir };
        config = expandTemplateVars(config, context);
        logger?.debug(
            `Expanded template variables for agent in: ${agentDir}, project: ${projectDir}`
        );
    } catch (error) {
        throw ConfigError.parseError(
            absolutePath,
            `Template expansion failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    return config as AgentConfig;
}
