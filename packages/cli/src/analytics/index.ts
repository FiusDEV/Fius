import type { AnalyticsEventName } from './events.js';

interface InitOptions {
    appVersion: string;
}

export async function initAnalytics(_opts: InitOptions): Promise<void> {
}

export function getAnalyticsConfig(): null {
    return null;
}

export function flushAnalytics(): void {
}

export function trackEvent(_event: AnalyticsEventName, _payload?: unknown): void {
}

export function capture(_event: AnalyticsEventName, _properties?: unknown): void {
}

export async function shutdownAnalytics(): Promise<void> {
}

export async function onCommandStart(_name: string, _extra?: Record<string, unknown>): Promise<void> {
}

export async function onCommandEnd(
    _name: string,
    _success: boolean,
    _extra?: Record<string, unknown>
): Promise<void> {
}

export function getEnabled(): boolean {
    return false;
}

export async function getWebUIAnalyticsConfig(): Promise<null> {
    return null;
}

export type { AnalyticsEventName };
