import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Hook to fetch Fius authentication status.
 * Returns whether fius auth is enabled, user is authenticated, and can use fius provider.
 */
export function useFiusAuth(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.fiusAuth.status,
        queryFn: async () => {
            const res = await client.api['fius-auth'].status.$get();
            if (!res.ok) throw new Error('Failed to fetch fius auth status');
            return await res.json();
        },
        enabled,
        staleTime: 30 * 1000, // 30 seconds - auth status may change
    });
}

export type FiusAuthStatus = NonNullable<ReturnType<typeof useFiusAuth>['data']>;
