import { promises as fs } from 'fs';
import * as path from 'path';
import { parseDocument, stringify } from 'yaml';
import { loadAgentConfig } from './loader.js';
import { enrichAgentConfig } from './config-enrichment.js';
import {
    AgentConfigSchema,
    type AgentConfig,
    type ValidatedAgentConfig,
} from '@fius/agent-config';
import { FiusValidationError } from '@fius/core';
import { fail, zodToIssues } from '@fius/core';

/**
 * Input type for adding a file-based prompt
 */
export interface FilePromptInput {
    type: 'file';
    file: string;
    showInStarters?: boolean;
}

/**
 * Input type for adding an inline prompt
 */
export interface InlinePromptInput {
    type: 'inline';
    id: string;
    prompt: string;
    title?: string;
    description?: string;
    category?: string;
    priority?: number;
    showInStarters?: boolean;
}

export type PromptInput = FilePromptInput | InlinePromptInput;

/**
 * Updates an agent configuration file with partial updates.
 * Reads raw YAML, merges updates, enriches for validation, and writes back atomically.
 * Preserves comments, formatting, and environment variable placeholders.
 *
 * Note: The file is kept "raw" (no enriched paths written), but the returned config
 * is enriched and validated so it can be passed directly to agent.reload().
 *
 * This is a CLI/server concern - handles file I/O for config updates.
 * After calling this, you should call agent.reload() with the returned config.
 *
 * @param configPath Path to the agent configuration file
 * @param updates Partial configuration updates to apply
 * @returns The validated, enriched merged configuration (ready for agent.reload())
 * @throws FiusValidationError if validation fails
 * @throws Error if file operations fail
 *
 * @example
 * ```typescript
 * const newConfig = await updateAgentConfigFile('/path/to/agent.yml', {
 *   mcpServers: {
 *     ...currentConfig.mcpServers,
 *     newServer: { command: 'mcp-server', type: 'stdio' }
 *   }
 * });
 *
 * const reloadResult = await agent.reload(newConfig);
 * ```
 */
export async function updateAgentConfigFile(
    configPath: string,
    updates: Partial<AgentConfig>
): Promise<ValidatedAgentConfig> {
    const rawYaml = await fs.readFile(configPath, 'utf-8');

    const doc = parseDocument(rawYaml);
    const rawConfig = doc.toJSON() as Record<string, unknown>;

    const updatedRawConfig = { ...rawConfig, ...updates } as AgentConfig;

    const enrichedConfig = enrichAgentConfig(updatedRawConfig, configPath);

    const parsed = AgentConfigSchema.safeParse(enrichedConfig);
    if (!parsed.success) {
        const result = fail(zodToIssues(parsed.error, 'error'));
        throw new FiusValidationError(result.issues);
    }

    for (const [key, value] of Object.entries(updates)) {
        doc.set(key, value);
    }

    const yamlContent = String(doc);

    const tmpPath = `${configPath}.tmp`;
    await fs.writeFile(tmpPath, yamlContent, 'utf-8');
    await fs.rename(tmpPath, configPath);

    return parsed.data;
}

/**
 * Reloads an agent configuration from disk.
 * This is a CLI/server concern - handles file I/O for config loading.
 * After calling this, you should call agent.reloadConfig() with the returned config.
 *
 * @param configPath Path to the agent configuration file
 * @returns The loaded agent configuration
 * @throws ConfigError if file cannot be read or parsed
 *
 * @example
 * ```typescript
 * const newConfig = await reloadAgentConfigFromFile('/path/to/agent.yml');
 * const reloadResult = await agent.reloadConfig(newConfig);
 * if (reloadResult.restartRequired.length > 0) {
 *   await agent.restart();
 * }
 * ```
 */
export async function reloadAgentConfigFromFile(configPath: string): Promise<AgentConfig> {
    return await loadAgentConfig(configPath);
}

/**
 * Helper to write file atomically
 */
async function writeFileAtomic(configPath: string, content: string): Promise<void> {
    const tmpPath = `${configPath}.tmp`;
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, configPath);
}

