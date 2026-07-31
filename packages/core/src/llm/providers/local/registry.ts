import type { LocalModelInfo } from './types.js';

export const LOCAL_MODEL_REGISTRY: LocalModelInfo[] = [
    {
        id: 'llama-3.3-8b-q4',
        name: 'Llama 3.3 8B Instruct',
        description:
            "Meta's latest 8B model. Excellent general-purpose performance with 128K context.",
        huggingfaceId: 'bartowski/Llama-3.3-8B-Instruct-GGUF',
        filename: 'Llama-3.3-8B-Instruct-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 5_020_000_000,
        contextLength: 131072,
        categories: ['general', 'coding'],
        minVRAM: 6,
        minRAM: 8,
        recommended: true,
        author: 'Meta',
        license: 'llama3.3',
        supportsTools: true,
    },
    {
        id: 'qwen-2.5-coder-7b-q4',
        name: 'Qwen 2.5 Coder 7B Instruct',
        description: "Alibaba's coding-focused model. Excellent for code generation and review.",
        huggingfaceId: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',
        filename: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 4_680_000_000,
        contextLength: 131072,
        categories: ['coding'],
        minVRAM: 6,
        minRAM: 8,
        recommended: true,
        author: 'Alibaba',
        license: 'apache-2.0',
        supportsTools: true,
    },

    {
        id: 'phi-3.5-mini-q4',
        name: 'Phi 3.5 Mini Instruct',
        description: "Microsoft's compact model. Great for simple tasks with minimal resources.",
        huggingfaceId: 'bartowski/Phi-3.5-mini-instruct-GGUF',
        filename: 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 2_390_000_000,
        contextLength: 131072,
        categories: ['small', 'general'],
        minVRAM: 4,
        minRAM: 4,
        recommended: true,
        author: 'Microsoft',
        license: 'mit',
    },
    {
        id: 'qwen-2.5-3b-q4',
        name: 'Qwen 2.5 3B Instruct',
        description: 'Compact but capable. Good for basic chat and simple tasks.',
        huggingfaceId: 'Qwen/Qwen2.5-3B-Instruct-GGUF',
        filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 2_050_000_000,
        contextLength: 32768,
        categories: ['small', 'general'],
        minVRAM: 3,
        minRAM: 4,
        author: 'Alibaba',
        license: 'apache-2.0',
    },
    {
        id: 'gemma-2-2b-q4',
        name: 'Gemma 2 2B Instruct',
        description: "Google's efficient small model. Good balance of speed and capability.",
        huggingfaceId: 'bartowski/gemma-2-2b-it-GGUF',
        filename: 'gemma-2-2b-it-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 1_790_000_000,
        contextLength: 8192,
        categories: ['small', 'general'],
        minVRAM: 3,
        minRAM: 4,
        author: 'Google',
        license: 'gemma',
    },

    {
        id: 'qwen-2.5-coder-14b-q4',
        name: 'Qwen 2.5 Coder 14B Instruct',
        description: 'Larger coding model for complex tasks. Better code understanding.',
        huggingfaceId: 'Qwen/Qwen2.5-Coder-14B-Instruct-GGUF',
        filename: 'qwen2.5-coder-14b-instruct-q4_k_m.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 8_900_000_000,
        contextLength: 131072,
        categories: ['coding'],
        minVRAM: 10,
        minRAM: 12,
        author: 'Alibaba',
        license: 'apache-2.0',
        supportsTools: true,
    },
    {
        id: 'deepseek-coder-v2-lite-q4',
        name: 'DeepSeek Coder V2 Lite',
        description: "DeepSeek's efficient coding model. Great for code completion.",
        huggingfaceId: 'bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF',
        filename: 'DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 9_200_000_000,
        contextLength: 131072,
        categories: ['coding'],
        minVRAM: 12,
        minRAM: 16,
        author: 'DeepSeek',
        license: 'deepseek',
    },
    {
        id: 'codestral-22b-q4',
        name: 'Codestral 22B',
        description: "Mistral's dedicated coding model. Supports 80+ languages.",
        huggingfaceId: 'bartowski/Codestral-22B-v0.1-GGUF',
        filename: 'Codestral-22B-v0.1-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 13_500_000_000,
        contextLength: 32768,
        categories: ['coding'],
        minVRAM: 16,
        minRAM: 20,
        author: 'Mistral AI',
        license: 'mnpl',
    },

    {
        id: 'mistral-7b-q4',
        name: 'Mistral 7B Instruct v0.3',
        description: "Mistral's efficient 7B model. Good balance of speed and quality.",
        huggingfaceId: 'bartowski/Mistral-7B-Instruct-v0.3-GGUF',
        filename: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 4_370_000_000,
        contextLength: 32768,
        categories: ['general'],
        minVRAM: 6,
        minRAM: 8,
        author: 'Mistral AI',
        license: 'apache-2.0',
        supportsTools: true,
    },
    {
        id: 'gemma-2-9b-q4',
        name: 'Gemma 2 9B Instruct',
        description: "Google's capable 9B model. Strong reasoning and instruction following.",
        huggingfaceId: 'bartowski/gemma-2-9b-it-GGUF',
        filename: 'gemma-2-9b-it-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 5_760_000_000,
        contextLength: 8192,
        categories: ['general'],
        minVRAM: 8,
        minRAM: 10,
        author: 'Google',
        license: 'gemma',
    },
    {
        id: 'llama-3.1-8b-q4',
        name: 'Llama 3.1 8B Instruct',
        description: "Meta's Llama 3.1. Solid general-purpose performance.",
        huggingfaceId: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
        filename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 4_920_000_000,
        contextLength: 131072,
        categories: ['general'],
        minVRAM: 6,
        minRAM: 8,
        author: 'Meta',
        license: 'llama3.1',
        supportsTools: true,
    },

    {
        id: 'qwen-2.5-14b-q4',
        name: 'Qwen 2.5 14B Instruct',
        description: "Alibaba's mid-size model. Strong reasoning and long context.",
        huggingfaceId: 'Qwen/Qwen2.5-14B-Instruct-GGUF',
        filename: 'qwen2.5-14b-instruct-q4_k_m.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 8_700_000_000,
        contextLength: 131072,
        categories: ['reasoning', 'general'],
        minVRAM: 10,
        minRAM: 12,
        author: 'Alibaba',
        license: 'apache-2.0',
        supportsTools: true,
    },
    {
        id: 'qwen-2.5-32b-q4',
        name: 'Qwen 2.5 32B Instruct',
        description: "Alibaba's large model. Excellent reasoning and complex tasks.",
        huggingfaceId: 'Qwen/Qwen2.5-32B-Instruct-GGUF',
        filename: 'qwen2.5-32b-instruct-q4_k_m.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 19_300_000_000,
        contextLength: 131072,
        categories: ['reasoning', 'general'],
        minVRAM: 24,
        minRAM: 32,
        author: 'Alibaba',
        license: 'apache-2.0',
        supportsTools: true,
    },

    {
        id: 'llava-v1.6-mistral-7b-q4',
        name: 'LLaVA v1.6 Mistral 7B',
        description: 'Vision-language model. Can understand and discuss images.',
        huggingfaceId: 'cjpais/llava-v1.6-mistral-7b-gguf',
        filename: 'llava-v1.6-mistral-7b.Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 4_500_000_000,
        contextLength: 4096,
        categories: ['vision', 'general'],
        minVRAM: 8,
        minRAM: 10,
        author: 'Microsoft/LLaVA',
        license: 'llama2',
        supportsVision: true,
    },
    {
        id: 'qwen-2-vl-7b-q4',
        name: 'Qwen2 VL 7B Instruct',
        description: "Alibaba's vision-language model. High-quality image understanding.",
        huggingfaceId: 'Qwen/Qwen2-VL-7B-Instruct-GGUF',
        filename: 'qwen2-vl-7b-instruct-q4_k_m.gguf',
        quantization: 'Q4_K_M',
        sizeBytes: 5_100_000_000,
        contextLength: 32768,
        categories: ['vision', 'general'],
        minVRAM: 8,
        minRAM: 10,
        author: 'Alibaba',
        license: 'apache-2.0',
        supportsVision: true,
    },
];

