import type { LLMProvider } from '@fius/llm';

export interface VerificationResult {
    success: boolean;
    error?: string;
    modelUsed?: string;
}

export async function verifyApiKey(
    _provider: LLMProvider,
    _apiKey: string,
    _model?: string
): Promise<VerificationResult> {
    return { success: true };
}