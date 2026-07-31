import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Star, ExternalLink, ArrowLeft, Search, Loader2, Download } from 'lucide-react';
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
import { fetchGitHubAgents, fetchAgentReadme, type GitHubAgent } from '@/lib/github-agents';

interface GitHubAgentBrowserProps {
    isOpen: boolean;
    onClose: () => void;
    onInstall: (agent: GitHubAgent, readme: { text: string | null; file: string | null }) => void;
}

function formatStars(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function matchesSearch(query: string, agent: GitHubAgent): boolean {
    if (!query.trim()) return true;
    const q = query.toLowerCase().replace(/[\s-]+/g, '');
    const name = agent.name.toLowerCase().replace(/[\s-]+/g, '');
    const desc = agent.description.toLowerCase();
    const lang = (agent.language || '').toLowerCase();
    const topics = agent.topics.join(' ').toLowerCase();
    return name.includes(q) || desc.includes(q) || lang.includes(q) || topics.includes(q);
}

const LANGUAGE_COLORS: Record<string, string> = {
    TypeScript: '#3178c6',
    JavaScript: '#f1e05a',
    Python: '#3572A5',
    Go: '#00ADD8',
    Rust: '#dea584',
    Java: '#b07219',
    'C++': '#f34b7d',
    C: '#555555',
    'C#': '#178600',
    Ruby: '#701516',
    PHP: '#4F5D95',
    Swift: '#F05138',
    Kotlin: '#A97BFF',
    Dart: '#00B4AB',
    Scala: '#c22d40',
    Haskell: '#5e5086',
    Elixir: '#6e4a7e',
    Clojure: '#db5855',
    Shell: '#89e051',
    Dockerfile: '#384d54',
    HTML: '#e34c26',
    CSS: '#563d7c',
    SCSS: '#c6538c',
    Vue: '#41b883',
    Svelte: '#ff3e00',
    'Jupyter Notebook': '#DA5B0B',
    R: '#198CE7',
    Lua: '#000080',
    Zig: '#ec915c',
    Nix: '#7e7eff',
    Assembly: '#6E4C13',
    PowerShell: '#012456',
    Batch: '#C1F12E',
    Makefile: '#427819',
    CMake: '#DA3434',
    TOML: '#9c4221',
    YAML: '#cb171e',
    JSON: '#292929',
    Markdown: '#083fa1',
    'Objective-C': '#438eff',
};

function getLanguageColor(lang: string | null): string {
    if (!lang) return '#999';
    return LANGUAGE_COLORS[lang] || '#999';
}

export function GitHubAgentBrowser({ isOpen, onClose, onInstall }: GitHubAgentBrowserProps) {
    const [agents, setAgents] = useState<GitHubAgent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [detailAgent, setDetailAgent] = useState<GitHubAgent | null>(null);
    const [readme, setReadme] = useState<{ text: string | null; file: string | null } | null>(null);
    const [readmeLoading, setReadmeLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setIsLoading(true);
        setAgents([]);
        setDetailAgent(null);
        setReadme(null);
        setSearchQuery('');

        fetchGitHubAgents().then((data) => {
            setAgents(data);
            setIsLoading(false);
        });
    }, [isOpen]);

    const filteredAgents = useMemo(
        () => agents.filter((a) => matchesSearch(searchQuery, a)),
        [agents, searchQuery]
    );

    const enterDetail = useCallback(async (agent: GitHubAgent) => {
        setDetailAgent(agent);
        setReadmeLoading(true);
        setReadme(null);
        try {
            const data = await fetchAgentReadme(agent);
            setReadme(data);
        } finally {
            setReadmeLoading(false);
        }
    }, []);

    const goBack = useCallback(() => {
        setDetailAgent(null);
        setReadme(null);
    }, []);

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
                <DialogHeader className="px-6 pt-6 pb-4 border-b">
                    <div className="flex items-center gap-3">
                        {detailAgent ? (
                            <Button variant="ghost" size="sm" onClick={goBack} className="h-8 w-8 p-0">
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                        ) : null}
                        <div>
                            <DialogTitle>
                                {detailAgent ? detailAgent.name : 'GitHub Agents'}
                            </DialogTitle>
                            <DialogDescription>
                                Browse and install agents from GitHub
                            </DialogDescription>
                        </div>
                    </div>
                    {!detailAgent && (
                        <div className="relative mt-3">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search agents..."
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
                            <span className="ml-2 text-muted-foreground">Loading agents...</span>
                        </div>
                    ) : detailAgent ? (
                        <AgentDetail
                            agent={detailAgent}
                            readme={readme}
                            readmeLoading={readmeLoading}
                            onInstall={() => onInstall(detailAgent, readme)}
                        />
                    ) : (
                        <ScrollArea className="h-[50vh]">
                            <div className="divide-y">
                                {filteredAgents.map((agent) => (
                                    <AgentRow
                                        key={agent.id}
                                        agent={agent}
                                        onClick={() => enterDetail(agent)}
                                    />
                                ))}
                                {filteredAgents.length === 0 && (
                                    <div className="py-12 text-center text-muted-foreground">
                                        No agents match your search
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

function AgentRow({
    agent,
    onClick,
}: {
    agent: GitHubAgent;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className="w-full text-left px-6 py-3 hover:bg-muted/50 transition-colors"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{agent.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {agent.description}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                        {agent.language && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: getLanguageColor(agent.language) }}
                                />
                                {agent.language}
                            </span>
                        )}
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                            <Star className="h-3 w-3" />
                            {formatStars(agent.stars)}
                        </span>
                        {agent.licenseName && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                {agent.licenseName}
                            </Badge>
                        )}
                    </div>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
            </div>
        </button>
    );
}

function AgentDetail({
    agent,
    readme,
    readmeLoading,
    onInstall,
}: {
    agent: GitHubAgent;
    readme: { text: string | null; file: string | null } | null;
    readmeLoading: boolean;
    onInstall: () => void;
}) {
    return (
        <ScrollArea className="h-[50vh]">
            <div className="p-6 space-y-4">
                <div>
                    <h3 className="text-lg font-semibold">{agent.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{agent.description}</p>
                </div>

                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    {agent.language && (
                        <span className="flex items-center gap-1">
                            <span
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: getLanguageColor(agent.language) }}
                            />
                            {agent.language}
                        </span>
                    )}
                    <span className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5" />
                        {formatStars(agent.stars)}
                    </span>
                    {agent.licenseName && <Badge variant="secondary">{agent.licenseName}</Badge>}
                </div>

                {agent.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {agent.topics.slice(0, 8).map((topic) => (
                            <Badge key={topic} variant="outline" className="text-xs">
                                {topic}
                            </Badge>
                        ))}
                    </div>
                )}

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <a
                        href={agent.repoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                        <ExternalLink className="h-3 w-3" />
                        {agent.owner}/{agent.name}
                    </a>
                </div>

                {readmeLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Reading agent info...
                    </div>
                ) : readme?.text ? (
                    <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground max-h-40 overflow-y-auto">
                        <div className="mb-1 font-medium">{readme.file}:</div>
                        <pre className="whitespace-pre-wrap break-words">{readme.text.slice(0, 2000)}</pre>
                    </div>
                ) : (
                    <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                        No README or agent config found. Check the repo manually.
                    </div>
                )}

                <Button onClick={onInstall} className="w-full gap-2">
                    <Download className="h-4 w-4" />
                    Install Agent
                </Button>
            </div>
        </ScrollArea>
    );
}
