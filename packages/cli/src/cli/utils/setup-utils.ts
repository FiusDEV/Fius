import {
    findFiusProjectRoot,
    findProjectRegistryPathSync,
    globalPreferencesExist,
    loadGlobalPreferences,
    type GlobalPreferences,
} from '@fius/agent-management';
import { getExecutionContext } from '@fius/core';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const PROJECT_LOCAL_CODING_AGENT_RELATIVE_PATHS = [
    path.join('agents', 'coding-agent', 'coding-agent.yml'),
    path.join('agents', 'coding-agent', 'coding-agent.yaml'),
    'coding-agent.yml',
    'coding-agent.yaml',
    path.join('agents', 'coding-agent.yml'),
    path.join('agents', 'coding-agent.yaml'),
    path.join('src', 'fius', 'agents', 'coding-agent.yml'),
    path.join('src', 'fius', 'agents', 'coding-agent.yaml'),
] as const;

export function isFirstTimeUser(): boolean {
    return !globalPreferencesExist();
}

export interface SetupState {
    needsSetup: boolean;
    isFirstTime: boolean;
    apiKeyPending: boolean;
    baseURLPending: boolean;
    preferences: GlobalPreferences | null;
}

function hasProjectLocalStartupConfig(projectRoot: string): boolean {
    if (findProjectRegistryPathSync(projectRoot)) {
        return true;
    }

    return PROJECT_LOCAL_CODING_AGENT_RELATIVE_PATHS.some((relativePath) => {
        const absolutePath = path.join(projectRoot, relativePath);
        return existsSync(absolutePath) && statSync(absolutePath).isFile();
    });
}

export async function getSetupState(): Promise<SetupState> {
    const context = getExecutionContext();


    if (context === 'fius-source' && process.env.FIUS_DEV_MODE === 'true') {
        return {
            needsSetup: false,
            isFirstTime: false,
            apiKeyPending: false,
            baseURLPending: false,
            preferences: null,
        };
    }

    if (context === 'fius-project') {
        const projectRoot = findFiusProjectRoot();
        if (projectRoot && hasProjectLocalStartupConfig(projectRoot)) {
            return {
                needsSetup: false,
                isFirstTime: false,
                apiKeyPending: false,
                baseURLPending: false,
                preferences: null,
            };
        }
    }


    if (isFirstTimeUser()) {
        return {
            needsSetup: true,
            isFirstTime: true,
            apiKeyPending: false,
            baseURLPending: false,
            preferences: null,
        };
    }

    try {
        const preferences = await loadGlobalPreferences();

        if (!preferences.setup.completed) {
            return {
                needsSetup: true,
                isFirstTime: false,
                apiKeyPending: false,
                baseURLPending: false,
                preferences,
            };
        }

        if (!preferences.defaults.defaultAgent) {
            return {
                needsSetup: true,
                isFirstTime: false,
                apiKeyPending: false,
                baseURLPending: false,
                preferences,
            };
        }

        return {
            needsSetup: false,
            isFirstTime: false,
            apiKeyPending: preferences.setup.apiKeyPending ?? false,
            baseURLPending: preferences.setup.baseURLPending ?? false,
            preferences,
        };
    } catch (_error) {
        return {
            needsSetup: true,
            isFirstTime: false,
            apiKeyPending: false,
            baseURLPending: false,
            preferences: null,
        };
    }
}

export async function requiresSetup(): Promise<boolean> {
    const state = await getSetupState();
    return state.needsSetup;
}

export async function getSetupGuidanceMessage(): Promise<string> {
    if (isFirstTimeUser()) {
        return [
            "рџ‘‹ Welcome to Fius! Let's get you set up...",
            '',
            'рџљЂ Run `fius setup` to configure your AI preferences',
            '   вЂў Choose your AI provider (Google Gemini, OpenAI, etc.)',
            '   вЂў Set up your API keys',
            '   вЂў Configure your default agent',
            '',
            'рџ’Ў After setup, you can install agents with: `fius agents install <agent-name>`',
        ].join('\n');
    }


    return [
        'вљ пёЏ  Your Fius preferences need attention',
        '',
        'рџ”§ Run `fius setup` to fix your configuration',
        '   This will restore your AI provider settings and preferences',
    ].join('\n');
}