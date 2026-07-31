import { promises as fs, watch } from 'fs';
import path from 'path';
import { homedir } from 'os';

type StreamingListener = (enabled: boolean) => void;

const SETTINGS_PATH = path.join(homedir(), '.fius', 'settings.json');
let streamingEnabled = false;
const listeners = new Set<StreamingListener>();
let loaded = false;

async function loadSettings(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
        const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
        const settings = JSON.parse(data);
        if (typeof settings.streaming === 'boolean') {
            streamingEnabled = settings.streaming;
        }
    } catch {
        // File doesn't exist or invalid — use default (false)
    }
}

async function reloadSettings(): Promise<void> {
    try {
        const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
        const settings = JSON.parse(data);
        if (typeof settings.streaming === 'boolean' && settings.streaming !== streamingEnabled) {
            streamingEnabled = settings.streaming;
            listeners.forEach((listener) => listener(streamingEnabled));
        }
    } catch {
        // ignore
    }
}

function startWatching(): void {
    try {
        const dir = path.dirname(SETTINGS_PATH);
        watch(dir, (eventType, filename) => {
            if (filename === 'settings.json' && eventType === 'change') {
                void reloadSettings();
            }
        });
    } catch {
        // ignore watch errors
    }
}

async function saveSettings(): Promise<void> {
    try {
        let settings: Record<string, unknown> = {};
        try {
            const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
            settings = JSON.parse(data);
        } catch {
            // File doesn't exist, start fresh
        }
        settings.streaming = streamingEnabled;
        const dir = path.dirname(SETTINGS_PATH);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch {
        // Ignore write errors
    }
}

export async function isStreamingEnabledAsync(): Promise<boolean> {
    await loadSettings();
    startWatching();
    return streamingEnabled;
}

export function isStreamingEnabled(): boolean {
    return streamingEnabled;
}

export async function setStreamingEnabled(enabled: boolean): Promise<void> {
    await loadSettings();
    if (streamingEnabled !== enabled) {
        streamingEnabled = enabled;
        listeners.forEach((listener) => listener(enabled));
        await saveSettings();
    }
}

export async function toggleStreaming(): Promise<boolean> {
    await loadSettings();
    streamingEnabled = !streamingEnabled;
    listeners.forEach((listener) => listener(streamingEnabled));
    await saveSettings();
    return streamingEnabled;
}

export function subscribeToStreaming(listener: StreamingListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
