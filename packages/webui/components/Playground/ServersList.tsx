import React from 'react';
import { Server, Check, AlertCircle, Loader2, Globe, Trash2, PowerOff, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { McpServer } from '@/components/hooks/useServers';
import { useDeleteServer, useToggleServer } from '@/components/hooks/useServers';

interface ServersListProps {
    servers: McpServer[];
    selectedServer: McpServer | null;
    isLoading: boolean;
    error: string | null;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onServerSelect: (server: McpServer) => void;
    onConnectNew: () => void;
    onOpenGitHubMcp: () => void;
}

export function ServersList({
    servers,
    selectedServer,
    isLoading,
    error,
    searchQuery,
    onSearchChange,
    onServerSelect,
    onConnectNew,
    onOpenGitHubMcp,
}: ServersListProps) {
    const deleteServer = useDeleteServer();
    const toggleServer = useToggleServer();

    const filteredServers = servers.filter((server) =>
        server.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'connected':
                return <Check className="h-3 w-3" />;
            case 'error':
                return <AlertCircle className="h-3 w-3" />;
            case 'disconnected':
                return <PowerOff className="h-3 w-3" />;
            default:
                return <Loader2 className="h-3 w-3 animate-spin" />;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'connected':
                return 'bg-green-100 text-green-700 dark:bg-green-700/20 dark:text-green-400';
            case 'error':
                return 'bg-red-100 text-red-700 dark:bg-red-700/20 dark:text-red-400';
            case 'disconnected':
                return 'bg-slate-100 text-slate-600 dark:bg-slate-700/20 dark:text-slate-400';
            default:
                return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-700/20 dark:text-yellow-400';
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="pb-3 mb-3 border-b border-border">
                <div className="flex items-center gap-2 mb-3">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">MCP Servers</h2>
                    {isLoading && servers.length === 0 && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
                    )}
                </div>

                <Input
                    placeholder="Search servers..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="h-8 text-sm"
                />
            </div>

            {/* Error State */}
            {error && servers.length === 0 && !isLoading && (
                <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">
                    <p className="font-medium">Error loading servers</p>
                    <p className="text-xs mt-1">{error}</p>
                </div>
            )}

            {/* Loading State */}
            {isLoading && servers.length === 0 && (
                <div className="flex-1 space-y-2 pr-1">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="p-2.5 rounded-lg border border-border">
                            <div className="flex items-center justify-between gap-2">
                                <Skeleton className="h-4 flex-1" />
                                <Skeleton className="h-5 w-16" />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Empty State */}
            {servers.length === 0 && !isLoading && !error && (
                <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center">
                        <Server className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                        <p className="text-sm text-muted-foreground">No servers available</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Connect a server to get started
                        </p>
                    </div>
                </div>
            )}

            {/* Servers List */}
            {filteredServers.length > 0 && (
                <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                    {filteredServers.map((server) => (
                        <div
                            key={server.id}
                            className={cn(
                                'w-full p-2 rounded-lg transition-all duration-200 overflow-hidden',
                                'hover:shadow-sm border border-transparent',
                                selectedServer?.id === server.id && server.status === 'connected'
                                    ? 'bg-primary text-primary-foreground shadow-sm border-primary/20'
                                    : 'hover:bg-muted hover:border-border',
                                server.status === 'disconnected' && 'opacity-60',
                                server.status === 'error' && 'border-destructive/30 hover:border-destructive/50'
                            )}
                        >
                            <div className="flex items-center gap-1 min-w-0">
                                <div className="flex items-center shrink-0">
                                    {server.status === 'connected' && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
                                                onClick={() => toggleServer.mutate(server.id)}
                                                disabled={toggleServer.isPending}
                                                title="Disable server"
                                            >
                                                <PowerOff className="h-3 w-3" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                onClick={() => deleteServer.mutate(server.id)}
                                                disabled={deleteServer.isPending}
                                                title="Delete server"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </>
                                    )}
                                    {server.status === 'error' && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => deleteServer.mutate(server.id)}
                                            disabled={deleteServer.isPending}
                                            title="Delete server"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    )}
                                    {server.status === 'disconnected' && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0 text-muted-foreground hover:text-green-500 hover:bg-green-500/10"
                                                onClick={() => toggleServer.mutate(server.id)}
                                                disabled={toggleServer.isPending}
                                                title="Enable server"
                                            >
                                                <Power className="h-3 w-3" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                onClick={() => deleteServer.mutate(server.id)}
                                                disabled={deleteServer.isPending}
                                                title="Delete server"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </>
                                    )}
                                </div>
                                <button
                                    className="font-medium text-sm truncate min-w-0 flex-1 text-left"
                                    onClick={() => onServerSelect(server)}
                                >
                                    {server.name}
                                </button>
                                <Badge
                                    variant="secondary"
                                    className={cn(
                                        'text-[10px] px-1 py-0 h-4 shrink-0 flex items-center gap-0.5',
                                        getStatusColor(server.status)
                                    )}
                                >
                                    {getStatusIcon(server.status)}
                                    {server.status}
                                </Badge>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* No Results */}
            {filteredServers.length === 0 && servers.length > 0 && (
                <div className="flex-1 flex items-center justify-center p-4">
                    <p className="text-sm text-muted-foreground">No servers match your search</p>
                </div>
            )}

            {/* Connect Buttons */}
            <div className="mt-auto space-y-2 sticky bottom-0 pt-2">
                <Button
                    onClick={onOpenGitHubMcp}
                    variant="outline"
                    className="w-full"
                    size="sm"
                >
                    <Globe className="h-4 w-4 mr-2" />
                    GitHub MCP Servers
                </Button>
                <Button
                    onClick={onConnectNew}
                    variant="outline"
                    className="w-full"
                    size="sm"
                >
                    <Server className="h-4 w-4 mr-2" />
                    Connect New Server
                </Button>
            </div>
        </div>
    );
}
