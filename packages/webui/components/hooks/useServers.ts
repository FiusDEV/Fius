import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';

export function useServers(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.servers.all,
        queryFn: async () => {
            const res = await client.api.mcp.servers.$get();
            if (!res.ok) {
                throw new Error('Failed to fetch servers');
            }
            const data = await res.json();
            return data.servers;
        },
        enabled,
        staleTime: 30 * 1000, // 30 seconds - server status can change
    });
}

export function useServerTools(serverId: string | null, enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.servers.tools(serverId || ''),
        queryFn: async () => {
            if (!serverId) return [];
            const res = await client.api.mcp.servers[':serverId'].tools.$get({
                param: { serverId: encodeURIComponent(serverId) },
            });
            if (!res.ok) {
                throw new Error('Failed to fetch tools');
            }
            const data = await res.json();
            return data.tools;
        },
        enabled: enabled && !!serverId,
        staleTime: 2 * 60 * 1000, // 2 minutes - tools don't change once server is connected
    });
}

export function useAddServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: Parameters<typeof client.api.mcp.servers.$post>[0]['json']) => {
            const res = await client.api.mcp.servers.$post({ json: payload });
            if (!res.ok) {
                const error = await res.text();
                throw new Error(error || 'Failed to add server');
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.resources.all });
        },
    });
}

export function useDeleteServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (serverId: string) => {
            const res = await client.api.mcp.servers[':serverId'].$delete({
                param: { serverId: encodeURIComponent(serverId) },
            });
            if (!res.ok) {
                throw new Error('Failed to delete server');
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.resources.all });
        },
    });
}

export function useRestartServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (serverId: string) => {
            const res = await client.api.mcp.servers[':serverId'].restart.$post({
                param: { serverId: encodeURIComponent(serverId) },
            });
            if (!res.ok) {
                throw new Error('Failed to restart server');
            }
            return serverId;
        },
        onSuccess: (serverId) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.resources.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.tools(serverId) });
        },
    });
}

export function useToggleServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (serverId: string) => {
            const configRes = await client.api.mcp.servers[':serverId'].config.$get({
                param: { serverId: encodeURIComponent(serverId) },
            });
            if (!configRes.ok) {
                throw new Error('Failed to fetch server config');
            }
            const { config } = await configRes.json();

            const updateRes = await client.api.mcp.servers[':serverId'].$put({
                param: { serverId: encodeURIComponent(serverId) },
                json: {
                    config: { ...config, enabled: config.enabled === false },
                    persistToAgent: true,
                },
            });
            if (!updateRes.ok) {
                throw new Error('Failed to toggle server');
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.resources.all });
        },
    });
}

export function getDisabledMcpServers(): string[] {
    return [];
}

export type McpServer = NonNullable<ReturnType<typeof useServers>['data']>[number];
export type McpTool = NonNullable<ReturnType<typeof useServerTools>['data']>[number];
