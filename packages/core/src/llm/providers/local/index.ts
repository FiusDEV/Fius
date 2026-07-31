export * from './types.js';

export { LocalModelErrorCode } from './error-codes.js';
export { LocalModelError } from './errors.js';

export {
    GPUBackendSchema,
    QuantizationTypeSchema,
    LocalModelCategorySchema,
    ModelSourceSchema,
    ModelDownloadStatusSchema,
    LocalModelInfoSchema,
    ModelDownloadProgressSchema,
    GPUInfoSchema,
    LocalLLMConfigSchema,
    InstalledModelSchema,
    ModelStateSchema,
    ModelDownloadOptionsSchema,
    OllamaModelInfoSchema,
    OllamaStatusSchema,
} from './schemas.js';

export {
    LOCAL_MODEL_REGISTRY,
    getAllLocalModels,
    getLocalModelById,
    getLocalModelsByCategory,
    getRecommendedLocalModels,
    getModelsForVRAM,
    getModelsForRAM,
    searchLocalModels,
    getDefaultLocalModelId,
} from './registry.js';

export {
    detectGPU,
    formatGPUInfo,
    isBackendAvailable,
    getAvailableBackends,
} from './gpu-detector.js';

export {
    downloadModel,
    downloadModelFromUrl,
    calculateFileHash,
    checkDiskSpace,
    validateDiskSpace,
    cleanupPartialDownload,
    isDownloadInProgress,
    getPartialDownloadProgress,
    type DownloadEvents,
    type DownloadOptions,
    type DownloadResult,
} from './downloader.js';

export {
    DEFAULT_OLLAMA_URL,
    checkOllamaStatus,
    listOllamaModels,
    isOllamaModelAvailable,
    pullOllamaModel,
    createOllamaModel,
    createValidatedOllamaModel,
    getOllamaModelInfo,
    deleteOllamaModel,
    generateOllamaEmbeddings,
    type OllamaConfig,
} from './ollama-provider.js';

export {
    isNodeLlamaCppInstalled,
    requireNodeLlamaCpp,
    loadModel,
    unloadModel,
    unloadAllModels,
    isModelLoaded,
    getLoadedModelCount,
    type NodeLlamaConfig,
    type ModelSession,
    type LoadedModel,
} from './node-llama-provider.js';

export { createLocalLanguageModel, type LocalModelAdapterConfig } from './ai-sdk-adapter.js';
