const esbuild = require('esbuild');
const path = require('path');

async function bundle() {
    await esbuild.build({
        entryPoints: [path.join(__dirname, '..', 'packages', 'cli', 'dist', 'index.js')],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'esm',
        outfile: path.join(__dirname, '..', 'packages', 'cli', 'dist', 'index.bundle.js'),
        external: ['better-sqlite3', 'pg', 'ioredis', 'ws'],
        banner: {
            js: '#!/usr/bin/env node'
        },
        minify: false,
        sourcemap: false,
    });
    console.log('Bundle created successfully!');
}

bundle().catch((err) => {
    console.error(err);
    process.exit(1);
});