/**
 * Finds the line range of a specific MCP server in the YAML file.
 * Returns the start and end line indices (inclusive) of the server block.
 */
function findMcpServerRange(
    lines: string[],
    serverName: string
): { startLine: number; endLine: number; indent: string } | null {
    let inMcpServersSection = false;
    let mcpServersIndent = '';
    let serverLevelIndent = -1;
    let serverIndent = '';
    let inTargetServer = false;
    let serverStartLine = -1;
    let serverEndLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const trimmed = line.trimStart();

        if (!trimmed || trimmed.startsWith('#')) {
            if (inTargetServer && serverStartLine >= 0) {
            }
            continue;
        }

        const currentIndent = line.slice(0, line.length - trimmed.length);
        const currentIndentLen = currentIndent.length;

        if (!inMcpServersSection && trimmed.startsWith('mcpServers:')) {
            inMcpServersSection = true;
            mcpServersIndent = currentIndent;
            continue;
        }

        if (inMcpServersSection) {
            if (currentIndentLen <= mcpServersIndent.length && trimmed.includes(':')) {
                if (inTargetServer && serverStartLine >= 0) {
                    return {
                        startLine: serverStartLine,
                        endLine: serverEndLine >= 0 ? serverEndLine : serverStartLine,
                        indent: serverIndent,
                    };
                }
                return null;
            }

            if (serverLevelIndent < 0 && currentIndentLen > mcpServersIndent.length) {
                serverLevelIndent = currentIndentLen;
            }

            if (serverLevelIndent >= 0 && currentIndentLen === serverLevelIndent) {
                const serverMatch = trimmed.match(/^([a-zA-Z0-9_-]+):(\s|$)/);
                if (serverMatch) {
                    const foundServerName = serverMatch[1];

                    if (inTargetServer && serverStartLine >= 0) {
                        return {
                            startLine: serverStartLine,
                            endLine: serverEndLine >= 0 ? serverEndLine : serverStartLine,
                            indent: serverIndent,
                        };
                    }

                    if (foundServerName === serverName) {
                        inTargetServer = true;
                        serverStartLine = i;
                        serverEndLine = i;
                        serverIndent = currentIndent;
                    } else {
                        inTargetServer = false;
                    }
                }
            } else if (inTargetServer && currentIndentLen > serverLevelIndent) {
                serverEndLine = i;
            }
        }
    }

    if (inTargetServer && serverStartLine >= 0) {
        return {
            startLine: serverStartLine,
            endLine: serverEndLine >= 0 ? serverEndLine : serverStartLine,
            indent: serverIndent,
        };
    }

    return null;
}

/**
 * Updates a specific field within an MCP server configuration.
 * Uses string manipulation to preserve all formatting, comments, and structure.
 *
 * @param configPath Path to the agent configuration file
 * @param serverName Name of the MCP server to update
 * @param field Field name to update (e.g., 'enabled')
 * @param value New value for the field
 * @returns true if the field was updated, false if server not found
 *
 * @example
 * ```typescript
 * // Toggle enabled state
 * await updateMcpServerField('/path/to/agent.yml', 'filesystem', 'enabled', true);
 * ```
 */
export async function updateMcpServerField(
    configPath: string,
    serverName: string,
    field: string,
    value: boolean | string | number
): Promise<boolean> {
    const rawYaml = await fs.readFile(configPath, 'utf-8');
    const lines = rawYaml.split('\n');

    const serverRange = findMcpServerRange(lines, serverName);
    if (!serverRange) {
        return false;
    }

    const formattedValue =
        typeof value === 'string' ? (value.includes(':') ? `"${value}"` : value) : String(value);

    const fieldIndent = serverRange.indent + '  ';
    const fieldPrefix = `${fieldIndent}${field}:`;
    let fieldLineIndex = -1;

    for (let i = serverRange.startLine + 1; i <= serverRange.endLine; i++) {
        const line = lines[i] ?? '';
        if (line.startsWith(fieldPrefix)) {
            fieldLineIndex = i;
            break;
        }
    }

    if (fieldLineIndex >= 0) {
        lines[fieldLineIndex] = `${fieldIndent}${field}: ${formattedValue}`;
    } else {
        const newFieldLine = `${fieldIndent}${field}: ${formattedValue}`;
        lines.splice(serverRange.startLine + 1, 0, newFieldLine);
    }

    await writeFileAtomic(configPath, lines.join('\n'));
    return true;
}

