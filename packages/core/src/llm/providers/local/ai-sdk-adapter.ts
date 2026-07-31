/* global ReadableStream, ReadableStreamDefaultController */

import type {
    LanguageModelV2,
    LanguageModelV2CallOptions,
    LanguageModelV2StreamPart,
    LanguageModelV2Content,
    LanguageModelV2FinishReason,
    LanguageModelV2Usage,
    LanguageModelV2CallWarning,
} from '@ai-sdk/provider';
import {
    loadModel,
    isNodeLlamaCppInstalled,
    type ModelSession,
    type LoadedModel,
} from './node-llama-provider.js';
import { LocalModelError } from './errors.js';
import { getLocalModelById } from './registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LocalModelAdapterConfig {
    
    modelId: string;
    
    modelPath?: string;
    
    contextSize?: number;
    
    gpuLayers?: number;
    
    threads?: number;
}

interface InstalledModelInfo {
    id: string;
    filePath: string;
    sizeBytes: number;
    downloadedAt: string;
}

interface ModelState {
    version: string;
    installed: Record<string, InstalledModelInfo>;
    activeModelId?: string;
}

function getModelsDirectory(): string {
    return path.join(os.homedir(), '.fius', 'models');
}

function getInstalledModelInfo(modelId: string): InstalledModelInfo | null {
    const stateFile = path.join(getModelsDirectory(), 'state.json');

    try {
        if (!fs.existsSync(stateFile)) {
            return null;
        }

        const content = fs.readFileSync(stateFile, 'utf-8');
        const state: ModelState = JSON.parse(content);

        return state.installed[modelId] ?? null;
    } catch {
        return null;
    }
}

interface CustomModelInfo {
    name: string;
    provider: string;
    filePath?: string;
    displayName?: string;
    maxInputTokens?: number;
}

interface CustomModelsStorage {
    version: number;
    models: CustomModelInfo[];
}

function getCustomModelFilePath(modelId: string): string | null {
    const customModelsFile = path.join(getModelsDirectory(), 'custom-models.json');

    try {
        if (!fs.existsSync(customModelsFile)) {
            return null;
        }

        const content = fs.readFileSync(customModelsFile, 'utf-8');
        const storage: CustomModelsStorage = JSON.parse(content);

        const customModel = storage.models.find(
            (m) => m.name === modelId && m.provider === 'local' && m.filePath
        );

        return customModel?.filePath ?? null;
    } catch {
        return null;
    }
}

export function createLocalLanguageModel(config: LocalModelAdapterConfig): LanguageModelV2 {
    return new LocalLanguageModel(config);
}

class LocalLanguageModel implements LanguageModelV2 {
    readonly specificationVersion = 'v2' as const;
    readonly provider = 'local';
    readonly modelId: string;

    readonly supportedUrls: Record<string, RegExp[]> = {};

    private config: LocalModelAdapterConfig;
    private session: ModelSession | null = null;
    private loadedModel: LoadedModel | null = null;
    private initPromise: Promise<void> | null = null;
    private deviceName: string = 'Local';

