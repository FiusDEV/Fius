export type GPUBackend = 'metal' | 'cuda' | 'vulkan' | 'cpu';

export type QuantizationType =
    | 'Q2_K'
    | 'Q3_K_S'
    | 'Q3_K_M'
    | 'Q3_K_L'
    | 'Q4_0'
    | 'Q4_K_S'
    | 'Q4_K_M'
    | 'Q5_0'
    | 'Q5_K_S'
    | 'Q5_K_M'
    | 'Q6_K'
    | 'Q8_0'
    | 'F16'
    | 'F32';

export type LocalModelCategory = 'general' | 'coding' | 'reasoning' | 'small' | 'vision';

export type ModelSource = 'huggingface' | 'ollama';

export interface LocalModelInfo {
    
    id: string;

    
    name: string;

    
    description: string;

    
    huggingfaceId: string;

    
    filename: string;

    
    quantization: QuantizationType;

    
    sizeBytes: number;

    
    contextLength: number;

    
    categories: LocalModelCategory[];

    
    minVRAM?: number;

    
    minRAM?: number;

    
    recommended?: boolean;

    
    author?: string;

    
    license?: string;

    
    supportsVision?: boolean;

    
    supportsTools?: boolean;
}

export type ModelDownloadStatus = 'pending' | 'downloading' | 'verifying' | 'complete' | 'error';

export interface ModelDownloadProgress {
    
    modelId: string;

    
    status: ModelDownloadStatus;

    
    bytesDownloaded: number;

    
    totalBytes: number;

    
    percentage: number;

    
    speed?: number;

    
    eta?: number;

    
    error?: string;
}

export interface GPUInfo {
    
    backend: GPUBackend;

    
    available: boolean;

    
    deviceName?: string;

    
    vramMB?: number;

    
    driverVersion?: string;
}

export interface LocalLLMConfig {
    
    provider: 'local' | 'ollama';

    
    model: string;

    
    gpuLayers?: number;

    
    contextSize?: number;

    
    threads?: number;

    
    batchSize?: number;

    
    modelPath?: string;
}

export interface InstalledModel {
    
    id: string;

    
    filePath: string;

    
    sizeBytes: number;

    
    downloadedAt: string;

    
    lastUsedAt?: string;

    
    sha256?: string;

    
    source: ModelSource;
}

export interface ModelState {
    
    version: string;

    
    installed: Record<string, InstalledModel>;

    
    activeModelId?: string;

    
    downloadQueue: string[];
}

export interface ModelDownloadOptions {
    
    modelId: string;

    
    outputDir?: string;

    
    showProgress?: boolean;

    
    onProgress?: (progress: ModelDownloadProgress) => void;

    
    hfToken?: string;
}

export interface ModelDownloadResult {
    
    success: boolean;

    
    filePath?: string;

    
    sha256?: string;

    
    error?: string;
}

export interface OllamaModelInfo {
    
    name: string;

    
    size: number;

    
    digest: string;

    
    modifiedAt: string;

    
    details?: {
        family?: string;
        parameterSize?: string;
        quantizationLevel?: string;
    };
}

export interface OllamaStatus {
    
    running: boolean;

    
    url: string;

    
    version?: string;

    
    models?: OllamaModelInfo[];

    
    error?: string;
}
