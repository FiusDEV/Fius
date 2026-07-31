import { useMutation } from '@tanstack/react-query';
import { client } from '@/lib/client';

/**
 * Validate an OpenRouter model ID against the registry.
 * Returns validation result with status and optional error.
 */
export function useValidateOpenRouterModel() {
    return useMutation({
        mutationFn: async (modelId: string) => {
            const encodedModelId = encodeURIComponent(modelId);
            const response = await client.api.openrouter.validate[':modelId'].$get({
                param: { modelId: encodedModelId },
            });
            if (!response.ok) {
                throw new Error(`Failed to validate model: ${response.status}`);
            }
            return await response.json();
        },
    });
}

export type ValidateOpenRouterModelResult = Awaited<
    ReturnType<ReturnType<typeof useValidateOpenRouterModel>['mutateAsync']>
>;
