import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '../../..');
const srcPath = path.join(repoRoot, 'README.md');

const cliDir = path.resolve(__dirname, '..');
const destPath = path.join(cliDir, 'README.md');

const GH_BASE = 'https://github.com/FiusDEV/Fius';
const GH_BLOB_HEAD = `${GH_BASE}/blob/HEAD`;
const GH_TREE_HEAD = `${GH_BASE}/tree/HEAD`;

function transform(content: string): string {
    content = content.replace(/^#\s+[^\n]+/, '# Fius CLI');

    content = content
        .replace(/\]\(agents\/\)/g, `](${GH_TREE_HEAD}/agents/)`)
        .replace(/\]\(agents\)/g, `](${GH_TREE_HEAD}/agents)`)
        .replace(
            /\]\(packages\/cli\/src\/discord\/README\.md\)/g,
            `](${GH_BLOB_HEAD}/packages/cli/src/discord/README.md)`
        )
        .replace(
            /\]\(packages\/cli\/src\/telegram\/README\.md\)/g,
            `](${GH_BLOB_HEAD}/packages/cli/src/telegram/README.md)`
        )
        .replace(/\]\(\.\/CONTRIBUTING\.md\)/g, `](${GH_BLOB_HEAD}/CONTRIBUTING.md)`)
        .replace(/\]\(LICENSE\)/g, `](${GH_BLOB_HEAD}/LICENSE)`);

    content = content.replace(
        /<img\s+src="assets\/email_slack_demo\.gif"/g,
        `<img src="${GH_BLOB_HEAD}/assets/email_slack_demo.gif?raw=1"`
    );

    return content;
}

function main(): void {
    const raw = fs.readFileSync(srcPath, 'utf8');
    const out = transform(raw);
    fs.writeFileSync(destPath, out);
    console.log(
        `Synced CLI README from ${path.relative(repoRoot, srcPath)} -> ${path.relative(repoRoot, destPath)}`
    );
}

main();
