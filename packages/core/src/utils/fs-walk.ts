import * as path from 'path';


export function walkUpDirectories(
    startPath: string,
    predicate: (dirPath: string) => boolean
): string | null {
    let currentPath = path.resolve(startPath);
    const rootPath = path.parse(currentPath).root;

    while (true) {
        if (predicate(currentPath)) {
            return currentPath;
        }
        if (currentPath === rootPath) break;
        const parent = path.dirname(currentPath);
        if (parent === currentPath) break;
        currentPath = parent;
    }

    return null;
}
