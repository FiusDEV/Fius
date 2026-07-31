import { getFiusApiClient, type CliUserInfo } from '../auth/api-client.js';

let lastResult: CliUserInfo | null = null;

export async function getCliUserInfoCached(apiKey: string): Promise<CliUserInfo | null> {
    try {
        const client = getFiusApiClient();
        const info = await client.getCliUserInfo(apiKey);
        lastResult = info;
        return info;
    } catch (error) {
        return lastResult;
    }
}

export async function clearUserInfoCache(): Promise<void> {
    lastResult = null;
}