import { FiusValidationError } from '../errors/FiusValidationError.js';
import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { ErrorType } from '../errors/types.js';
import { WorkspaceErrorCodes } from './error-codes.js';

export class WorkspaceError {
    static pathRequired(): FiusValidationError {
        return new FiusValidationError([
            {
                code: WorkspaceErrorCodes.PATH_REQUIRED,
                message: 'Workspace path is required',
                scope: 'workspace',
                type: ErrorType.USER,
                severity: 'error',
                path: ['path'],
            },
        ]);
    }

    static currentWorkspaceRequired(): FiusValidationError {
        return new FiusValidationError([
            {
                code: WorkspaceErrorCodes.CURRENT_WORKSPACE_REQUIRED,
                message: 'Current workspace is required',
                scope: 'workspace',
                type: ErrorType.USER,
                severity: 'error',
                path: ['currentWorkspace'],
            },
        ]);
    }

    static handleProviderRequired(): FiusValidationError {
        return new FiusValidationError([
            {
                code: WorkspaceErrorCodes.HANDLE_PROVIDER_REQUIRED,
                message: 'Workspace handle provider is required',
                scope: 'workspace',
                type: ErrorType.SYSTEM,
                severity: 'error',
                path: ['handleProvider'],
            },
        ]);
    }

    static fileNotFound(path: string): FiusRuntimeError<{ path: string }> {
        return new FiusRuntimeError(
            WorkspaceErrorCodes.FILE_NOT_FOUND,
            'workspace',
            ErrorType.NOT_FOUND,
            `Workspace file not found: ${path}`,
            { path }
        );
    }

    static pathOutsideWorkspace(path: string): FiusRuntimeError<{ path: string }> {
        return new FiusRuntimeError(
            WorkspaceErrorCodes.PATH_OUTSIDE_WORKSPACE,
            'workspace',
            ErrorType.FORBIDDEN,
            `Workspace path escapes root: ${path}`,
            { path }
        );
    }
}
