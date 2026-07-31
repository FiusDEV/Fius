

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
                metadata: {
                    count: number;
                    total: number;
                    total_pages: number;
                };
            };
        };
    };
}

const BASE_URL = 'https://github.com/mcp';
const TOTAL_PAGES = 6;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

let cachedServers: GitHubMcpServer[] | null = null;
let cacheTimestamp = 0;

// Cache for install hints (repoUrl → hint)
const installHintCache = new Map<string, { command: string; args: string[] } | null>();
const INSTALL_HINT_CACHE_TTL = 60 * 60 * 1000; // 60 minutes
const installHintTimestamps = new Map<string, number>();


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

function convertServer(raw: RegistryServer): GitHubMcpServer {
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
        subfolder: raw.repository.subfolder,
    };
}


export async function fetchGitHubMcpServers(): Promise<GitHubMcpServer[]> {
    if (cachedServers && Date.now() - cacheTimestamp < CACHE_TTL) {
        return cachedServers;
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

    return servers;
}


export async function fetchInstallHint(
    server: GitHubMcpServer
): Promise<{ command: string; args: string[] } | null> {
    const cached = installHintCache.get(server.repoUrl);
    if (cached !== undefined) {
        const ts = installHintTimestamps.get(server.repoUrl) || 0;
        if (Date.now() - ts < INSTALL_HINT_CACHE_TTL) return cached;
    }

    const repoPath = server.repoUrl.replace('https://github.com/', '');

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
            if (hint) {
                installHintCache.set(server.repoUrl, hint);
                installHintTimestamps.set(server.repoUrl, Date.now());
                return hint;
            }
        } catch {
            continue;
        }
    }

    installHintCache.set(server.repoUrl, null);
    installHintTimestamps.set(server.repoUrl, Date.now());
    return null;
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

        // npx -y @scope/package
        const npxMatch = trimmed.match(/^npx\s+(-y|--yes)\s+([^\s`"<>|;&]+)/);
        if (npxMatch) {
            return { command: 'npx', args: ['-y', npxMatch[2]] };
        }

        // uvx package-name
        const uvxMatch = trimmed.match(/^uvx\s+([^\s`"<>|;&]+)/);
        if (uvxMatch) {
            return { command: 'uvx', args: [uvxMatch[1]] };
        }

        // bunx -y package
        const bunxMatch = trimmed.match(/^bunx\s+(-y|--yes)\s+([^\s`"<>|;&]+)/);
        if (bunxMatch) {
            return { command: 'bunx', args: ['-y', bunxMatch[2]] };
        }

        // docker run image
        const dockerMatch = trimmed.match(/^docker\s+run\s+[^\s`"<>|;&]+\s+([^\s`"<>|;&]+)/);
        if (dockerMatch) {
            return { command: 'docker', args: ['run', dockerMatch[1]] };
        }
    }

    // Try to find JSON config blocks with "command" and "args" fields
    // e.g., {"command": "npx", "args": ["-y", "package@latest"]}
    const fullText = codeBlocks.join('\n');
    const jsonConfigMatch = fullText.match(/"command"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*\[([^\]]*)\]/);
    if (jsonConfigMatch) {
        const command = jsonConfigMatch[1].trim();
        const argsStr = jsonConfigMatch[2];
        const args: string[] = [];
        const argMatches = argsStr.matchAll(/"([^"]*)"/g);
        for (const m of argMatches) {
            const val = m[1].trim();
            if (val) args.push(val);
        }
        if (command) {
            return { command, args };
        }
    }

    return null;
}
