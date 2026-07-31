import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Star, ExternalLink, Download, ArrowLeft, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    fetchGitHubMcpServers,
    fetchInstallHint,
    type GitHubMcpServer,
} from '@/lib/github-mcp';

interface GitHubMcpBrowserProps {
    isOpen: boolean;
    onClose: () => void;
    onInstall: (server: GitHubMcpServer, installHint: { command: string; args: string[] } | null) => void;
}

function formatStars(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function matchesSearch(query: string, server: GitHubMcpServer): boolean {
    if (!query.trim()) return true;
    const q = query.toLowerCase().replace(/[\s-]+/g, '');
    const name = server.displayName.toLowerCase().replace(/[\s-]+/g, '');
    const desc = server.description.toLowerCase();
    const lang = (server.language || '').toLowerCase();
    const topics = server.topics.join(' ').toLowerCase();
    return name.includes(q) || desc.includes(q) || lang.includes(q) || topics.includes(q);
}

export function GitHubMcpBrowser({ isOpen, onClose, onInstall }: GitHubMcpBrowserProps) {
    const [servers, setServers] = useState<GitHubMcpServer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [detailServer, setDetailServer] = useState<GitHubMcpServer | null>(null);
    const [installHint, setInstallHint] = useState<{
        command: string;
        args: string[];
    } | null>(null);
    const [hintLoading, setHintLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setIsLoading(true);
        setServers([]);
        setDetailServer(null);
        setInstallHint(null);
        setSearchQuery('');

        fetchGitHubMcpServers().then((data) => {
            setServers(data);
            setIsLoading(false);
        });
    }, [isOpen]);

    const filteredServers = useMemo(
        () => servers.filter((s) => matchesSearch(searchQuery, s)),
        [servers, searchQuery]
    );

    const enterDetail = useCallback(async (server: GitHubMcpServer) => {
        setDetailServer(server);
        setHintLoading(true);
        setInstallHint(null);
        try {
            const hint = await fetchInstallHint(server);
            setInstallHint(hint);
        } finally {
            setHintLoading(false);
        }
    }, []);

    const goBack = useCallback(() => {
        setDetailServer(null);
        setInstallHint(null);
    }, []);

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
                <DialogHeader className="px-6 pt-6 pb-4 border-b">
                    <div className="flex items-center gap-3">
                        {detailServer ? (
                            <Button variant="ghost" size="sm" onClick={goBack} className="h-8 w-8 p-0">
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                        ) : null}
                        <DialogTitle>
                            {detailServer ? detailServer.displayName : 'GitHub MCP Servers'}
                        </DialogTitle>
                        <DialogDescription>
                            Browse and install MCP servers from GitHub
                        </DialogDescription>
                    </div>
                    {!detailServer && (
                        <div className="relative mt-3">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search servers..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    )}
                </DialogHeader>

                <div className="flex-1 overflow-hidden">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            <span className="ml-2 text-muted-foreground">Loading servers...</span>
                        </div>
                    ) : detailServer ? (
                        <ServerDetail
                            server={detailServer}
                            installHint={installHint}
                            hintLoading={hintLoading}
                            onInstall={() => onInstall(detailServer, installHint)}
                        />
                    ) : (
                        <ScrollArea className="h-[50vh]">
                            <div className="divide-y">
                                {filteredServers.map((server) => (
                                    <ServerRow
                                        key={server.id}
                                        server={server}
                                        onClick={() => enterDetail(server)}
                                    />
                                ))}
                                {filteredServers.length === 0 && (
                                    <div className="py-12 text-center text-muted-foreground">
                                        No servers match your search
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function ServerRow({
    server,
    onClick,
}: {
    server: GitHubMcpServer;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className="w-full text-left px-6 py-3 hover:bg-muted/50 transition-colors"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{server.displayName}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {server.description}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                        {server.language && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: server.languageColor }}
                                />
                                {server.language}
                            </span>
                        )}
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                            <Star className="h-3 w-3" />
                            {formatStars(server.stars)}
                        </span>
                        {server.license && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                {server.license}
                            </Badge>
                        )}
                    </div>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
            </div>
        </button>
    );
}

function ServerDetail({
    server,
    installHint,
    hintLoading,
    onInstall,
}: {
    server: GitHubMcpServer;
    installHint: { command: string; args: string[] } | null;
    hintLoading: boolean;
    onInstall: () => void;
}) {
    return (
        <ScrollArea className="h-[50vh]">
            <div className="p-6 space-y-4">
                <div>
                    <h3 className="text-lg font-semibold">{server.displayName}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{server.description}</p>
                </div>

                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    {server.language && (
                        <span className="flex items-center gap-1">
                            <span
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: server.languageColor }}
                            />
                            {server.language}
                        </span>
                    )}
                    <span className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5" />
                        {formatStars(server.stars)}
                    </span>
                    {server.license && <Badge variant="secondary">{server.license}</Badge>}
                </div>

                {server.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {server.topics.slice(0, 8).map((topic) => (
                            <Badge key={topic} variant="outline" className="text-xs">
                                {topic}
                            </Badge>
                        ))}
                    </div>
                )}

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <a
                        href={server.repoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                        <ExternalLink className="h-3 w-3" />
                        {server.repoUrl.replace('https://github.com/', '')}
                    </a>
                </div>

                {hintLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Reading install instructions...
                    </div>
                ) : installHint ? (
                    <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs">
                        <div className="text-muted-foreground mb-1">Install command:</div>
                        <code>
                            {installHint.command} {installHint.args.join(' ')}
                        </code>
                    </div>
                ) : (
                    <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                        No install command found in README. Configure manually.
                    </div>
                )}

                <Button onClick={onInstall} className="w-full gap-2">
                    <Download className="h-4 w-4" />
                    Install Server
                </Button>
            </div>
        </ScrollArea>
    );
}
