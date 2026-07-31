import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { SystemPromptErrorCode } from './error-codes.js';
import { safeStringify } from '../utils/safe-stringify.js';


export class SystemPromptError {
    
    static invalidFileType(filePath: string, allowedExtensions: string[]) {
        return new FiusRuntimeError(
            SystemPromptErrorCode.FILE_INVALID_TYPE,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.USER,
            `File ${filePath} is not a ${allowedExtensions.join(' or ')} file`,
            { filePath, allowedExtensions }
        );
    }

    
    static fileTooLarge(filePath: string, fileSize: number, maxSize: number) {
        return new FiusRuntimeError(
            SystemPromptErrorCode.FILE_TOO_LARGE,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.USER,
            `File ${filePath} exceeds maximum size of ${maxSize} bytes`,
            { filePath, fileSize, maxSize }
        );
    }

    
    static fileReadFailed(filePath: string, reason: string) {
        return new FiusRuntimeError(
            SystemPromptErrorCode.FILE_READ_FAILED,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.SYSTEM,
            `Failed to read file ${filePath}: ${reason}`,
            { filePath, reason }
        );
    }

    
    static unknownContributorSource(source: string) {
        return new FiusRuntimeError(
            SystemPromptErrorCode.CONTRIBUTOR_SOURCE_UNKNOWN,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.USER,
            `No generator registered for dynamic contributor source: ${source}`,
            { source }
        );
    }

    
    static invalidContributorConfig(config: unknown): FiusRuntimeError {
        return new FiusRuntimeError(
            SystemPromptErrorCode.CONTRIBUTOR_CONFIG_INVALID,
            ErrorScope.SYSTEM_PROMPT,
            ErrorType.USER,
            `Invalid contributor config: ${safeStringify(config)}`,
            { config }
        );
    }
}
