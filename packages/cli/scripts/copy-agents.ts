#!/usr/bin/env tsx
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { dirname, join, sep } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_DIR = join(__dirname, '../../../agents');
const DEST_DIR = join(__dirname, '../dist/agents');

function copyDirectory(src: string, dest: string): void {
    if (!existsSync(dest)) {
        mkdirSync(dest, { recursive: true });
    }
    for (const entry of readdirSync(src)) {
        const srcPath = join(src, entry);
        const destPath = join(dest, entry);
        if (statSync(srcPath).isDirectory()) {
            copyDirectory(srcPath, destPath);
        } else if (statSync(srcPath).isFile()) {
            copyFileSync(srcPath, destPath);
        }
    }
}

if (existsSync(SOURCE_DIR)) {
    copyDirectory(SOURCE_DIR, DEST_DIR);
    console.log('✅ Agents copied to dist');
} else {
    console.log('⚠️  No agents directory found, skipping');
}