/**
 * Removes an MCP server from the agent configuration file.
 * Uses string manipulation to preserve all formatting, comments, and structure.
 *
 * @param configPath Path to the agent configuration file
 * @param serverName Name of the MCP server to remove
 * @returns true if the server was removed, false if not found
 *
 * @example
 * ```typescript
 * await removeMcpServerFromConfig('/path/to/agent.yml', 'filesystem');
 * ```
 */
export async function removeMcpServerFromConfig(
    configPath: string,
    serverName: string
): Promise<boolean> {
    const rawYaml = await fs.readFile(configPath, 'utf-8');
    const lines = rawYaml.split('\n');

    const serverRange = findMcpServerRange(lines, serverName);
    if (!serverRange) {
        return false;
    }

    lines.splice(serverRange.startLine, serverRange.endLine - serverRange.startLine + 1);

    await writeFileAtomic(configPath, lines.join('\n'));
    return true;
}

/**
 * Finds the end position of the prompts array in the YAML file.
 * Returns the line index where we should insert a new prompt entry.
 */
function findPromptsArrayEndPosition(
    lines: string[]
): { insertIndex: number; indent: string } | null {
    let inPromptsSection = false;
    let promptsIndent = '';
    let lastPromptEntryEnd = -1;
    let itemIndent = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const trimmed = line.trimStart();

        if (trimmed.startsWith('prompts:')) {
            inPromptsSection = true;
            const idx = line.indexOf('prompts:');
            promptsIndent = idx >= 0 ? line.slice(0, idx) : '';
            continue;
        }

        if (inPromptsSection) {
            if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
                const currentIndent = line.slice(0, line.length - trimmed.length);
                if (currentIndent.length <= promptsIndent.length && trimmed.includes(':')) {
                    return { insertIndex: lastPromptEntryEnd + 1, indent: itemIndent };
                }
            }

            if (trimmed.startsWith('- ')) {
                const dashIdx = line.indexOf('-');
                itemIndent = dashIdx >= 0 ? line.slice(0, dashIdx) : '';
                lastPromptEntryEnd = i;
            } else if (lastPromptEntryEnd >= 0 && trimmed && !trimmed.startsWith('#')) {
                lastPromptEntryEnd = i;
            }
        }
    }

    if (inPromptsSection && lastPromptEntryEnd >= 0) {
        return { insertIndex: lastPromptEntryEnd + 1, indent: itemIndent };
    }

    return null;
}

/**
 * Adds a prompt to the agent configuration file.
 * Uses string manipulation to preserve all formatting, comments, and structure.
 * Only modifies the prompts array by appending a new entry.
 *
 * @param configPath Path to the agent configuration file
 * @param prompt The prompt to add (file or inline)
 * @throws Error if file operations fail
 *
 * @example
 * ```typescript
 * // Add a file-based prompt
 * await addPromptToAgentConfig('/path/to/agent.yml', {
 *   type: 'file',
 *   file: '${{fius.agent_dir}}/prompts/my-prompt.md'
 * });
 * ```
 */
export async function addPromptToAgentConfig(
    configPath: string,
    prompt: PromptInput
): Promise<void> {
    const rawYaml = await fs.readFile(configPath, 'utf-8');
    const lines = rawYaml.split('\n');

    const position = findPromptsArrayEndPosition(lines);

    if (position) {
        const promptYaml = stringify([prompt], { indent: 2, lineWidth: 0 }).trim();
        const indentedPrompt = promptYaml
            .split('\n')
            .map((line) => position.indent + line)
            .join('\n');

        lines.splice(position.insertIndex, 0, indentedPrompt);
    } else {
        const promptYaml = stringify({ prompts: [prompt] }, { indent: 2, lineWidth: 0 }).trim();
        lines.push('', promptYaml);
    }

    await writeFileAtomic(configPath, lines.join('\n'));
}