    constructor(config: LocalModelAdapterConfig) {
        this.modelId = config.modelId;
        this.config = config;
    }

    
    private async ensureInitialized(): Promise<void> {
        if (this.session) {
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.initialize();
        return this.initPromise;
    }

    private async initialize(): Promise<void> {
        const {
            modelId,
            modelPath: directPath,
            contextSize,
            gpuLayers = -1,
            threads,
        } = this.config;

        const isInstalled = await isNodeLlamaCppInstalled();
        if (!isInstalled) {
            throw LocalModelError.nodeLlamaNotInstalled();
        }

        let modelPath: string;

        if (directPath) {
            modelPath = directPath;
        } else {
            const installedModel = getInstalledModelInfo(modelId);
            if (installedModel) {
                modelPath = installedModel.filePath;
            } else {
                const customPath = getCustomModelFilePath(modelId);
                if (customPath) {
                    modelPath = customPath;
                } else {
                    const registryModel = getLocalModelById(modelId);
                    if (!registryModel) {
                        throw LocalModelError.modelNotFound(modelId);
                    }
                    throw LocalModelError.modelNotDownloaded(modelId);
                }
            }
        }

        const loadConfig: {
            modelPath: string;
            contextSize?: number;
            gpuLayers: number;
            threads?: number;
        } = {
            modelPath,
            gpuLayers,
        };

        if (contextSize !== undefined) {
            loadConfig.contextSize = contextSize;
        }
        if (threads !== undefined) {
            loadConfig.threads = threads;
        }

        this.loadedModel = await loadModel(loadConfig);

        this.deviceName = this.loadedModel.gpuInfo.deviceName || 'Local';

        this.session = await this.loadedModel.createSession();
    }

    
    async doGenerate(options: LanguageModelV2CallOptions) {
        await this.ensureInitialized();

        const prompt = this.formatPrompt(options);
        const maxTokens = options.maxOutputTokens ?? 1024;
        const temperature = options.temperature ?? 0.7;

        const promptOptions: {
            maxTokens: number;
            temperature: number;
            signal?: AbortSignal;
        } = {
            maxTokens,
            temperature,
        };

        if (options.abortSignal) {
            promptOptions.signal = options.abortSignal;
        }

        const response = await this.session!.prompt(prompt, promptOptions);

        const inputTokens = Math.ceil(prompt.length / 4);
        const outputTokens = Math.ceil(response.length / 4);

        const content: LanguageModelV2Content[] = [{ type: 'text', text: response }];
        const finishReason: LanguageModelV2FinishReason = 'stop';
        const usage: LanguageModelV2Usage = {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
        };
        const warnings: LanguageModelV2CallWarning[] = [];

        return {
            content,
            finishReason,
            usage,
            providerMetadata: {
                local: {
                    device: this.deviceName,
                },
            },
            warnings,
        };
    }

    
    async doStream(options: LanguageModelV2CallOptions) {
        await this.ensureInitialized();

        const prompt = this.formatPrompt(options);
        const maxTokens = options.maxOutputTokens ?? 1024;
        const temperature = options.temperature ?? 0.7;

        const inputTokens = Math.ceil(prompt.length / 4);
        let outputTokens = 0;

        const session = this.session!;
        const textId = 'text-0';

        const streamPromptOptions: {
            maxTokens: number;
            temperature: number;
            signal?: AbortSignal;
            onToken: (token: string) => void;
        } = {
            maxTokens,
            temperature,
            onToken: (_token: string) => {
            },
        };

        if (options.abortSignal) {
            streamPromptOptions.signal = options.abortSignal;
        }

        let controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>;

        const stream = new ReadableStream<LanguageModelV2StreamPart>({
            async start(ctrl) {
                controller = ctrl;

                controller.enqueue({
                    type: 'stream-start',
                    warnings: [],
                });

                controller.enqueue({
                    type: 'text-start',
                    id: textId,
                });

                try {
                    streamPromptOptions.onToken = (token: string) => {
                        outputTokens += 1;
                        controller.enqueue({
                            type: 'text-delta',
                            id: textId,
                            delta: token,
                        });
                    };

                    await session.prompt(prompt, streamPromptOptions);

                    controller.enqueue({
                        type: 'text-end',
                        id: textId,
                    });

                    controller.enqueue({
                        type: 'finish',
                        finishReason: 'stop',
                        usage: {
                            inputTokens,
                            outputTokens,
                            totalTokens: inputTokens + outputTokens,
                        },
                    });

                    controller.close();
                } catch (error) {
                    if (error instanceof Error && error.name === 'AbortError') {
                        controller.enqueue({
                            type: 'text-end',
                            id: textId,
                        });

                        controller.enqueue({
                            type: 'finish',
                            finishReason: 'stop',
                            usage: {
                                inputTokens,
                                outputTokens,
                                totalTokens: inputTokens + outputTokens,
                            },
                        });
                        controller.close();
                    } else {
                        controller.enqueue({
                            type: 'error',
                            error,
                        });
                        controller.close();
                    }
                }
            },
        });

        return {
            stream,
        };
    }

    
    private formatPrompt(options: LanguageModelV2CallOptions): string {
        const parts: string[] = [];

        if (options.prompt && Array.isArray(options.prompt)) {
            for (const message of options.prompt) {
                if (message.role === 'system') {
                    parts.push(`System: ${message.content}`);
                } else if (message.role === 'user') {
                    if (Array.isArray(message.content)) {
                        const textParts = message.content
                            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                            .map((p) => p.text);
                        if (textParts.length > 0) {
                            parts.push(`User: ${textParts.join('\n')}`);
                        }
                    }
                } else if (message.role === 'assistant') {
                    if (Array.isArray(message.content)) {
                        const textParts = message.content
                            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                            .map((p) => p.text);
                        if (textParts.length > 0) {
                            parts.push(`Assistant: ${textParts.join('\n')}`);
                        }
                    }
                }
            }
        }

        parts.push('Assistant:');
        return parts.join('\n\n');
    }
}
