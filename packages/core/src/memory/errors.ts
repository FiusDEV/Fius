import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { MemoryErrorCode } from './error-codes.js';

export class MemoryError {
    static notFound(id: string): FiusRuntimeError {
        return new FiusRuntimeError(
            MemoryErrorCode.MEMORY_NOT_FOUND,
            ErrorScope.MEMORY,
            ErrorType.NOT_FOUND,
            `Memory not found: ${id}`,
            { id }
        );
    }

    static alreadyExists(id: string): FiusRuntimeError {
        return new FiusRuntimeError(
            MemoryErrorCode.MEMORY_ALREADY_EXISTS,
            ErrorScope.MEMORY,
            ErrorType.USER,
            `Memory already exists: ${id}`,
            { id }
        );
    }

    static contentRequired(): FiusRuntimeError {
        return new FiusRuntimeError(
            MemoryErrorCode.MEMORY_CONTENT_REQUIRED,
            ErrorScope.MEMORY,
            ErrorType.USER,
            'Memory content is required'
        );
    }

    static contentTooLong(length: number, maxLength: number): FiusRuntimeError {
        return new FiusRuntimeError(
            MemoryErrorCode.MEMORY_CONTENT_TOO_LONG,
            ErrorScope.MEMORY,
            ErrorType.USER,
            `Memory content too long: ${length} characters (max: ${maxLength})`,
            { length, maxLength }
        );
    }

    static invalidId(id: string): FiusRuntimeError {
        return new FiusRuntimeError(
            MemoryErrorCode.MEMORY_INVALID_ID,
            ErrorScope.MEMORY,
            ErrorType.USER,
            `Invalid memory ID: ${id}`,
            { id }
        );
    }

    static invalidTags(tags: unknown): FiusRuntimeError {
        return new FiusRuntimeError(
            MemoryErrorCode.MEMORY_INVALID_TAGS,
            ErrorScope.MEMORY,
            ErrorType.USER,
            `Invalid tags format: ${JSON.stringify(tags)}`,
            { tags }
        );
    }

    static storageError(message: string, cause?: Error): FiusRuntimeError {
        return new FiusRuntimeError(
            MemoryErrorCode.MEMORY_STORAGE_ERROR,
            ErrorScope.MEMORY,
            ErrorType.SYSTEM,
            `Memory storage error: ${message}`,
            { cause }
        );
    }

    static retrievalError(message: string, cause?: Error): FiusRuntimeError {
        return new FiusRuntimeError(
            MemoryErrorCode.MEMORY_RETRIEVAL_ERROR,
            ErrorScope.MEMORY,
            ErrorType.SYSTEM,
            `Memory retrieval error: ${message}`,
            { cause }
        );
    }

    static deleteError(message: string, cause?: Error): FiusRuntimeError {
        return new FiusRuntimeError(
            MemoryErrorCode.MEMORY_DELETE_ERROR,
            ErrorScope.MEMORY,
            ErrorType.SYSTEM,
            `Memory deletion error: ${message}`,
            { cause }
        );
    }
}
