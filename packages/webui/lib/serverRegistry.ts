import type { ServerRegistryEntry, ServerRegistryFilter } from '@fiusdev/registry';
import { serverRegistry as sharedRegistry } from '@fiusdev/registry';
import { client } from './client';

/**
 * MCP Server Registry Service
 * Manages a registry of available MCP servers that can be quickly added to agents
 *
 * The built-in registry data is loaded from an external JSON file (server-registry-data.json)
 * to make it easy to add new servers without rebuilding the codebase.
 */
export class ServerRegistryService {
    private static instance: ServerRegistryService;
    private registryEntries: ServerRegistryEntry[] = [];
    private isInitialized = false;

    private constructor() {
    }

    private static normalizeId(s: string): string {
        return s
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    static getInstance(): ServerRegistryService {
        if (!ServerRegistryService.instance) {
            ServerRegistryService.instance = new ServerRegistryService();
        }
        return ServerRegistryService.instance;
    }

    /**
     * Initialize the registry with default entries and load from external sources
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        this.registryEntries = await this.getBuiltinEntries();

        this.isInitialized = true;
    }

    /**
     * Get all registry entries with optional filtering
     */
    async getEntries(filter?: ServerRegistryFilter): Promise<ServerRegistryEntry[]> {
        await this.initialize();

        let filtered = [...this.registryEntries];

        if (filter?.category) {
            filtered = filtered.filter((entry) => entry.category === filter.category);
        }

        if (filter?.tags?.length) {
            filtered = filtered.filter((entry) =>
                filter.tags!.some((tag) => entry.tags.includes(tag))
            );
        }

        if (filter?.search) {
            const searchLower = filter.search.toLowerCase();
            filtered = filtered.filter(
                (entry) =>
                    entry.name.toLowerCase().includes(searchLower) ||
                    entry.description.toLowerCase().includes(searchLower) ||
                    entry.tags.some((tag) => tag.toLowerCase().includes(searchLower))
            );
        }

        if (filter?.installed !== undefined) {
            filtered = filtered.filter((entry) => entry.isInstalled === filter.installed);
        }

        if (filter?.official !== undefined) {
            filtered = filtered.filter((entry) => entry.isOfficial === filter.official);
        }

        return filtered.sort((a, b) => {
            if (a.isInstalled !== b.isInstalled) {
                return a.isInstalled ? -1 : 1;
            }
            if (a.isOfficial !== b.isOfficial) {
                return a.isOfficial ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Update an existing registry entry
     */
    async updateEntry(id: string, updates: Partial<ServerRegistryEntry>): Promise<boolean> {
        const index = this.registryEntries.findIndex((entry) => entry.id === id);
        if (index === -1) return false;

        this.registryEntries[index] = {
            ...this.registryEntries[index],
            ...updates,
        };

        return true;
    }

    /**
     * Mark a server as installed/uninstalled
     */
    async setInstalled(id: string, installed: boolean): Promise<boolean> {
        return this.updateEntry(id, { isInstalled: installed });
    }

    /**
     * Sync registry installed status with current server states
     * This handles both disconnected and deleted servers
     */
    async syncWithServerStatus(): Promise<void> {
        try {
            await this.initialize();
            if (this.registryEntries.length === 0) {
                console.warn('Registry entries not available for status sync');
                return;
            }
            const response = await client.api.mcp.servers.$get();
            if (!response.ok) {
                throw new Error(`Failed to fetch servers: ${response.status}`);
            }
            const data = await response.json();
            const servers = data.servers || [];

            const allServerIds = new Set<string>();

            servers.forEach((server: { id?: string; status?: string }) => {
                if (!server?.id || typeof server.id !== 'string') return;
                const normalizedId = ServerRegistryService.normalizeId(server.id);
                allServerIds.add(normalizedId);
            });

            for (const entry of this.registryEntries) {
                const aliases = [entry.id, entry.name, ...(entry.matchIds || [])]
                    .filter(Boolean)
                    .map((x) => ServerRegistryService.normalizeId(String(x)));

                const hasMatchingServer = aliases.some((alias) => allServerIds.has(alias));

                const shouldBeInstalled = hasMatchingServer;

                if (entry.isInstalled !== shouldBeInstalled) {
                    entry.isInstalled = shouldBeInstalled;
                }
            }
        } catch (error) {
            console.warn('Failed to sync registry with server status:', error);
        }
    }

    /**
     * Get server configuration for connecting
     */
    async getServerConfig(id: string): Promise<ServerRegistryEntry | null> {
        await this.initialize();
        return this.registryEntries.find((entry) => entry.id === id) || null;
    }

    /**
     * Built-in registry entries for popular MCP servers
     * Loaded from shared @fiusdev/registry package
     */
    private async getBuiltinEntries(): Promise<ServerRegistryEntry[]> {
        return sharedRegistry.getEntries();
    }
}

export const serverRegistry = ServerRegistryService.getInstance();
