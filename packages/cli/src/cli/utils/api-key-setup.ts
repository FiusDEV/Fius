import * as p from '@clack/prompts';
import chalk from 'chalk';
import type { LLMProvider } from '@fiusdev/llm';

export interface ApiKeySetupResult {
    success: boolean;
    apiKey?: string;
    cancelled?: boolean;
    skipped?: boolean;
    error?: string;
    action?: 'login' | 'setup' | 'skip' | 'cancel';
}

export async function interactiveApiKeySetup(
    _provider: LLMProvider,
    _options?: { skipIfKeyExists?: boolean; exitOnCancel?: boolean; model?: string; skipVerification?: boolean }
): Promise<ApiKeySetupResult> {
    return { success: false, skipped: true, action: 'skip' };
}

export async function promptForPendingApiKey(
    _provider: LLMProvider,
    _model?: string | { exitOnCancel?: boolean }
): Promise<ApiKeySetupResult> {
    return { success: false, skipped: true, action: 'skip' };
}

export function hasApiKeyConfigured(_provider: LLMProvider): boolean {
    return false;
}