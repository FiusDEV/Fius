/**
 * LLM Model Registry
 *
 * Providers and models are loaded dynamically from the Fius platform API.
 * This module provides minimal interfaces for type safety.
 */

import { type LLMProvider, type SupportedFileType, type TokenUsage } from '../types.js';

export const DEFAULT_MAX_INPUT_TOKENS = 128000;

export interface LlmCatalogLogger {
    debug(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export type LlmCatalogErrorCode = 'MODEL_UNKNOWN';

export class LlmCatalogError extends Error {
    readonly code: LlmCatalogErrorCode;

    constructor(code: LlmCatalogErrorCode, message: string) {
        super(message);
        this.name = 'LlmCatalogError';
        this.code = code;
    }
}

export interface ModelInfo {
    name: string;
    displayName?: string | undefined;
    maxInputTokens?: number | undefined;
    supportedFileTypes?: SupportedFileType[] | undefined;
    reasoning?: boolean | undefined;
    supportsTemperature?: boolean | undefined;
    supportsToolCall?: boolean | undefined;
    supportsInterleaved?: boolean | undefined;
    releaseDate?: string | undefined;
    status?: string | undefined;
    default?: boolean | undefined;
    providerMetadata?: any;
    interleaved?: any;
    modalities?: {
        input: string[];
        output: string[];
    } | undefined;
    pricing?: {
        inputPerM?: number;
        outputPerM?: number;
        cacheReadPerM?: number;
        cacheWritePerM?: number;
        currency?: string;
        unit?: string;
    } | undefined;
}

export interface ProviderInfo {
    models: ModelInfo[];
    baseURLSupport: 'required' | 'optional' | 'none';
    supportedFileTypes: SupportedFileType[];
    supportsCustomModels?: boolean;
    supportsAllRegistryModels?: boolean;
}

export const LLM_REGISTRY: Partial<Record<LLMProvider, ProviderInfo>> = {};

export function getModelInfo(provider: string, model: string): ModelInfo | null {
    return null;
}

export function getModel(_provider: string, _model: string): ModelInfo | undefined {
    return undefined;
}

export function getAllModelsForProvider(provider: string): ModelInfo[] {
    return [];
}

export function getCuratedModelsForProvider(provider: string): ModelInfo[] {
    return [];
}

export function getCuratedModelRefsForProviders(_providers: string[]): any[] {
    return [];
}

export function getSupportedFileTypesForModel(_provider: string, _model: string): SupportedFileType[] {
    return ['pdf', 'image'];
}

export function hasAllRegistryModelsSupport(_provider: string): boolean {
    return false;
}

export function supportsAllRegistryModels(_provider: string): boolean {
    return false;
}

export function transformModelNameForProvider(_provider: string, model: string): string {
    return model;
}

export function getOpenRouterModelContextLength(_model: string): number | undefined {
    return undefined;
}

export function stripBedrockRegionPrefix(model: string): string {
    return model;
}

export function acceptsAnyModel(provider: string): boolean {
    return provider === 'openai-compatible' || provider === 'litellm';
}

export function supportsBaseURL(provider: string): boolean {
    return true;
}

export function supportsCustomModels(_provider: string): boolean {
    return true;
}

export function getSupportedModels(_provider?: string): ModelInfo[] {
    return [];
}

export function getAllSupportedModels(): ModelInfo[] {
    return [];
}

export function getProviderFromModel(_model: string): LLMProvider | undefined {
    return undefined;
}

export function isModelValidForProvider(_provider: string, _model: string): boolean {
    return true;
}

export function isValidProviderModel(_provider: string, _model: string): boolean {
    return true;
}

export function getMaxInputTokensForModel(_provider: string, _model: string, _logger?: any): number {
    return 128000;
}

export function calculateCostBreakdown(
    ..._args: any[]
): any {
    return { totalUsd: 0 };
}

export function getModelPricing(_provider: string, _model: string): any {
    return undefined;
}

export interface TokenUsageCostBreakdown {
    inputCost?: number;
    outputCost?: number;
    totalCost?: number;
    totalUsd?: number;
    inputUsd?: number;
    outputUsd?: number;
    reasoningUsd?: number;
    cacheReadUsd?: number;
    cacheWriteUsd?: number;
}

export function getAllowedMimeTypes(..._args: any[]): string[] {
    return [
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/tiff',
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/wave',
        'audio/ogg',
        'audio/oga',
        'audio/webm',
        'audio/flac',
        'audio/aac',
        'audio/x-wav',
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/mpeg',
        'video/quicktime',
        'application/pdf',
        'text/plain',
        'text/markdown',
        'text/csv',
        'text/html',
        'application/json',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];
}

export function validateModelFileSupport(
    _provider: string,
    _model: string,
    _mimeType: string
): { isSupported: boolean; fileType?: string; error?: string } {
    return { isSupported: true };
}

export function getDefaultModelForProvider(_provider: string): string | undefined {
    return undefined;
}

export function getSupportedProviders(): LLMProvider[] {
    return [];
}

const ACRONYMS = new Set([
    'gpt', 'o1', 'o3', 'o4', 'glm', 'vl', 'bpe', 'moe', 'gguf', 'awq', 'gptq',
]);

const KNOWN_DISPLAY_NAMES: Record<string, string> = {
    'tencent/hy3:free': 'Hy3',
    'google/gemma-4-31b-it:free': 'Gemma 4 31B',
    'openai/gpt-oss-20b:free': 'GPT OSS 20B',
    'poolside/laguna-xs-2.1:free': 'Laguna XS 2.1',
    'cohere/north-mini-code:free': 'North Mini Code',
    'nvidia/nemotron-3-ultra-550b-a55b:free': 'Nemotron 3 Ultra',
    'inclusionai/ling-3.0-flash:free': 'Ling 3.0 Flash',
    'anthropic/claude-haiku-4.5': 'Claude Haiku 4.5',
    'anthropic/claude-sonnet-4.5': 'Claude Sonnet 4.5',
    'anthropic/claude-opus-4.5': 'Claude Opus 4.5',
    'openai/gpt-5.2': 'GPT 5.2',
    'openai/gpt-5.2-codex': 'GPT 5.2 Codex',
    'google/gemini-3-pro-preview': 'Gemini 3 Pro',
    'google/gemini-3-flash-preview': 'Gemini 3 Flash',
    'qwen/qwen3-coder:free': 'Qwen3 Coder',
    'deepseek/deepseek-r1-0528:free': 'DeepSeek R1',
    'z-ai/glm-4.7': 'GLM 4.7',
    'minimax/minimax-m2.1': 'Minimax M2.1',
    'moonshotai/kimi-k2.5': 'Kimi K2.5',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'gpt-3.5-turbo': 'GPT-3.5 Turbo',
    'o1-preview': 'o1 Preview',
    'o1-mini': 'o1 Mini',
    'claude-3-5-sonnet-latest': 'Claude 3.5 Sonnet',
    'claude-3-5-haiku-latest': 'Claude 3.5 Haiku',
    'claude-3-opus-latest': 'Claude 3 Opus',
    'gemini-2.0-flash-exp': 'Gemini 2.0 Flash',
    'gemini-1.5-pro': 'Gemini 1.5 Pro',
    'gemini-1.5-flash': 'Gemini 1.5 Flash',
    'minimax-text-01': 'MiniMax Text',
    'minimax-vl-01': 'MiniMax VL',
    'llama-3.1-70b-versatile': 'Llama 3.1 70B',
    'llama-3.1-8b-instant': 'Llama 3.1 8B',
    'deepseek-chat': 'DeepSeek Chat',
    'deepseek-coder': 'DeepSeek Coder',
    'grok-2-1212': 'Grok 2',
};

function formatModelName(raw: string): string {
    let name = raw.replace(/:free$/i, '').replace(/:paid$/i, '');
    const slashIndex = name.indexOf('/');
    if (slashIndex !== -1) name = name.slice(slashIndex + 1);
    return name
        .split(/[-_]/)
        .map((w) => {
            const lower = w.toLowerCase();
            if (ACRONYMS.has(lower)) return w.toUpperCase();
            if (/^\d+[bB]?$/.test(w)) return w.toUpperCase();
            return w.charAt(0).toUpperCase() + w.slice(1);
        })
        .join(' ');
}

export function getModelDisplayName(model: string, _provider?: string): string {
    if (!model) return 'Not configured';
    if (KNOWN_DISPLAY_NAMES[model]) return KNOWN_DISPLAY_NAMES[model];
    return formatModelName(model);
}

export function requiresApiKey(_provider: string): boolean {
    return false;
}

export function requiresBaseURL(_provider: string): boolean {
    return false;
}

export function getProviderInfo(_provider: string): ProviderInfo | undefined {
    return undefined;
}
