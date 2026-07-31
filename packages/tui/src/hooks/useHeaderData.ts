

import { useState, useEffect } from 'react';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';

const BASE_URL = process.env.FIUS_PLATFORM_URL || process.env.FIUS_API_URL || 'https://fius.dev';

function getUserEmail(): string {
    try {
        const authPath = path.join(os.homedir(), '.fius', 'auth.json');
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
        return auth.email || '';
    } catch {
        return '';
    }
}

function readApiKey(): string | null {
    try {
        const authPath = path.join(os.homedir(), '.fius', 'auth.json');
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
        return auth.fiusApiKey || null;
    } catch {
        return null;
    }
}

async function fetchVersion(): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const resp = await fetch(`${BASE_URL}/api/cli/version`, { signal: controller.signal });
            clearTimeout(timeout);
            if (resp.ok) {
                const data = await resp.json();
                if (data.latest_version) return data.latest_version;
            }
        } catch {
            // Retry once on network error
        }
    }
    return 'unknown';
}

async function fetchPlan(): Promise<string | null> {
    const apiKey = readApiKey();
    if (!apiKey) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const resp = await fetch(`${BASE_URL}/api/cli/user`, {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (resp.ok) {
                const data = await resp.json();
                if (data.plan) return data.plan;
            }
        } catch {
            // Retry once on network error
        }
    }
    return null;
}

export interface HeaderData {
    version: string | null;
    email: string;
    plan: string | null;
}

export function useHeaderData(): HeaderData {
    const [version, setVersion] = useState<string | null>(null);
    const [plan, setPlan] = useState<string | null>(null);
    const email = getUserEmail();

    useEffect(() => {
        fetchVersion().then(setVersion);
        fetchPlan().then(setPlan);
    }, []);

    return { version, email, plan };
}
