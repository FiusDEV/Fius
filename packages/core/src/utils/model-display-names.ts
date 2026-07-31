const KNOWN_MODEL_NAMES: Record<string, string> = {
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
    'z-ai/glm-4.7-flash-free': 'GLM 4.7 Flash',
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

const ACRONYMS = new Set([
    'gpt', 'o1', 'o3', 'o4', 'glm', 'vl', 'bpe', 'moe', 'gguf', 'awq', 'gptq',
]);

function formatModelName(raw: string): string {
    let name = raw.replace(/:free$/i, '').replace(/:paid$/i, '').replace(/-free$/i, '');

    const slashIndex = name.indexOf('/');
    if (slashIndex !== -1) {
        name = name.slice(slashIndex + 1);
    }

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

export function getModelDisplayName(modelId: string): string {
    if (!modelId) return '';
    if (KNOWN_MODEL_NAMES[modelId]) {
        return KNOWN_MODEL_NAMES[modelId];
    }
    return formatModelName(modelId);
}