/**
 * Finds the line ranges of prompt entries in the prompts array.
 * Each entry is a range [startLine, endLine] (inclusive).
 */
function findPromptEntryRanges(
    lines: string[]
): Array<{ startLine: number; endLine: number; content: string }> {
    const entries: Array<{ startLine: number; endLine: number; content: string }> = [];
    let inPromptsSection = false;
    let promptsIndent = '';
    let currentEntryStart = -1;
    let currentEntryEnd = -1;
    let itemIndent = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const trimmed = line.trimStart();

        if (!inPromptsSection && trimmed.startsWith('prompts:')) {
            inPromptsSection = true;
            const idx = line.indexOf('prompts:');
            promptsIndent = idx >= 0 ? line.slice(0, idx) : '';
            continue;
        }

        if (inPromptsSection) {
            if (trimmed && !trimmed.startsWith('-')) {
                const currentIndent = line.slice(0, line.length - trimmed.length);
                if (currentIndent.length <= promptsIndent.length && trimmed.includes(':')) {
                    if (currentEntryStart >= 0) {
                        entries.push({
                            startLine: currentEntryStart,
                            endLine: currentEntryEnd >= 0 ? currentEntryEnd : currentEntryStart,
                            content: lines
                                .slice(
                                    currentEntryStart,
                                    (currentEntryEnd >= 0 ? currentEntryEnd : currentEntryStart) + 1
                                )
                                .join('\n'),
                        });
                    }
                    inPromptsSection = false;
                    break;
                }
                if (trimmed.startsWith('#') && currentIndent.length <= promptsIndent.length) {
                    if (currentEntryStart >= 0) {
                        entries.push({
                            startLine: currentEntryStart,
                            endLine: currentEntryEnd >= 0 ? currentEntryEnd : currentEntryStart,
                            content: lines
                                .slice(
                                    currentEntryStart,
                                    (currentEntryEnd >= 0 ? currentEntryEnd : currentEntryStart) + 1
                                )
                                .join('\n'),
                        });
                    }
                    inPromptsSection = false;
                    break;
                }
            }

            if (trimmed.startsWith('- ')) {
                if (currentEntryStart >= 0) {
                    entries.push({
                        startLine: currentEntryStart,
                        endLine: currentEntryEnd >= 0 ? currentEntryEnd : currentEntryStart,
                        content: lines
                            .slice(
                                currentEntryStart,
                                (currentEntryEnd >= 0 ? currentEntryEnd : currentEntryStart) + 1
                            )
                            .join('\n'),
                    });
                }
                currentEntryStart = i;
                currentEntryEnd = i;
                const dashIdx = line.indexOf('-');
                itemIndent = dashIdx >= 0 ? line.slice(0, dashIdx) : '';
            } else if (currentEntryStart >= 0 && trimmed) {
                const lineIndent = line.slice(0, line.length - trimmed.length);
                if (lineIndent.length > itemIndent.length) {
                    currentEntryEnd = i;
                }
            }
        }
    }

    if (inPromptsSection && currentEntryStart >= 0) {
        entries.push({
            startLine: currentEntryStart,
            endLine: currentEntryEnd >= 0 ? currentEntryEnd : currentEntryStart,
            content: lines
                .slice(
                    currentEntryStart,
                    (currentEntryEnd >= 0 ? currentEntryEnd : currentEntryStart) + 1
                )
                .join('\n'),
        });
    }

    return entries;
}

/**
 * Removes a prompt from the agent configuration file.
 * Uses string manipulation to preserve all formatting, comments, and structure.
 * Only removes the matching prompt entry lines.
 *
 * For file prompts: matches by file path pattern
 * For inline prompts: matches by id
 *
 * @param configPath Path to the agent configuration file
 * @param matcher Criteria to match prompts to remove
 * @throws Error if file operations fail
 *
 * @example
 * ```typescript
 * // Remove by file path pattern
 * await removePromptFromAgentConfig('/path/to/agent.yml', {
 *   type: 'file',
 *   filePattern: '/prompts/my-prompt.md'
 * });
 *
 * // Remove by inline prompt id
 * await removePromptFromAgentConfig('/path/to/agent.yml', {
 *   type: 'inline',
 *   id: 'quick-help'
 * });
 * ```
 */
