import { getFiusApiKey, isAuthenticated } from '../auth/index.js';

export async function canUseFiusProvider(): Promise<boolean> {
    const authenticated = await isAuthenticated();
    if (!authenticated) return false;

    const apiKey = await getFiusApiKey();
    if (!apiKey) return false;

    return true;
}