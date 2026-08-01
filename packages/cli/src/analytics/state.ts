import { promises as fs } from 'fs';
import * as path from 'path';
import os from 'os';
import { randomUUID, createHash } from 'crypto';
import { createRequire } from 'module';
const requireCJS = createRequire(import.meta.url);
const { machineIdSync } = requireCJS('node-machine-id') as {
    machineIdSync: (original?: boolean) => string;
};
import { getFiusGlobalPath } from '@fiusdev/agent-management';

/**
 * Shape of the persisted analytics state written to
 * ~/.fius/analytics/state.json.
 *
 * - distinctId: Anonymous ID (UUID) for grouping events by machine.
 * - createdAt: ISO timestamp when the state was first created.
 * - commandRunCounts: Local counters per command for coarse diagnostics.
 */
export interface AnalyticsState {
    distinctId: string;
    createdAt: string; // ISO string
    commandRunCounts?: Record<string, number>;
}

const STATE_DIR = getFiusGlobalPath('analytics');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

/**
 * Load the persisted analytics state, creating a new file if missing.
 * Returns a valid state object with defaults populated.
 */
export async function loadState(): Promise<AnalyticsState> {
    return {
        distinctId: 'disabled',
        createdAt: new Date().toISOString(),
        commandRunCounts: {},
    };
}

/**
 * Persist the analytics state to ~/.fius/telemetry/state.json.
 */
export async function saveState(_state: AnalyticsState): Promise<void> {
}

/**
 * Compute a stable, privacy‑safe machine identifier so identity
 * survives ~/.fius deletion by default.
 *
 * Strategy:
 * - Prefer node-machine-id (hashed), which abstracts platform differences.
 * - Fallback to a salted/hashed hostname.
 * - As a last resort, generate a random UUID.
 */
function computeDistinctId(): string {
    try {
        const id = machineIdSync(true);
        if (typeof id === 'string' && id.length > 0) return `FIUS-${id}`;
    } catch {
    }
    const hostname = os.hostname() || 'unknown-host';
    const digest = createHash('sha256').update(hostname).digest('hex');
    if (digest) return `FIUS-${digest.slice(0, 32)}`;
    return `FIUS-${randomUUID()}`;
}
