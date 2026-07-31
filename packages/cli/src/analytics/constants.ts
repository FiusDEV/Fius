export const DEFAULT_POSTHOG_KEY = 'phc_IJHITHjBKOjDyFiVeilfdumcGniXMuLeXeiLQhYvwDW';
export const DEFAULT_POSTHOG_HOST = 'https://app.posthog.com';

/**
 * Single opt-out switch for analytics.
 *
 * Usage:
 *   FIUS_ANALYTICS_DISABLED=1 fius ...
 *
 * When set to a truthy value ("1", "true", "yes"), analytics are fully disabled.
 */
export function isAnalyticsDisabled(): boolean {
    const v = process.env.FIUS_ANALYTICS_DISABLED;
    return typeof v === 'string' && /^(1|true|yes)$/i.test(v);
}

/**
 * Generic per-command timeout (in milliseconds) used by the analytics wrapper.
 *
 * This does NOT terminate the command. It emits a non-terminating timeout
 * event when the duration threshold is crossed to help diagnose long runs.
 */
export const COMMAND_TIMEOUT_MS = 120000; // 2 minutes (default for quick commands)
