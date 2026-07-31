import type { GPUInfo } from './types.js';
import { LocalModelError } from './errors.js';
import { detectGPU } from './gpu-detector.js';
import { getFiusGlobalPath } from '../../../utils/path.js';
import { createRequire } from 'module';
import * as path from 'path';

function getGlobalNodeLlamaCppPath(): string {
    return path.join(getFiusGlobalPath('deps'), 'node_modules', 'node-llama-cpp');
}

export async function isNodeLlamaCppInstalled(): Promise<boolean> {
    try {
        // @ts-ignore - Optional dependency may not be installed (TS2307 in CI)
        await import('node-llama-cpp');
        return true;
    } catch {
    }

    try {
        const globalPath = getGlobalNodeLlamaCppPath();
        const require = createRequire(import.meta.url);
        require.resolve(globalPath);
        return true;
    } catch {
        return false;
    }
}

async function importNodeLlamaCpp(): Promise<Record<string, unknown> | null> {
    try {
        // @ts-ignore - Optional dependency may not be installed (TS2307 in CI)
        return await import('node-llama-cpp');
    } catch {
    }

    try {
        const globalPath = getGlobalNodeLlamaCppPath();
        const entryPoint = path.join(globalPath, 'dist', 'index.js');
        // @ts-ignore - Dynamic path import
        return await import(entryPoint);
    } catch {
        return null;
    }
}

export function requireNodeLlamaCpp(): never {
    throw LocalModelError.nodeLlamaNotInstalled();
}

export interface NodeLlamaConfig {
    
    modelPath: string;
    
    gpuLayers?: number;
    
    contextSize?: number;
    
    threads?: number;
    
    batchSize?: number;
    
    flashAttention?: boolean;
}

export interface ModelSession {
    
    prompt(
        text: string,
        options?: {
            maxTokens?: number;
            temperature?: number;
            topP?: number;
            signal?: AbortSignal;
            onToken?: (token: string) => void;
        }
    ): Promise<string>;

    
    dispose(): Promise<void>;
}

export interface LoadedModel {
    
    modelPath: string;
    
    gpuInfo: GPUInfo;
    
    createSession(): Promise<ModelSession>;
    
    dispose(): Promise<void>;
}

const modelCache = new Map<string, Promise<LoadedModel>>();

export async function loadModel(config: NodeLlamaConfig): Promise<LoadedModel> {
    const { modelPath, gpuLayers = -1, contextSize, threads, batchSize = 512 } = config;

    const cacheKey = `${modelPath}:${gpuLayers}:${contextSize}`;
    const cached = modelCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const loadPromise = (async (): Promise<LoadedModel> => {
        const nodeLlama = await importNodeLlamaCpp();
        if (!nodeLlama) {
            throw LocalModelError.nodeLlamaNotInstalled();
        }

        try {
            const gpuInfo = await detectGPU();

            const getLlama = nodeLlama['getLlama'] as (config: {
                logLevel: unknown;
                gpu: boolean | string;
            }) => Promise<{
                loadModel: (config: { modelPath: string; gpuLayers: number | string }) => Promise<{
                    createContext: (options: Record<string, unknown>) => Promise<{
                        getSequence: () => unknown;
                        dispose: () => Promise<void>;
                    }>;
                    dispose: () => Promise<void>;
                }>;
            }>;
            const LlamaLogLevel = nodeLlama['LlamaLogLevel'] as { warn: unknown };
            const LlamaChatSession = nodeLlama['LlamaChatSession'] as new (options: {
                contextSequence: unknown;
            }) => {
                prompt: (
                    text: string,
                    options: {
                        maxTokens: number;
                        temperature: number;
                        topP: number;
                        signal?: AbortSignal;
                        stopOnAbortSignal: boolean;
                        trimWhitespaceSuffix: boolean;
                        onTextChunk?: (text: string) => void;
                    }
                ) => Promise<string>;
            };

            const llama = await getLlama({
                logLevel: LlamaLogLevel.warn,
                gpu: gpuInfo.backend === 'cpu' ? false : 'auto',
            });

            const model = await llama.loadModel({
                modelPath,
                gpuLayers: gpuLayers === -1 ? 'auto' : gpuLayers,
            });

            const contextOptions: Record<string, unknown> = {
                batchSize,
            };
            if (contextSize !== undefined) {
                contextOptions.contextSize = contextSize;
            }
            if (threads !== undefined) {
                contextOptions.threads = threads;
            }

            const context = await model.createContext(contextOptions);

            return {
                modelPath,
                gpuInfo,
                async createSession(): Promise<ModelSession> {
                    const session = new LlamaChatSession({
                        contextSequence: context.getSequence(),
                    });

                    return {
                        async prompt(text, options = {}): Promise<string> {
                            const {
                                maxTokens = 1024,
                                temperature = 0.7,
                                topP = 0.9,
                                signal,
                                onToken,
                            } = options;

                            const promptOptions: {
                                maxTokens: number;
                                temperature: number;
                                topP: number;
                                stopOnAbortSignal: boolean;
                                trimWhitespaceSuffix: boolean;
                                signal?: AbortSignal;
                                onTextChunk?: (text: string) => void;
                            } = {
                                maxTokens,
                                temperature,
                                topP,
                                stopOnAbortSignal: true,
                                trimWhitespaceSuffix: true,
                            };

                            if (signal) {
                                promptOptions.signal = signal;
                            }
                            if (onToken) {
                                promptOptions.onTextChunk = onToken;
                            }

                            const response = await session.prompt(text, promptOptions);

                            return response;
                        },
                        async dispose(): Promise<void> {
                        },
                    };
                },
                async dispose(): Promise<void> {
                    await context.dispose();
                    await model.dispose();
                    modelCache.delete(cacheKey);
                },
            };
        } catch (error) {
            modelCache.delete(cacheKey);
            if (error instanceof Error && 'code' in error) {
                 throw error;
            }
            throw LocalModelError.modelLoadFailed(
                modelPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    })();

    modelCache.set(cacheKey, loadPromise);
    return loadPromise;
}

export async function unloadModel(modelPath: string): Promise<void> {
    for (const [key, loadPromise] of modelCache.entries()) {
        const keyModelPath = key.split(':')[0];
        if (keyModelPath === modelPath) {
            try {
                const loaded = await loadPromise;
                await loaded.dispose();
            } catch {
            }
            modelCache.delete(key);
        }
    }
}

export async function unloadAllModels(): Promise<void> {
    for (const [key, loadPromise] of modelCache.entries()) {
        try {
            const loaded = await loadPromise;
            await loaded.dispose();
        } catch {
        }
        modelCache.delete(key);
    }
}

export function isModelLoaded(modelPath: string): boolean {
    for (const key of modelCache.keys()) {
        const keyModelPath = key.split(':')[0];
        if (keyModelPath === modelPath) {
            return true;
        }
    }
    return false;
}

export function getLoadedModelCount(): number {
    return modelCache.size;
}
