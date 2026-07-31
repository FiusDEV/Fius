import type { AgentConfig, FiusHostContext, FiusImage } from '@fius/agent-config';
import {
    AgentConfigSchema,
    applyImageDefaults,
    cleanNullValues,
    loadImage,
    resolveServicesFromConfig,
    toFiusAgentOptions,
} from '@fius/agent-config';
import {
    FiusAgent,
    logger,
    type FiusAgentConfigInput,
    type InitializeServicesOptions,
} from '@fius/core';
import { enrichAgentConfig, type EnrichAgentConfigOptions } from './config/index.js';
import { BUILTIN_TOOL_NAMES } from '@fius/tools-builtins';

type CreateFiusAgentFromConfigOptions = {
    config: AgentConfig;
    configPath?: string | undefined;
    enrichOptions?: EnrichAgentConfigOptions | undefined;
    agentIdOverride?: string | undefined;
    imageNameOverride?: string | undefined;
    agentContext?: 'subagent' | undefined;
    hostContext?: FiusHostContext | undefined;
    overrides?: InitializeServicesOptions | undefined;
    runtimeOverrides?: Pick<FiusAgentConfigInput, 'usageScopeId'> | undefined;
};

async function loadImageForConfig(options: {
    config: AgentConfig;
    imageNameOverride?: string | undefined;
}): Promise<{ imageName: string; image: FiusImage }> {
    const { config, imageNameOverride } = options;
    const imageName =
        imageNameOverride ?? config.image ?? process.env.FIUS_IMAGE ?? '@fius/image-local';

    try {
        const image = await loadImage(imageName);
        logger.debug(`Loaded image: ${imageName}`);
        return { imageName, image };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load image '${imageName}': ${message}`);
    }
}

function applySubAgentToolConstraints(config: AgentConfig): AgentConfig {
    const tools = config.tools;
    if (!Array.isArray(tools)) {
        return config;
    }

    const disabledBuiltinTools = new Set(['ask_user', 'invoke_skill']);

    const constrainedTools = tools
        .filter((entry) => entry.type !== 'agent-spawner')
        .map((entry) => {
            if (entry.type !== 'builtin-tools' || entry.enabled === false) {
                return entry;
            }

            const maybeEnabledTools = (entry as { enabledTools?: unknown }).enabledTools;
            const enabledTools = Array.isArray(maybeEnabledTools)
                ? (maybeEnabledTools as string[])
                : [...BUILTIN_TOOL_NAMES];

            const filteredEnabledTools = enabledTools.filter((t) => !disabledBuiltinTools.has(t));

            return { ...entry, enabledTools: filteredEnabledTools };
        })
        .filter((entry) => {
            if (entry.type !== 'builtin-tools') {
                return true;
            }

            const maybeEnabledTools = (entry as { enabledTools?: unknown }).enabledTools;
            return !Array.isArray(maybeEnabledTools) || maybeEnabledTools.length > 0;
        });

    return { ...config, tools: constrainedTools };
}

export async function createFiusAgentFromConfig(
    options: CreateFiusAgentFromConfigOptions
): Promise<FiusAgent> {
    const { configPath, enrichOptions, agentIdOverride, hostContext, overrides, runtimeOverrides } =
        options;

    const cleanedConfig = cleanNullValues(options.config);
    const { image } = await loadImageForConfig({
        config: cleanedConfig,
        imageNameOverride: options.imageNameOverride,
    });

    let configWithImageDefaults = applyImageDefaults(cleanedConfig, image.defaults);
    if (options.agentContext === 'subagent') {
        configWithImageDefaults = applySubAgentToolConstraints(configWithImageDefaults);
    }

    const enrichedConfig = enrichAgentConfig(
        configWithImageDefaults,
        configPath,
        enrichOptions ?? {}
    );
    if (agentIdOverride !== undefined) {
        enrichedConfig.agentId = agentIdOverride;
    }

    const validatedConfig = AgentConfigSchema.parse(enrichedConfig);
    const resolvedHostContext = {
        ...(hostContext ?? {}),
        ...(enrichOptions?.workspaceRoot ? { workspaceRoot: enrichOptions.workspaceRoot } : {}),
    };
    const services = await resolveServicesFromConfig(validatedConfig, image, resolvedHostContext);
    const mergedOverrides: InitializeServicesOptions | undefined = overrides
        ? { ...overrides }
        : undefined;

    return new FiusAgent(
        toFiusAgentOptions({
            config: validatedConfig,
            services,
            image,
            hostContext: resolvedHostContext,
            ...(runtimeOverrides ? { runtimeOverrides } : {}),
            overrides: mergedOverrides,
        })
    );
}