export async function removePromptFromAgentConfig(
    configPath: string,
    matcher: { type: 'file'; filePattern: string } | { type: 'inline'; id: string }
): Promise<void> {
    const rawYaml = await fs.readFile(configPath, 'utf-8');
    const lines = rawYaml.split('\n');

    const entries = findPromptEntryRanges(lines);
    if (entries.length === 0) {
        return;
    }

    const entriesToRemove: Array<{ startLine: number; endLine: number }> = [];

    for (const entry of entries) {
        if (matcher.type === 'file') {
            if (
                entry.content.includes('type: file') &&
                entry.content.includes(matcher.filePattern)
            ) {
                entriesToRemove.push(entry);
            }
        } else if (matcher.type === 'inline') {
            if (
                entry.content.includes('type: inline') &&
                entry.content.includes(`id: ${matcher.id}`)
            ) {
                entriesToRemove.push(entry);
            }
        }
    }

    if (entriesToRemove.length === 0) {
        return;
    }

    const sortedEntries = [...entriesToRemove].sort((a, b) => b.startLine - a.startLine);
    for (const entry of sortedEntries) {
        lines.splice(entry.startLine, entry.endLine - entry.startLine + 1);
    }

    await writeFileAtomic(configPath, lines.join('\n'));
}

/**
 * Prompt metadata expected from core's PromptInfo
 */
export interface PromptMetadataForDeletion {
    name: string;
    metadata?: {
        filePath?: string | undefined;
        originalId?: string | undefined;
    };
}

/**
 * Result of prompt deletion operation
 */
export interface PromptDeletionResult {
    success: boolean;
    deletedFile: boolean;
    removedFromConfig: boolean;
    error?: string;
}

/**
 * Higher-level function to delete a prompt using its metadata.
 * Handles both file-based and inline prompts, including file deletion.
 *
 * @param configPath - Path to the agent config file
 * @param prompt - Prompt metadata (name and optional filePath in metadata)
 * @param options - Options for deletion behavior
 * @returns Result indicating what was deleted
 *
 * @example
 * ```typescript
 * // Delete a file-based prompt (deletes file and removes from config)
 * await deletePromptByMetadata('/path/to/agent.yml', {
 *   name: 'test-prompt',
 *   metadata: { filePath: '/path/to/prompts/test-prompt.md' }
 * });
 *
 * // Delete an inline prompt (only removes from config)
 * await deletePromptByMetadata('/path/to/agent.yml', {
 *   name: 'quick-help'
 * });
 * ```
 */
export async function deletePromptByMetadata(
    configPath: string,
    prompt: PromptMetadataForDeletion,
    options: { deleteFile?: boolean } = { deleteFile: true }
): Promise<PromptDeletionResult> {
    const result: PromptDeletionResult = {
        success: false,
        deletedFile: false,
        removedFromConfig: false,
    };

    const filePath = prompt.metadata?.filePath;

    try {
        if (filePath) {
            const fileName = path.basename(filePath);

            const isSharedPrompt =
                filePath.includes('/commands/') || filePath.includes('/.fius/commands/');

            if (!isSharedPrompt) {
                await removePromptFromAgentConfig(configPath, {
                    type: 'file',
                    filePattern: `/prompts/${fileName}`,
                });
                result.removedFromConfig = true;
            }

            if (options.deleteFile) {
                try {
                    await fs.unlink(filePath);
                    result.deletedFile = true;
                } catch {
                }
            }

            result.success = true;
        } else {
            const promptId = prompt.metadata?.originalId || prompt.name;
            await removePromptFromAgentConfig(configPath, {
                type: 'inline',
                id: promptId,
            });
            result.removedFromConfig = true;
            result.success = true;
        }
    } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
    }

    return result;
}
