import path from 'node:path';
import { FiusRuntimeError } from '@fiusdev/core/errors';
import { WorkspaceErrorCodes } from '@fiusdev/core/workspace';
import { ToolError } from '@fiusdev/core/tools';

export function toWorkspaceRelativePath(
    toolName: string,
    workspaceRoot: string,
    filePath: string
): string {
    if (!path.isAbsolute(filePath)) {
        assertRelativePath(toolName, filePath);
        return filePath.split(path.sep).join('/');
    }

    const relativePath = path.relative(workspaceRoot, filePath);
    if (relativePath === '') {
        return '.';
    }
    return relativePath.split(path.sep).join('/');
}

export function isWorkspaceFileNotFound(error: unknown): boolean {
    if (
        error instanceof FiusRuntimeError &&
        (error.code === WorkspaceErrorCodes.FILE_NOT_FOUND ||
            error.code === WorkspaceErrorCodes.PATH_OUTSIDE_WORKSPACE)
    ) {
        return true;
    }
    if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === WorkspaceErrorCodes.FILE_NOT_FOUND ||
            error.code === WorkspaceErrorCodes.PATH_OUTSIDE_WORKSPACE ||
            error.code === 'ENOENT')
    ) {
        return true;
    }
    return false;
}

export function assertWorkspaceRelativeGlob(toolName: string, pattern: string): void {
    if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) {
        throw ToolError.validationFailed(
            toolName,
            `Glob pattern must stay inside the active workspace: ${pattern}`,
            { pattern }
        );
    }
}

function assertRelativePath(toolName: string, filePath: string): void {
    if (filePath.split(/[\\/]/).includes('..')) {
        throw ToolError.validationFailed(
            toolName,
            `Path must stay inside the active workspace: ${filePath}`,
            { file_path: filePath }
        );
    }
}
