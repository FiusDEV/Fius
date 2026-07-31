import { Hono } from 'hono';
import type { Env } from 'hono';

const BASE_URL = 'https://github.com/mcp';
const TOTAL_PAGES = 6;
const CACHE_TTL = 30 * 60 * 1000;

let cachedServers: unknown[] | null = null;
let cacheTimestamp = 0;

interface RegistryServer {
    id: string;
    name: string;
    display_name: string;
    description: string;
    url: string;
    stargazer_count: number;
    primary_language: string;
    primary_language_color: string;
    topics: string[];
    license: string | null;
    repository: {
        source: string;
        url: string;
        subfolder?: string;
    };
}

interface RegistryPayload {
    payload: {
        mcpRegistryRoute: {
            serversData: {
                servers: RegistryServer[];
            };
        };
    };
}

function parseRegistryPage(html: string): RegistryServer[] {
    const marker = 'data-target="react-app.embeddedData">';
    const startIdx = html.indexOf(marker);
    if (startIdx === -1) return [];

    const jsonStart = startIdx + marker.length;
    const jsonEnd = html.indexOf('</script>', jsonStart);
    if (jsonEnd === -1) return [];

    const jsonStr = html.substring(jsonStart, jsonEnd);

    try {
        const data = JSON.parse(jsonStr) as RegistryPayload;
        return data.payload?.mcpRegistryRoute?.serversData?.servers || [];
    } catch {
        return [];
    }
}

function convertServer(raw: RegistryServer) {
    return {
        id: raw.id,
        name: raw.name,
        displayName: raw.display_name,
        description: raw.description,
        url: raw.url,
        stars: raw.stargazer_count,
        language: raw.primary_language,
        languageColor: raw.primary_language_color,
        topics: raw.topics,
        license: raw.license,
        repoUrl: raw.repository.url,
        subfolder: raw.repository.subfolder ?? undefined,
    };
}

function parseInstallCommand(text: string): { command: string; args: string[] } | null {
    const lines = text.split('\n');
    const codeBlocks: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) {
            codeBlocks.push(line);
        }
    }

    for (const line of codeBlocks) {
        const trimmed = line.trim();
        const npxMatch = trimmed.match(/^npx\s+(-y|--yes)\s+([^\s`"<>|;&]+)/);
        if (npxMatch?.[2]) {
            return { command: 'npx', args: ['-y', npxMatch[2]] };
        }
    }

    for (const line of codeBlocks) {
        const trimmed = line.trim();
        const uvxMatch = trimmed.match(/^uvx\s+([^\s`"<>|;&]+)/);
        if (uvxMatch?.[1]) {
            return { command: 'uvx', args: [uvxMatch[1]] };
        }
        const bunxMatch = trimmed.match(/^bunx\s+(-y|--yes)\s+([^\s`"<>|;&]+)/);
        if (bunxMatch?.[2]) {
            return { command: 'bunx', args: ['-y', bunxMatch[2]] };
        }
    }

    for (const line of codeBlocks) {
        const trimmed = line.trim();
        const dockerMatch = trimmed.match(/^docker\s+run\s+[^\s`"<>|;&]+\s+([^\s`"<>|;&]+)/);
        if (dockerMatch?.[1]) {
            return { command: 'docker', args: ['run', dockerMatch[1]] };
        }
    }

    const fullText = codeBlocks.join('\n');
    const jsonConfigMatch = fullText.match(
        /"command"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*\[([^\]]*)\]/
    );
    if (jsonConfigMatch?.[1] && jsonConfigMatch[2] !== undefined) {
        const command = jsonConfigMatch[1].trim();
        const argsStr = jsonConfigMatch[2];
        const args: string[] = [];
        const argMatches = argsStr.matchAll(/"([^"]*)"/g);
        for (const m of argMatches) {
            const val = m[1]?.trim();
            if (val) args.push(val);
        }
        if (command) {
            return { command, args };
        }
    }

    return null;
}

export function createGitHubMcpRouter() {
    const app = new Hono();

    app.get('/github-mcp/servers', async (c) => {
        try {
            if (cachedServers && Date.now() - cacheTimestamp < CACHE_TTL) {
                return c.json(cachedServers);
            }

            const allServers: RegistryServer[] = [];

            const pagePromises = Array.from({ length: TOTAL_PAGES }, async (_, i) => {
                const page = i + 1;
                const url = page === 1 ? BASE_URL : `${BASE_URL}?page=${page}`;
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);
                    const resp = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeout);
                    if (!resp.ok) return [];
                    const html = await resp.text();
                    return parseRegistryPage(html);
                } catch {
                    return [];
                }
            });

            const pages = await Promise.all(pagePromises);
            for (const pageServers of pages) {
                allServers.push(...pageServers);
            }

            const servers = allServers.map(convertServer);
            servers.sort((a, b) => b.stars - a.stars);

            cachedServers = servers;
            cacheTimestamp = Date.now();

            return c.json(servers);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return c.json({ error: msg }, 500);
        }
    });

    app.get('/github-mcp/readme', async (c) => {
        try {
            const repo = c.req.query('repo');
            if (!repo) {
                return c.json({ error: 'Missing repo query parameter' }, 400);
            }

            const repoPath = repo.replace('https://github.com/', '');

            for (const branch of ['main', 'master']) {
                const rawUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/README.md`;
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 8000);
                    const resp = await fetch(rawUrl, { signal: controller.signal });
                    clearTimeout(timeout);
                    if (!resp.ok) continue;

                    const text = await resp.text();
                    const hint = parseInstallCommand(text);
                    return c.json({ text, hint });
                } catch {
                    continue;
                }
            }

            return c.json({ text: null, hint: null });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return c.json({ error: msg }, 500);
        }
    });

    return app;
}