export function getAllLocalModels(): LocalModelInfo[] {
    return [...LOCAL_MODEL_REGISTRY];
}

export function getLocalModelById(id: string): LocalModelInfo | undefined {
    return LOCAL_MODEL_REGISTRY.find((m) => m.id === id);
}

export function getLocalModelsByCategory(category: string): LocalModelInfo[] {
    return LOCAL_MODEL_REGISTRY.filter((m) => m.categories.includes(category as any));
}

export function getRecommendedLocalModels(): LocalModelInfo[] {
    return LOCAL_MODEL_REGISTRY.filter((m) => m.recommended);
}

export function getModelsForVRAM(vramGB: number): LocalModelInfo[] {
    return LOCAL_MODEL_REGISTRY.filter((m) => !m.minVRAM || m.minVRAM <= vramGB);
}

export function getModelsForRAM(ramGB: number): LocalModelInfo[] {
    return LOCAL_MODEL_REGISTRY.filter((m) => !m.minRAM || m.minRAM <= ramGB);
}

export function searchLocalModels(query: string): LocalModelInfo[] {
    const q = query.toLowerCase();
    return LOCAL_MODEL_REGISTRY.filter(
        (m) =>
            m.id.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            m.description.toLowerCase().includes(q)
    );
}

export function getDefaultLocalModelId(): string {
    const recommended = getRecommendedLocalModels();
    return recommended[0]?.id ?? 'llama-3.3-8b-q4';
}
