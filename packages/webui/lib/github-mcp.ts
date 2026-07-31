export interface GitHubMcpServer {
    id: string;
    name: string;
    displayName: string;
    description: string;
    url: string;
    stars: number;
    language: string;
    languageColor: string;
    topics: string[];
    license: string | null;
    repoUrl: string;
    subfolder?: string;
}

const CACHE_TTL = 30 * 60 * 1000;

let cachedServers: GitHubMcpServer[] | null = null;
let cacheTimestamp = 0;

export async function fetchGitHubMcpServers(): Promise<GitHubMcpServer[]> {
    if (cachedServers && Date.now() - cacheTimestamp < CACHE_TTL) {
        return cachedServers;
    }

    try {
        const resp = await fetch('/api/github-mcp/servers');
        if (!resp.ok) return [];

        const servers = (await resp.json()) as GitHubMcpServer[];

        cachedServers = servers;
        cacheTimestamp = Date.now();

        return servers;
    } catch {
        return [];
    }
}

export async function fetchInstallHint(
    server: GitHubMcpServer
): Promise<{ command: string; args: string[] } | null> {
    try {
        const resp = await fetch(
            `/api/github-mcp/readme?repo=${encodeURIComponent(server.repoUrl)}`
        );
        if (!resp.ok) return null;

        const data = (await resp.json()) as { hint: { command: string; args: string[] } | null };
        return data.hint ?? null;
    } catch {
        return null;
    }
}
