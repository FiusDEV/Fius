import chalk from 'chalk';
import { FiusApiClient, getFiusApiClient } from './api-client.js';
import type { DeviceApiKeyLoginResult } from './types.js';
const TRANSIENT_POLL_BACKOFF_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 30_000;

export interface DeviceLoginPrompt {
    userCode: string;
    verificationUrl: string;
    verificationUrlComplete: string | null;
    expiresIn: number;
}

export interface DeviceLoginOptionsInput {
    apiUrl?: string;
    signal?: AbortSignal | undefined;
    onPrompt?: ((prompt: DeviceLoginPrompt) => void | Promise<void>) | undefined;
    timeoutSeconds?: number;
    attempt?: number;
    maxAttempts?: number;
}

interface DeviceLoginOptions {
    apiUrl?: string | undefined;
    signal: AbortSignal | null;
    onPrompt: (prompt: DeviceLoginPrompt) => void | Promise<void>;
    timeoutSeconds: number;
    attempt: number;
    maxAttempts: number;
}

function resolveDeviceLoginOptions(options: DeviceLoginOptionsInput): DeviceLoginOptions {
    return {
        apiUrl: options.apiUrl,
        signal: options.signal ?? null,
        onPrompt: options.onPrompt ?? (() => undefined),
        timeoutSeconds: options.timeoutSeconds ?? 300,
        attempt: options.attempt ?? 1,
        maxAttempts: options.maxAttempts ?? 1,
    };
}

function getAuthClient(apiUrl: string | undefined): FiusApiClient {
    return apiUrl ? new FiusApiClient(apiUrl) : getFiusApiClient();
}

async function sleepWithAbort(ms: number, signal: AbortSignal | null): Promise<void> {
    if (signal?.aborted) {
        throw signal.reason instanceof Error
            ? signal.reason
            : new Error('Authentication cancelled');
    }

    if (!signal) {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            reject(
                signal.reason instanceof Error
                    ? signal.reason
                    : new Error('Authentication cancelled')
            );
        };

        signal.addEventListener('abort', onAbort, { once: true });
    });
}

export async function performDeviceCodeLogin(
    optionsInput: DeviceLoginOptionsInput = {}
): Promise<DeviceApiKeyLoginResult> {
    const options = resolveDeviceLoginOptions(optionsInput);
    const authClient = getAuthClient(options.apiUrl);

    const start = await authClient.startDeviceCodeLogin('fius-cli', {
        signal: options.signal ?? undefined,
    });

    await options.onPrompt({
        userCode: start.userCode,
        verificationUrl: start.verificationUrl,
        verificationUrlComplete: start.verificationUrlComplete,
        expiresIn: start.expiresIn,
    });

    const timeoutMs = options.timeoutSeconds * 1000;
    const deadline = Date.now() + timeoutMs;
    let pollIntervalMs = Math.max(1, Math.floor(start.interval)) * 1000;

    try {
        while (Date.now() < deadline) {
            await sleepWithAbort(pollIntervalMs, options.signal);

            const pollResult = await authClient.pollDeviceCodeLogin(start.deviceCode, {
                signal: options.signal ?? undefined,
            });

            if (pollResult.status === 'pending') {
                continue;
            }

            if (pollResult.status === 'slowDown') {
                pollIntervalMs = Math.min(pollIntervalMs + 5_000, MAX_POLL_INTERVAL_MS);
                continue;
            }

            if (pollResult.status === 'transientError') {
                pollIntervalMs = Math.min(
                    pollIntervalMs + TRANSIENT_POLL_BACKOFF_MS,
                    MAX_POLL_INTERVAL_MS
                );
                continue;
            }

            if (pollResult.status === 'expired') {
                throw new Error('Device login expired. Please restart login.');
            }

            if (pollResult.status === 'denied') {
                throw new Error('Device login was denied.');
            }

            return {
                fiusApiKey: pollResult.apiKey.fullKey,
                fiusKeyId: pollResult.apiKey.id,
                fiusKeyDisplay: pollResult.apiKey.keyDisplay,
                email: pollResult.userEmail,
            };
        }
    } finally {
    }

    throw new Error('Device login timed out. Please restart login.');
}