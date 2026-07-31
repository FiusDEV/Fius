import { Hono } from 'hono';

const TOPICS = ['ai-agents', 'ai-agent'];
const PER_PAGE = 30;
const CACHE_TTL = 30 * 60 * 1000;

let cachedAgents: unknown[] | null = null;
let cacheTimestamp = 0;

interface GitHubRepo {
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    stargazers_count: number;
    language: string | null;
    topics: string[];
    license: { spdx_id: string | null; name: string | null } | null;
    owner: { login: string; avatar_url: string };
    created_at: string;
    updated_at: string;
}

interface AgentResult {
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

function dedup(repos: GitHubRepo[]): GitHubRepo[] {
    const seen = new Set<number>();
    return repos.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
    });
}

function convertRepo(repo: GitHubRepo): AgentResult {
    return {
        id: String(repo.id),
        name: repo.name,
        description: repo.description || '',
        url: repo.html_url,
        stars: repo.stargazers_count,
        language: repo.language,
        topics: repo.topics,
        license: repo.license?.spdx_id || null,
        licenseName: repo.license?.name || null,
        repoUrl: repo.html_url,
        owner: repo.owner.login,
        avatarUrl: repo.owner.avatar_url,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
    };
}

export function createGitHubAgentsRouter() {
    const app = new Hono();

    app.get('/github-agents/search', async (c) => {
        try {
            if (cachedAgents && Date.now() - cacheTimestamp < CACHE_TTL) {
                return c.json(cachedAgents);
            }

            const allRepos: GitHubRepo[] = [];

            const searchPromises = TOPICS.map(async (topic) => {
                const url = `https://api.github.com/search/repositories?q=topic:${topic}&sort=stars&order=desc&per_page=${PER_PAGE}`;
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);
                    const resp = await fetch(url, {
                        signal: controller.signal,
                        headers: { Accept: 'application/vnd.github.v3+json' },
                    });
                    clearTimeout(timeout);
                    if (!resp.ok) return [];
                    const data = (await resp.json()) as { items?: GitHubRepo[] };
                    return data.items || [];
                } catch {
                    return [];
                }
            });

            const results = await Promise.all(searchPromises);
            for (const repos of results) {
                allRepos.push(...repos);
            }

            const unique = dedup(allRepos);
            const agents = unique.map(convertRepo);
            agents.sort((a, b) => b.stars - a.stars);

            cachedAgents = agents;
            cacheTimestamp = Date.now();

            return c.json(agents);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return c.json({ error: msg }, 500);
        }
    });

    app.get('/github-agents/readme', async (c) => {
        try {
            const repo = c.req.query('repo');
            if (!repo) {
                return c.json({ error: 'Missing repo query parameter' }, 400);
            }

            const repoPath = repo.replace('https://github.com/', '').replace(/\/$/, '');

            for (const branch of ['main', 'master']) {
                for (const file of ['README.md', 'readme.md', 'agent.yml', 'agent.yaml']) {
                    const rawUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/${file}`;
                    try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 8000);
                        const resp = await fetch(rawUrl, { signal: controller.signal });
                        clearTimeout(timeout);
                        if (!resp.ok) continue;

                        const text = await resp.text();
                        return c.json({ text, file });
                    } catch {
                        continue;
                    }
                }
            }

            return c.json({ text: null, file: null });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return c.json({ error: msg }, 500);
        }
    });

    return app;
}
