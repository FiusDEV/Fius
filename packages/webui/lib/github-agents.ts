export interface GitHubAgent {
    id: string;
    name: string;
    description: string;
    url: string;
    stars: number;
    language: string | null;
    topics: string[];
    license: string | null;
    licenseName: string | null;
    repoUrl: string;
    owner: string;
    avatarUrl: string;
    createdAt: string;
    updatedAt: string;
}

const CACHE_TTL = 30 * 60 * 1000;

let cachedAgents: GitHubAgent[] | null = null;
let cacheTimestamp = 0;

export async function fetchGitHubAgents(): Promise<GitHubAgent[]> {
    if (cachedAgents && Date.now() - cacheTimestamp < CACHE_TTL) {
        return cachedAgents;
    }

    try {
        const resp = await fetch('/api/github-agents/search');
        if (!resp.ok) return [];

        const agents = (await resp.json()) as GitHubAgent[];

        cachedAgents = agents;
        cacheTimestamp = Date.now();

        return agents;
    } catch {
        return [];
    }
}

export async function fetchAgentReadme(
    agent: GitHubAgent
): Promise<{ text: string | null; file: string | null }> {
    try {
        const resp = await fetch(
            `/api/github-agents/readme?repo=${encodeURIComponent(agent.repoUrl)}`
        );
        if (!resp.ok) return { text: null, file: null };

        const data = (await resp.json()) as { text: string | null; file: string | null };
        return data;
    } catch {
        return { text: null, file: null };
    }
}
