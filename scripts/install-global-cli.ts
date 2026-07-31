#!/usr/bin/env tsx
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = join(__dirname, '..');
const CLI_DIR = join(rootDir, 'packages', 'cli');

function run(cmd: string, cwd?: string) {
    console.log(`> ${cmd}`);
    execSync(cmd, { cwd, stdio: 'inherit' });
}

function main() {
    const action = process.argv[2] || 'link';

    if (!existsSync(join(CLI_DIR, 'dist', 'index.js'))) {
        console.error('CLI not built. Run "pnpm build" first.');
        process.exit(1);
    }

    switch (action) {
        case 'link':
            console.log('\n🔗 Linking CLI globally...\n');
            run('npm link', CLI_DIR);
            console.log('\n✅ Done! You can now run "fius" from anywhere.\n');
            break;

        case 'unlink':
            console.log('\n🔓 Unlinking CLI...\n');
            run('npm unlink -g fius');
            console.log('\n✅ Done! "fius" command removed.\n');
            break;

        case 'install':
            console.log('\n📦 Installing CLI globally...\n');
            run('npm install -g .', CLI_DIR);
            console.log('\n✅ Done! You can now run "fius" from anywhere.\n');
            break;

        default:
            console.error(`Unknown action: ${action}`);
            console.error('Usage: tsx scripts/install-global-cli.ts [link|unlink|install]');
            process.exit(1);
    }
}

main();
