import { promises as fs } from 'fs';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import * as path from 'path';
import type { AgentConfig } from '@fiusdev/agent-config';
import type { LLMProvider } from '@fiusdev/llm';
import { type GlobalPreferences } from './preferences/schemas.js';
import { logger } from '@fiusdev/core';
import { ConfigError } from './config/index.js';

export interface LLMOverrides {
    provider?: LLMProvider;
    model?: string;
    apiKey?: string;
    baseURL?: string;
}

/**
 * Asynchronously writes the given agent configuration object to a YAML file.
 * This function handles the serialization of the config object to YAML format
 * and writes it to the specified file path.
 *
 * @param configPath - Path where the configuration file should be written (absolute or relative)
 * @param config - The `AgentConfig` object to be written to the file
 * @returns A Promise that resolves when the file has been successfully written
 * @throws {ConfigError} with FILE_WRITE_ERROR if an error occurs during YAML stringification or file writing
 */
export async function writeConfigFile(configPath: string, config: AgentConfig): Promise<void> {
    const absolutePath = path.resolve(configPath);

    try {
        const yamlContent = stringifyYaml(config, { indent: 2 });

        await fs.writeFile(absolutePath, yamlContent, 'utf-8');

        logger.debug(`Wrote fius config to: ${absolutePath}`);
    } catch (error: unknown) {
        throw ConfigError.fileWriteError(
            absolutePath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Write global LLM preferences to an agent config file
 * @param configPath Absolute path to agent configuration file
 * @param preferences Global preferences to write
 * @param overrides Optional CLI overrides
 * @throws FiusRuntimeError for write failures
 */
export async function writeLLMPreferences(
    configPath: string,
    preferences: GlobalPreferences,
    overrides?: LLMOverrides
): Promise<void> {
    logger.debug(`Writing LLM preferences to: ${configPath}`, {
        provider: overrides?.provider ?? preferences.llm.provider,
        model: overrides?.model ?? preferences.llm.model,
        hasApiKeyOverride: Boolean(overrides?.apiKey),
        hasPreferenceApiKey: Boolean(preferences.llm.apiKey),
    });

    logger.debug(`Reading config file: ${configPath}`);
    let fileContent: string;
    try {
        fileContent = await fs.readFile(configPath, 'utf-8');
        logger.debug(`Successfully read config file (${fileContent.length} chars)`);
    } catch (error) {
        logger.error(`Failed to read config file: ${configPath}`, { error });
        throw ConfigError.fileReadError(
            configPath,
            error instanceof Error ? error.message : String(error)
        );
    }
    let doc;
    try {
        doc = parseDocument(fileContent);
        if (doc.errors && doc.errors.length > 0) {
            throw new Error(doc.errors.map((e) => e.message).join('; '));
        }
        const config = doc.toJS() as AgentConfig;
        logger.debug(`Successfully parsed YAML config`, {
            hasLlmSection: Boolean(config.llm),
            existingProvider: config.llm?.provider,
            existingModel: config.llm?.model,
        });
    } catch (error) {
        logger.error(`Failed to parse YAML config: ${configPath}`, { error });
        throw ConfigError.parseError(
            configPath,
            error instanceof Error ? error.message : String(error)
        );
    }

    const provider = overrides?.provider ?? preferences.llm.provider;
    const model = overrides?.model ?? preferences.llm.model;
    const apiKey = overrides?.apiKey ?? preferences.llm.apiKey;
    const baseURL = overrides?.baseURL ?? preferences.llm.baseURL;

    logger.debug(`Applying LLM preferences`, {
        finalProvider: provider,
        finalModel: model,
        hasApiKey: Boolean(apiKey),
        hasBaseURL: Boolean(baseURL),
        source: overrides ? 'CLI overrides + preferences' : 'preferences only',
    });

    let llmNode = doc.get('llm');
    if (!llmNode || typeof llmNode !== 'object') {
        const llmConfig: Record<string, string> = { provider, model };
        if (apiKey) {
            llmConfig.apiKey = apiKey;
        }
        if (baseURL) {
            llmConfig.baseURL = baseURL;
        }
        doc.set('llm', llmConfig);
    } else {
        doc.setIn(['llm', 'provider'], provider);
        doc.setIn(['llm', 'model'], model);
        if (apiKey) {
            doc.setIn(['llm', 'apiKey'], apiKey);
        } else {
            doc.deleteIn(['llm', 'apiKey']);
        }
        if (baseURL) {
            doc.setIn(['llm', 'baseURL'], baseURL);
        } else {
            doc.deleteIn(['llm', 'baseURL']);
        }
    }

    await fs.writeFile(configPath, doc.toString(), 'utf-8');

    logger.info(`✓ Applied preferences to: ${path.basename(configPath)} (${provider}/${model})`);
}

/**
 * Write preferences to an installed agent (file or directory)
 * @param installedPath Path to installed agent file or directory
 * @param preferences Global preferences to write
 * @param overrides Optional CLI overrides
 */
export async function writePreferencesToAgent(
    installedPath: string,
    preferences: GlobalPreferences,
    overrides?: LLMOverrides
): Promise<void> {
    let stat;
    try {
        stat = await fs.stat(installedPath);
    } catch (error) {
        throw ConfigError.fileReadError(
            installedPath,
            error instanceof Error ? error.message : String(error)
        );
    }

    if (stat.isFile()) {
        if (installedPath.endsWith('.yml') || installedPath.endsWith('.yaml')) {
            await writeLLMPreferences(installedPath, preferences, overrides);
            logger.info(`✓ Applied preferences to: ${path.basename(installedPath)}`, null, 'green');
        } else {
            logger.warn(`Skipping non-YAML file: ${installedPath}`, null, 'yellow');
        }
    } else if (stat.isDirectory()) {
        await writePreferencesToDirectory(installedPath, preferences, overrides);
    } else {
        throw ConfigError.fileReadError(installedPath, 'Path is neither a file nor directory');
    }
}

/**
 * Write preferences to all agent configs in a directory
 * @param installedDir Directory containing agent configs
 * @param preferences Global preferences to write
 * @param overrides Optional CLI overrides
 */
async function writePreferencesToDirectory(
    installedDir: string,
    preferences: GlobalPreferences,
    overrides?: LLMOverrides
): Promise<void> {
    const configFiles = await findAgentConfigFiles(installedDir);

    if (configFiles.length === 0) {
        logger.warn(`No YAML config files found in: ${installedDir}`);
        return;
    }

    let successCount = 0;
    const oldProvider = preferences.llm.provider;
    const oldModel = preferences.llm.model;
    const newProvider = overrides?.provider ?? preferences.llm.provider;
    const newModel = overrides?.model ?? preferences.llm.model;

    for (const configPath of configFiles) {
        try {
            await writeLLMPreferences(configPath, preferences, overrides);
            logger.debug(`Applied preferences to: ${path.relative(installedDir, configPath)}`);
            successCount++;
        } catch (error) {
            logger.warn(
                `Failed to write preferences to ${configPath}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    logger.info(
        `✓ Applied preferences to ${successCount}/${configFiles.length} config files (${oldProvider}→${newProvider}, ${oldModel}→${newModel})`
    );
}

/**
 * Find all agent configuration files in a directory

 */
async function findAgentConfigFiles(dir: string): Promise<string[]> {
    const configFiles: string[] = [];

    async function walkDir(currentDir: string): Promise<void> {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                if (!['docs', 'data'].includes(entry.name)) {
                    await walkDir(fullPath);
                }
            } else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
                configFiles.push(fullPath);
            }
        }
    }

    await walkDir(dir);
    return configFiles;
}
