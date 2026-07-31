import * as p from '@clack/prompts';
import chalk from 'chalk';

type ProviderCategory = 'recommended' | 'local' | 'cloud' | 'gateway' | 'enterprise';

interface ProviderOption {
    value: string;
    label: string;
    hint: string;
    category: ProviderCategory;
    apiKeyUrl?: string;
    apiKeyPrefix?: string;
    apiKeyMinLength?: number;
    requiresBaseURL?: boolean;
    envVar: string;
    free?: boolean;
}

export const PROVIDER_OPTIONS: any[] = [];

export function getSupportedProvidersList(): string[] {
    return [];
}

export function isSupportedProvider(provider: string): boolean {
    return false;
}

export function getProviderDisplayName(provider: string): string {
    return provider;
}

export function getProviderEnvVar(provider: string): string {
    return '';
}

export function providerRequiresBaseURL(provider: string): boolean {
    return false;
}

export function getDefaultModel(provider: string): string {
    return '';
}

export async function selectProvider(): Promise<string | null> {
    return null;
}

export function validateApiKeyFormat(_provider: string, _apiKey: string): boolean {
    return true;
}

export function getProviderInstructions(_provider: string): { content: string; title: string } | null {
    return null;
}

export async function openApiKeyUrl(_provider: string): Promise<void> {
    return;
}

export function getProviderInfo(_provider: string): any {
    return undefined;
}

export function hasApiKeyConfigured(_provider: string): boolean {
    return false;
}