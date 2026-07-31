import * as handlers from './in-built-prompts.js';
import { DynamicContributorContext } from './types.js';


export type DynamicPromptGenerator = (context: DynamicContributorContext) => Promise<string>;

export const PROMPT_GENERATOR_SOURCES = ['date', 'env', 'resources', 'buildMode'] as const;

export type PromptGeneratorSource = (typeof PROMPT_GENERATOR_SOURCES)[number];

export const PROMPT_GENERATOR_REGISTRY: Record<PromptGeneratorSource, DynamicPromptGenerator> = {
    date: handlers.getCurrentDate,
    env: handlers.getEnvironmentInfo,
    resources: handlers.getResourceData,
    buildMode: handlers.getBuildModeInfo,
};

export function getPromptGenerator(
    source: PromptGeneratorSource
): DynamicPromptGenerator | undefined {
    return PROMPT_GENERATOR_REGISTRY[source];
}
