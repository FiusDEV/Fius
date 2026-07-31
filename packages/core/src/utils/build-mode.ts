let cachedMode: 'build' | 'plan' = 'build';
let fsReady = false;
let readFileSync: typeof import('fs').readFileSync;
let existsSync: typeof import('fs').existsSync;

async function initFs() {
    if (fsReady) return;
    try {
        const fs = await import('fs');
        readFileSync = fs.readFileSync;
        existsSync = fs.existsSync;
        fsReady = true;
    } catch {}
}

export async function getBuildModeAsync(): Promise<'build' | 'plan'> {
    await initFs();
    try {
        if (fsReady) {
            const { join } = await import('path');
            const { homedir } = await import('os');
            const SETTINGS_PATH = join(homedir(), '.fius', 'settings.json');
            if (existsSync(SETTINGS_PATH)) {
                const data = readFileSync(SETTINGS_PATH, 'utf-8');
                const settings = JSON.parse(data);
                if (settings.buildMode === 'plan' || settings.buildMode === 'build') {
                    cachedMode = settings.buildMode;
                }
            }
        }
    } catch {}
    return cachedMode;
}

export function getBuildMode(): 'build' | 'plan' {
    return cachedMode;
}

export function setBuildMode(mode: 'build' | 'plan'): void {
    cachedMode = mode;
}
