import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '@/lib/queryKeys';
import { client } from '@/lib/client';
import { usePreferenceStore } from '@/lib/stores/preferenceStore';

export function useCurrentLLM(sessionId: string | null, enabled: boolean = true) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: queryKeys.llm.current(sessionId),
        queryFn: async () => {
            const response = await client.api.llm.current.$get({
                query: sessionId ? { sessionId } : {},
            });
            if (!response.ok) {
                throw new Error('Failed to fetch current LLM config');
            }
            const data = await response.json();
            const cfg = data.config || data;

            if (typeof cfg.streaming === 'boolean') {
                const current = usePreferenceStore.getState().isStreaming;
                if (current !== cfg.streaming) {
                    usePreferenceStore.setState({ isStreaming: cfg.streaming });
                }
            }

            return {
                provider: cfg.provider,
                model: cfg.model,
                displayName: cfg.displayName,
                baseURL: cfg.baseURL,
                viaFius: data.routing?.viaFius ?? false,
            };
        },
        enabled,
        retry: false,
        refetchInterval: 3000,
    });

    useEffect(() => {
        const handleSwitch = () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.llm.current(sessionId) });
        };
        window.addEventListener('llm:switched', handleSwitch);
        return () => window.removeEventListener('llm:switched', handleSwitch);
    }, [queryClient, sessionId]);

    return query;
}

export type CurrentLLM = NonNullable<ReturnType<typeof useCurrentLLM>['data']>;
