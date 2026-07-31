import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname: string = path.dirname(fileURLToPath(import.meta.url));
const rootDir: string = path.resolve(__dirname, '..');

const sourceWebUIDir: string = path.join(rootDir, 'packages', 'webui', 'dist');
const targetDir: string = path.join(rootDir, 'packages', 'cli', 'dist', 'webui');

async function copyWebUIBuild(): Promise<void> {
    try {
        if (!fs.existsSync(sourceWebUIDir)) {
            console.log('⚠️  WebUI dist not found. Run "pnpm build:webui" first.');
            console.log(`   Expected path: ${sourceWebUIDir}`);
            process.exit(1);
        }

        if (fs.existsSync(targetDir)) {
            console.log('Removing existing target directory...');
            fs.rmSync(targetDir, { recursive: true, force: true });
        }

        console.log(`Copying built webui from ${sourceWebUIDir} to ${targetDir}...`);

        fs.mkdirSync(targetDir, { recursive: true });
        fs.copySync(sourceWebUIDir, targetDir);

        const targetIndex = path.join(targetDir, 'index.html');
        if (!fs.existsSync(targetIndex)) {
            console.error('❌ index.html not found in target after copy!');
            process.exit(1);
        }

        console.log('✅ Successfully copied built webui to dist');
        console.log(`   Source: ${sourceWebUIDir}`);
        console.log(`   Target: ${targetDir}`);
    } catch (err: unknown) {
        console.error('❌ Error copying built webui:', err);
        process.exit(1);
    }
}

copyWebUIBuild();
