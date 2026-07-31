import type { LLMProvider } from '@fius/llm';
import type { TuiAgentBackend } from '../agent-backend.js';

export interface TuiShutdownHandle {
    stop?: (() => Promise<void>) | undefined;
}

export interface TuiAuthConfig {
    token?: string | undefined;
    refreshToken?: string | undefined;
    userId?: string | undefined;
    email?: string | undefined;
    expiresAt?: number | undefined;
    createdAt: number;
    fiusApiKey?: string | undefined;
    fiusKeyId?: string | undefined;
    fiusApiKeySource?: 'provisioned' | 'user-supplied' | undefined;
}

export interface TuiDeviceApiKeyLoginResult {
    fiusApiKey: string;
    fiusKeyId: string;
    fiusKeyDisplay: string;
}

export interface TuiDeviceLoginPrompt {
    userCode: string;
    verificationUrl: string;
    verificationUrlComplete: string | null;
    expiresIn: number;
}

export type TuiFiusApiKeyProvisionStatusLevel = 'info' | 'success' | 'warning' | 'error';

export interface TuiFiusApiKeyProvisionStatus {
    level: TuiFiusApiKeyProvisionStatusLevel;
    message: string;
}

export interface TuiPersistedLoginResult {
    email?: string | undefined;
    userId?: string | undefined;
    keyId?: string | undefined;
    hasFiusApiKey: boolean;
}

export interface TuiRuntimeServices {
    registerGracefulShutdown?: (
        getAgent: () => TuiShutdownHandle,
        options: { inkMode: boolean }
    ) => void;
    capture?: (event: string, properties?: Record<string, unknown>) => void;
    applyLayeredEnvironmentLoading?: () => Promise<void>;
    getProviderDisplayName?: (provider: LLMProvider | string) => string;
    isValidApiKeyFormat?: (apiKey: string, provider: LLMProvider) => boolean;
    getProviderInstructions?: (
        provider: LLMProvider
    ) => { title: string; content: string; url?: string | undefined } | null;
    performDeviceCodeLogin?: (options?: {
        signal?: AbortSignal | undefined;
        onPrompt?: ((prompt: TuiDeviceLoginPrompt) => void) | undefined;
    }) => Promise<TuiDeviceApiKeyLoginResult>;
    persistDeviceApiKeyLoginResult?: (
        result: TuiDeviceApiKeyLoginResult
    ) => Promise<TuiPersistedLoginResult>;
    ensureFiusApiKeyForAuthToken?: (
        authToken: string,
        options?: {
            onStatus?: ((status: TuiFiusApiKeyProvisionStatus) => void) | undefined;
        }
    ) => Promise<{ fiusApiKey: string; keyId: string | null } | null>;
    loadAuth?: () => Promise<TuiAuthConfig | null>;
    storeAuth?: (config: TuiAuthConfig) => Promise<void>;
    removeAuth?: () => Promise<void>;
    removeFiusApiKeyFromEnv?: (options?: {
        expectedValue?: string;
    }) => Promise<{ removed: boolean; targetEnvPath: string }>;
    isUsingFiusCredits?: () => Promise<boolean>;
    canUseFiusProvider?: () => Promise<boolean>;
    buildFiusBillingUrl?: (options: { creditsUsd: number }) => string;
    openFiusBillingPage?: (options: { url?: string | undefined }) => Promise<void>;
    startWebServer?: (options?: { port?: number }) => Promise<{ url: string }>;
}

let runtimeServices: TuiRuntimeServices = {};

export function setTuiRuntimeServices(adapter: TuiRuntimeServices): void {
    runtimeServices = { ...adapter };
}

export function getTuiRuntimeServices(): TuiRuntimeServices {
    return runtimeServices;
}

function missingHostMethod(methodName: string): Error {
    return new Error(`TUI runtime services missing required method: ${methodName}`);
}

export function registerGracefulShutdown(
    getAgent: () => TuiAgentBackend,
    options: { inkMode: boolean }
): void {
    runtimeServices.registerGracefulShutdown?.(getAgent, options);
}

export function captureAnalytics(event: string, properties?: Record<string, unknown>): void {
    runtimeServices.capture?.(event, properties);
}

