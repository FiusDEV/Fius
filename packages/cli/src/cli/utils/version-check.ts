import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';

interface VersionCache {
    lastCheck: number;
    latestVersion: string;
    currentVersion: string;
}

export interface UpdateInfo {
    current: string;
    latest: string;
    updateCommand: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE_PATH = path.join(os.homedir(), '.fius', 'cache', 'version-check.json');

function debugLog(message: string): void {
    if (process.env.FIUS_DEBUG === 'true') {
        console.debug(`[version-check] ${message}`);
    }
}

function compareSemver(v1: string, v2: string): number {
    const parse = (v: string) => {
        const cleaned = v.replace(/^v/, '');
        const parts = cleaned.split('.').map((p) => parseInt(p, 10) || 0);
        while (parts.length < 3) parts.push(0);
        return parts;
    };

    const p1 = parse(v1);
    const p2 = parse(v2);

    for (let i = 0; i < 3; i++) {
        const v1Part = p1[i] ?? 0;
        const v2Part = p2[i] ?? 0;
        if (v1Part !== v2Part) {
            return v1Part - v2Part;
        }
    }
    return 0;
}

async function loadCache(): Promise<VersionCache | null> {
    try {
        const content = await fs.readFile(CACHE_FILE_PATH, 'utf-8');
        return JSON.parse(content) as VersionCache;
    } catch {
        return null;
    }
}

async function saveCache(cache: VersionCache): Promise<void> {
    try {
        await fs.mkdir(path.dirname(CACHE_FILE_PATH), { recursive: true });
        await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(cache, null, 2));
    } catch (error) {
        debugLog(
            `Failed to save version cache: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

async function fetchLatestVersionWithTimeout(url: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const parsed = await resp.json();
        if (parsed.latest_version) {
            return parsed.latest_version;
        }
        throw new Error('Missing latest_version in response');
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

async function fetchLatestVersion(): Promise<string | null> {
    try {
        const baseUrl = process.env.FIUS_PLATFORM_URL || process.env.FIUS_API_URL || 'https://fius.dev';
        const latestVersion = await fetchLatestVersionWithTimeout(`${baseUrl}/api/cli/version`, 5000);
        return latestVersion;
    } catch (error) {
        debugLog(
            `Failed to fetch latest version: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateInfo | null> {
    if (process.env.FIUS_NO_UPDATE_CHECK === 'true') {
        debugLog('Version check disabled via FIUS_NO_UPDATE_CHECK');
        return null;
    }

    try {
        const result = await Promise.race([
            checkForUpdatesInternal(currentVersion),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
        return result;
    } catch {
        return null;
    }
}

async function checkForUpdatesInternal(currentVersion: string): Promise<UpdateInfo | null> {
    try {
        const now = Date.now();
        const cache = await loadCache();
        if (cache && cache.currentVersion === currentVersion) {
            const cacheAge = now - cache.lastCheck;
            if (cacheAge < CACHE_TTL_MS) {
                debugLog(
                    `Using cached version info (age: ${Math.round(cacheAge / 1000 / 60)} minutes)`
                );
                if (compareSemver(cache.latestVersion, currentVersion) > 0) {
                    return {
                        current: currentVersion,
                        latest: cache.latestVersion,
                        updateCommand: 'fius upgrade',
                    };
                }
                return null;
            }
        }

        debugLog('Fetching latest version from GitHub releases');
        const latestVersion = await fetchLatestVersion();

        if (!latestVersion) {
            return null;
        }

        const newCache: VersionCache = {
            lastCheck: now,
            latestVersion,
            currentVersion,
        };
        await saveCache(newCache);

        if (compareSemver(latestVersion, currentVersion) > 0) {
            return {
                current: currentVersion,
                latest: latestVersion,
                updateCommand: 'fius upgrade',
            };
        }

        return null;
    } catch (error) {
        debugLog(`Version check error: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

export function displayUpdateNotification(updateInfo: UpdateInfo): void {
    const message =
        `Update available: ${chalk.gray(updateInfo.current)} ${chalk.gray('в†’')} ${chalk.green(updateInfo.latest)}\n` +
        `Run: ${chalk.cyan(updateInfo.updateCommand)}`;

    console.log(
        boxen(message, {
            padding: 1,
            margin: { top: 1, bottom: 1, left: 0, right: 0 },
            borderColor: 'yellow',
            borderStyle: 'round',
        })
    );
}