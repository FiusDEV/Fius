/**
 * Resolves the webRoot path for serving WebUI static files.
 *
 * In production builds, the WebUI dist is embedded at packages/cli/dist/webui.
 * This function returns the absolute path if found, otherwise undefined.
 */
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getFiusPackageRoot } from '@fiusdev/agent-management';

function isValidWebRoot(webRootPath: string): boolean {
    if (!existsSync(webRootPath)) {
        return false;
    }

    const indexPath = path.join(webRootPath, 'index.html');
    return existsSync(indexPath);
}

/**
 * Discovers the webui path for embedded Vite build.
 * @returns Absolute path to webui dist folder, or undefined if not found
 */
export function resolveWebRoot(): string | undefined {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const roots = Array.from(
        new Set([
            getFiusPackageRoot(),
            path.dirname(process.execPath),
            scriptDir,
            path.resolve(scriptDir, '..', '..', 'webui'),
        ])
    ).filter((value): value is string => Boolean(value));

    for (const root of roots) {
        const candidates = [
            path.resolve(root, 'webui'),
            path.resolve(root, 'dist', 'webui'),
            path.resolve(root, 'dist'),
        ];
        for (const webRootPath of candidates) {
            if (isValidWebRoot(webRootPath)) {
                return webRootPath;
            }
        }
    }

    return undefined;
}
