const fs = require('fs');
const path = require('path');

const packagesDir = path.join(__dirname, '..', 'packages');
const packages = fs.readdirSync(packagesDir).filter(d => {
    const pkgPath = path.join(packagesDir, d, 'package.json');
    return fs.existsSync(pkgPath) && d !== 'cli';
});

for (const pkg of packages) {
    const pkgPath = path.join(packagesDir, pkg, 'package.json');
    try {
        const content = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        content.name = `@fiusdev/${pkg}`;
        content.version = '0.1.0';
        content.publishConfig = { access: 'public' };
        fs.writeFileSync(pkgPath, JSON.stringify(content, null, 2) + '\n');
        console.log(`Fixed: ${pkg}`);
    } catch (e) {
        console.log(`Skip: ${pkg} - ${e.message}`);
    }
}
