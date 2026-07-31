import type { BillingCheckoutSessionResponse } from './api-client.js';
import { getFiusApiClient } from './api-client.js';
import { openBrowserUrl } from './browser-launch.js';
import { FIUS_CREDITS_URL } from './constants.js';
import { getAuthTokenQuietly } from './service.js';

function notLoggedInError(): Error {
    return new Error('Not logged in to Fius');
}

export function buildFiusBillingUrl(options: {
    creditsUsd?: number | undefined;
    baseUrl?: string | undefined;
}): string {
    const url = new URL(options.baseUrl ?? FIUS_CREDITS_URL);

    if (typeof options.creditsUsd === 'number' && Number.isFinite(options.creditsUsd)) {
        url.searchParams.set('credits_usd', String(options.creditsUsd));
    }

    return url.toString();
}

export async function getBillingBalanceForCurrentLogin(): Promise<number | null> {
    const authToken = await getAuthTokenQuietly();
    if (!authToken) {
        return null;
    }

    const response = await getFiusApiClient().getBillingBalance(authToken, {});
    return response.creditsUsd;
}

export async function createBillingCheckoutForCurrentLogin(options: {
    creditsUsd: number;
    returnUrl?: string | undefined;
}): Promise<BillingCheckoutSessionResponse> {
    const authToken = await getAuthTokenQuietly();
    if (!authToken) {
        throw notLoggedInError();
    }

    return getFiusApiClient().createBillingCheckoutSession(authToken, {
        ...options,
        returnUrl: options.returnUrl ?? FIUS_CREDITS_URL,
    });
}

export async function openFiusBillingPage(options: { url?: string | undefined }): Promise<void> {
    await openBrowserUrl(options.url ?? FIUS_CREDITS_URL);
}