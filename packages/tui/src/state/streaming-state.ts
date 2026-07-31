import { promises as fs, watch } from 'fs';
import path from 'path';
import { homedir } from 'os';

type StreamingListener = (enabled: boolean) => void;
type BuildModeListener = (mode: 'build' | 'plan') => void;

const SETTINGS_PATH = path.join(homedir(), '.fius', 'settings.json');
let streamingEnabled = false;
let buildMode: 'build' | 'plan' = 'build';
const streamingListeners = new Set<StreamingListener>();
const buildModeListeners = new Set<BuildModeListener>();
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
        if (settings.buildMode === 'plan' || settings.buildMode === 'build') {
            buildMode = settings.buildMode;
        }
    } catch {
        // File doesn't exist or invalid — use defaults
    }
}

async function reloadSettings(): Promise<void> {
    try {
        const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
        const settings = JSON.parse(data);
        if (typeof settings.streaming === 'boolean' && settings.streaming !== streamingEnabled) {
            streamingEnabled = settings.streaming;
            streamingListeners.forEach((listener) => listener(streamingEnabled));
        }
        const newMode = settings.buildMode === 'plan' ? 'plan' : 'build';
        if (newMode !== buildMode) {
            buildMode = newMode;
            buildModeListeners.forEach((listener) => listener(buildMode));
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

async function saveStreamingSettings(): Promise<void> {
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

async function saveBuildModeSettings(): Promise<void> {
    try {
        let settings: Record<string, unknown> = {};
        try {
            const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
            settings = JSON.parse(data);
        } catch {
            // File doesn't exist, start fresh
        }
        settings.buildMode = buildMode;
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
        streamingListeners.forEach((listener) => listener(enabled));
        await saveStreamingSettings();
    }
}

export async function toggleStreaming(): Promise<boolean> {
    await loadSettings();
    streamingEnabled = !streamingEnabled;
    streamingListeners.forEach((listener) => listener(streamingEnabled));
    await saveStreamingSettings();
    return streamingEnabled;
}

export function subscribeToStreaming(listener: StreamingListener): () => void {
    streamingListeners.add(listener);
    return () => streamingListeners.delete(listener);
}

export async function getBuildModeAsync(): Promise<'build' | 'plan'> {
    await loadSettings();
    startWatching();
    return buildMode;
}

export function getBuildMode(): 'build' | 'plan' {
    return buildMode;
}

export async function setBuildMode(mode: 'build' | 'plan'): Promise<void> {
    await loadSettings();
    if (buildMode !== mode) {
        buildMode = mode;
        buildModeListeners.forEach((listener) => listener(mode));
        await saveBuildModeSettings();
    }
}

export async function toggleBuildMode(): Promise<'build' | 'plan'> {
    await loadSettings();
    buildMode = buildMode === 'build' ? 'plan' : 'build';
    buildModeListeners.forEach((listener) => listener(buildMode));
    await saveBuildModeSettings();
    return buildMode;
}

export function subscribeToBuildMode(listener: BuildModeListener): () => void {
    buildModeListeners.add(listener);
    return () => buildModeListeners.delete(listener);
}
