#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLayeredEnvironmentLoading } from './utils/env.js';

if (!process.env.FIUS_PACKAGE_ROOT) {
    const executableDir = dirname(process.execPath);
    if (existsSync(join(executableDir, 'dist'))) {
        process.env.FIUS_PACKAGE_ROOT = executableDir;
    } else {
        const cliDir = dirname(fileURLToPath(import.meta.url));
        if (existsSync(join(cliDir, 'agents'))) {
            process.env.FIUS_PACKAGE_ROOT = dirname(cliDir);
        }
    }
}

await applyLayeredEnvironmentLoading();

await import('./index-main.js');
