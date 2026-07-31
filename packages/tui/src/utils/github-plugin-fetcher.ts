

export interface GitHubPlugin {
    id: string;
    name: string;
    displayName: string;
    description: string;
    author: string;
    category: string;
    homepage: string | null;
    sourceUrl: string;
    sourceType: string;
    skills: string[];
}

interface MarketplacePluginEntry {
    name: string;
    displayName?: string;
    description?: string;
    author?: { name?: string; email?: string; url?: string };
    category?: string;
    homepage?: string;
    source: string | { source?: string; url?: string; path?: string; ref?: string; sha?: string };
    skills?: string[];
}

interface MarketplaceManifest {
    name: string;
    description: string;
    plugins: MarketplacePluginEntry[];
}

const MARKETPLACE_RAW_URL =
    'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

let cachedPlugins: GitHubPlugin[] | null = null;
let cacheTimestamp = 0;

function resolveSourceUrl(source: MarketplacePluginEntry['source']): string {
    if (typeof source === 'string') {
        return source;
    }
    if (source?.url) {
        return source.url;
    }
    return '';
}

function resolveSourceType(source: MarketplacePluginEntry['source']): string {
    if (typeof source === 'string') {
        if (source.startsWith('./')) return 'local';
        return 'git';
    }
    if (source?.source === 'git-subdir') return 'git-subdir';
    if (source?.source === 'url') return 'url';
    return 'unknown';
}

function convertPlugin(entry: MarketplacePluginEntry): GitHubPlugin {
    const sourceUrl = resolveSourceUrl(entry.source);
    const author =
        entry.author?.name || entry.homepage?.split('/').slice(-2).join('/') || 'Unknown';

    return {
        id: entry.name,
        name: entry.name,
        displayName: entry.displayName || entry.name,
        description: entry.description || 'No description',
        author,
        category: entry.category || 'general',
        homepage: entry.homepage || null,
        sourceUrl,
        sourceType: resolveSourceType(entry.source),
        skills: entry.skills || [],
    };
}


export async function fetchGitHubPlugins(): Promise<GitHubPlugin[]> {
    if (cachedPlugins && Date.now() - cacheTimestamp < CACHE_TTL) {
        return cachedPlugins;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch(MARKETPLACE_RAW_URL, { signal: controller.signal });
        clearTimeout(timeout);

        if (!resp.ok) {
            return cachedPlugins || [];
        }

        const manifest = (await resp.json()) as MarketplaceManifest;
        const plugins = manifest.plugins.map(convertPlugin);
        plugins.sort((a, b) => a.displayName.localeCompare(b.displayName));

        cachedPlugins = plugins;
        cacheTimestamp = Date.now();

        return plugins;
    } catch {
        return cachedPlugins || [];
    }
}
