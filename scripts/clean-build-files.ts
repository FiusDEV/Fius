#!/usr/bin/env tsx

/**
 * Clean build artifacts, temporary files, and caches across the monorepo
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Directories to clean (relative to root and packages)
const CLEAN_DIRS = [
    // Build outputs
    'dist',
    'build',
    '.next',
    '.turbo',

    // Cache directories
    '.eslintcache',
    '.tsbuildinfo',
    'tsconfig.tsbuildinfo',

    // Test artifacts
    'coverage',
    '.nyc_output',
    'test-temp',

    // Logs
    'logs',
    '*.log',
];

// Files to clean by extension
const CLEAN_EXTENSIONS = [
    '.tsbuildinfo',
    '.log',
    '.tgz', // Remove any leftover tarballs
];

// Directories to never delete (safety)
const PROTECTED_DIRS = [
    '.git',
    '.github',
    'node_modules', // Let pnpm handle these
];

async function cleanDirectory(dir: string, targetName: string): Promise<void> {
    const targetPath = path.join(dir, targetName);

    if (await fs.pathExists(targetPath)) {
        try {
            await fs.remove(targetPath);
            console.log(`✅ Removed: ${path.relative(rootDir, targetPath)}`);
        } catch (err) {
            console.error(`⚠️  Failed to remove: ${path.relative(rootDir, targetPath)}`, err);
        }
    }
}

async function cleanPackages(): Promise<void> {
    const packagesDir = path.join(rootDir, 'packages');

    if (!(await fs.pathExists(packagesDir))) {
        console.log('⚠️  No packages directory found');
        return;
    }

    const packages = await fs.readdir(packagesDir);

    for (const pkg of packages) {
        const pkgPath = path.join(packagesDir, pkg);
        const stat = await fs.stat(pkgPath);

        if (stat.isDirectory()) {
            console.log(`\n📦 Cleaning package: ${pkg}`);

            // Clean each target directory in the package
            for (const target of CLEAN_DIRS) {
                await cleanDirectory(pkgPath, target);
            }
        }
    }
}

async function cleanRoot(): Promise<void> {
    console.log('\n🏠 Cleaning root directory');

    // Clean root-level directories
    for (const target of CLEAN_DIRS) {
        await cleanDirectory(rootDir, target);
    }

    // Clean root-level files by extension
    const rootFiles = await fs.readdir(rootDir);
    for (const file of rootFiles) {
        const shouldDelete = CLEAN_EXTENSIONS.some((ext) => file.endsWith(ext));
        if (shouldDelete) {
            const filePath = path.join(rootDir, file);
            try {
                await fs.remove(filePath);
                console.log(`✅ Removed: ${file}`);
            } catch (err) {
                console.error(`⚠️  Failed to remove: ${file}`, err);
            }
        }
    }
}

async function main(): Promise<void> {
    console.log('🧹 Starting comprehensive cleanup...\n');
    console.log('This will remove:');
    console.log('  • Package dist and build directories');
    console.log('  • Next.js .next directories');
    console.log('  • TypeScript build info files');
    console.log('  • Test coverage reports');
    console.log('  • Logs and cache files');
    console.log('  • Leftover tarballs\n');

    try {
        await cleanPackages();
        await cleanRoot();
        // NOTE: cleanStorage() is NOT called here to preserve conversation history
        // Use `pnpm clean:storage` explicitly if you need to wipe .fius

        console.log('\n✨ Cleanup completed successfully!');
        console.log('Run "pnpm install" if you need to reinstall dependencies.');
        console.log('Note: .fius storage was preserved. Use "pnpm clean:storage" to wipe it.');
    } catch (err) {
        console.error('\n❌ Cleanup failed:', err);
        process.exit(1);
    }
}

// Execute cleanup
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
