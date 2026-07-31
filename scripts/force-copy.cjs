const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'packages', 'webui', 'dist');
const dst = path.join(__dirname, '..', 'packages', 'cli', 'dist', 'webui');

fs.rmSync(dst, { recursive: true, force: true });
console.log('Deleted:', !fs.existsSync(dst));

fs.cpSync(src, dst, { recursive: true });
console.log('Copied');

const html = fs.readFileSync(path.join(dst, 'index.html'), 'utf-8');
const lines = html.split('\n').filter(l => l.includes('index-') && l.includes('.js'));
console.log('Script tag:', lines[0]?.trim());

const files = fs.readdirSync(path.join(dst, 'assets')).filter(f => f.startsWith('index-') && f.endsWith('.js'));
console.log('JS files:', files);