export async function applyLayeredEnvironmentLoading(): Promise<void> {
    if (runtimeServices.applyLayeredEnvironmentLoading) {
        await runtimeServices.applyLayeredEnvironmentLoading();
    }
}

export function getProviderDisplayName(provider: LLMProvider | string): string {
    return runtimeServices.getProviderDisplayName?.(provider) ?? String(provider);
}

export function isValidApiKeyFormat(apiKey: string, provider: LLMProvider): boolean {
    return runtimeServices.isValidApiKeyFormat?.(apiKey, provider) ?? apiKey.trim().length > 0;
}

export function getProviderInstructions(provider: LLMProvider): {
    title: string;
    content: string;
    url?: string | undefined;
} | null {
    return runtimeServices.getProviderInstructions?.(provider) ?? null;
}

export async function performDeviceCodeLogin(options?: {
    signal?: AbortSignal | undefined;
    onPrompt?: ((prompt: TuiDeviceLoginPrompt) => void) | undefined;
}): Promise<TuiDeviceApiKeyLoginResult> {
    if (!runtimeServices.performDeviceCodeLogin) {
        throw missingHostMethod('performDeviceCodeLogin');
    }
    return runtimeServices.performDeviceCodeLogin(options);
}

export async function persistDeviceApiKeyLoginResult(
    result: TuiDeviceApiKeyLoginResult
): Promise<TuiPersistedLoginResult> {
    if (!runtimeServices.persistDeviceApiKeyLoginResult) {
        throw missingHostMethod('persistDeviceApiKeyLoginResult');
    }
    return runtimeServices.persistDeviceApiKeyLoginResult(result);
}

export async function ensureFiusApiKeyForAuthToken(
    authToken: string,
    options?: { onStatus?: ((status: TuiFiusApiKeyProvisionStatus) => void) | undefined }
): Promise<{ fiusApiKey: string; keyId: string | null } | null> {
    if (!runtimeServices.ensureFiusApiKeyForAuthToken) {
        throw missingHostMethod('ensureFiusApiKeyForAuthToken');
    }
    return runtimeServices.ensureFiusApiKeyForAuthToken(authToken, options);
}

export async function loadAuth(): Promise<TuiAuthConfig | null> {
    if (!runtimeServices.loadAuth) {
        throw missingHostMethod('loadAuth');
    }
    return runtimeServices.loadAuth();
}

export async function storeAuth(config: TuiAuthConfig): Promise<void> {
    if (!runtimeServices.storeAuth) {
        throw missingHostMethod('storeAuth');
    }
    await runtimeServices.storeAuth(config);
}

export async function removeAuth(): Promise<void> {
    if (!runtimeServices.removeAuth) {
        throw missingHostMethod('removeAuth');
    }
    await runtimeServices.removeAuth();
}

export async function removeFiusApiKeyFromEnv(options?: {
    expectedValue?: string;
}): Promise<{ removed: boolean; targetEnvPath: string }> {
    if (!runtimeServices.removeFiusApiKeyFromEnv) {
        throw missingHostMethod('removeFiusApiKeyFromEnv');
    }
    return runtimeServices.removeFiusApiKeyFromEnv(options);
}

export async function isUsingFiusCredits(): Promise<boolean> {
    if (!runtimeServices.isUsingFiusCredits) {
        throw missingHostMethod('isUsingFiusCredits');
    }
    return runtimeServices.isUsingFiusCredits();
}

export async function canUseFiusProvider(): Promise<boolean> {
    if (!runtimeServices.canUseFiusProvider) {
        throw missingHostMethod('canUseFiusProvider');
    }
    return runtimeServices.canUseFiusProvider();
}

export function buildFiusBillingUrl(options: { creditsUsd: number }): string {
    if (!runtimeServices.buildFiusBillingUrl) {
        throw missingHostMethod('buildFiusBillingUrl');
    }
    return runtimeServices.buildFiusBillingUrl(options);
}

export async function openFiusBillingPage(options: { url?: string | undefined }): Promise<void> {
    if (!runtimeServices.openFiusBillingPage) {
        throw missingHostMethod('openFiusBillingPage');
    }
    return runtimeServices.openFiusBillingPage(options);
}
