import { FiusRuntimeError, FiusValidationError } from '../errors/index.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { StorageErrorCode } from './error-codes.js';


export class StorageError {
    
    static connectionFailed(reason: string, config?: Record<string, unknown>) {
        return new FiusRuntimeError(
            StorageErrorCode.CONNECTION_FAILED,
            ErrorScope.STORAGE,
            ErrorType.THIRD_PARTY,
            `Storage connection failed: ${reason}`,
            { reason, config }
        );
    }

    
    static notConnected(backendType: string) {
        return new FiusRuntimeError(
            StorageErrorCode.CONNECTION_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `${backendType} not connected`,
            { backendType }
        );
    }

    
    static managerNotInitialized(method: string) {
        return new FiusRuntimeError(
            StorageErrorCode.MANAGER_NOT_INITIALIZED,
            ErrorScope.STORAGE,
            ErrorType.USER,
            `Storage stores are not initialized. Call initialize() before ${method}()`,
            { method, hint: 'Initialize the configured FiusStores before use' }
        );
    }

    
    static managerNotConnected(method: string) {
        return new FiusRuntimeError(
            StorageErrorCode.MANAGER_NOT_CONNECTED,
            ErrorScope.STORAGE,
            ErrorType.USER,
            `Storage stores are not connected. Call connect() before ${method}()`,
            { method, hint: 'Call await stores.connect() before use' }
        );
    }

    
    static dependencyNotInstalled(
        backendType: string,
        packageName: string,
        installCommand: string
    ) {
        return new FiusRuntimeError(
            StorageErrorCode.DEPENDENCY_NOT_INSTALLED,
            ErrorScope.STORAGE,
            ErrorType.USER,
            `${backendType} storage configured but '${packageName}' package is not installed`,
            {
                backendType,
                packageName,
                hint: `Install with: ${installCommand}`,
                recovery: `Either install the package or change storage type to 'in-memory'`,
            }
        );
    }

    
    static readFailed(operation: string, reason: string, details?: Record<string, unknown>) {
        return new FiusRuntimeError(
            StorageErrorCode.READ_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Storage read failed for ${operation}: ${reason}`,
            { operation, reason, ...details }
        );
    }

    
    static writeFailed(operation: string, reason: string, details?: Record<string, unknown>) {
        return new FiusRuntimeError(
            StorageErrorCode.WRITE_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Storage write failed for ${operation}: ${reason}`,
            { operation, reason, ...details }
        );
    }

    
    static deleteFailed(operation: string, reason: string, details?: Record<string, unknown>) {
        return new FiusRuntimeError(
            StorageErrorCode.DELETE_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Storage delete failed for ${operation}: ${reason}`,
            { operation, reason, ...details }
        );
    }

    
    static migrationFailed(reason: string, details?: Record<string, unknown>) {
        return new FiusRuntimeError(
            StorageErrorCode.MIGRATION_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Database migration failed: ${reason}`,
            { reason, ...details }
        );
    }

    
    static databaseInvalidConfig(
        message: string,
        context?: Record<string, unknown>
    ): FiusValidationError {
        return new FiusValidationError([
            {
                code: StorageErrorCode.DATABASE_INVALID_CONFIG,
                message,
                scope: ErrorScope.STORAGE,
                type: ErrorType.USER,
                severity: 'error' as const,
                context: context || {},
            },
        ]);
    }

    
    static cacheInvalidConfig(
        message: string,
        context?: Record<string, unknown>
    ): FiusValidationError {
        return new FiusValidationError([
            {
                code: StorageErrorCode.CACHE_INVALID_CONFIG,
                message,
                scope: ErrorScope.STORAGE,
                type: ErrorType.USER,
                severity: 'error' as const,
                context: context || {},
            },
        ]);
    }

    static blobInvalidConfig(
        message: string,
        context?: Record<string, unknown>
    ): FiusValidationError {
        return new FiusValidationError([
            {
                code: StorageErrorCode.BLOB_INVALID_CONFIG,
                message,
                scope: ErrorScope.STORAGE,
                type: ErrorType.USER,
                severity: 'error' as const,
                context: context || {},
            },
        ]);
    }

    
    static blobSizeExceeded(size: number, maxSize: number): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_SIZE_EXCEEDED,
            ErrorScope.STORAGE,
            ErrorType.USER,
            `Blob size ${size} bytes exceeds maximum ${maxSize} bytes`,
            { size, maxSize }
        );
    }

    
    static blobTotalSizeExceeded(totalSize: number, maxTotalSize: number): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_TOTAL_SIZE_EXCEEDED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Total storage size ${totalSize} bytes exceeds maximum ${maxTotalSize} bytes`,
            { totalSize, maxTotalSize }
        );
    }

    
    static blobInvalidInput(input: unknown, reason: string): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_INVALID_INPUT,
            ErrorScope.STORAGE,
            ErrorType.USER,
            `Invalid blob input: ${reason}`,
            { inputType: typeof input, reason }
        );
    }

    
    static blobEncodingError(operation: string, error: unknown): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_ENCODING_ERROR,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Blob ${operation} failed: encoding error`,
            { operation, originalError: error instanceof Error ? error.message : String(error) }
        );
    }

    
    static blobNotFound(reference: string): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_NOT_FOUND,
            ErrorScope.STORAGE,
            ErrorType.NOT_FOUND,
            `Blob not found: ${reference}`,
            { reference }
        );
    }

    
    static blobInvalidReference(reference: string, reason: string): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_INVALID_REFERENCE,
            ErrorScope.STORAGE,
            ErrorType.USER,
            `Invalid blob reference '${reference}': ${reason}`,
            { reference, reason }
        );
    }

    
    static blobAccessDenied(reference: string, operation: string): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_ACCESS_DENIED,
            ErrorScope.STORAGE,
            ErrorType.FORBIDDEN,
            `Access denied for blob ${operation}: ${reference}`,
            { reference, operation }
        );
    }

    
    static blobCorrupted(reference: string, reason: string): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_CORRUPTED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Blob data corrupted: ${reference} (${reason})`,
            { reference, reason }
        );
    }

    
    static blobBackendNotConnected(backendType: string): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_BACKEND_NOT_CONNECTED,
            ErrorScope.STORAGE,
            ErrorType.THIRD_PARTY,
            `Blob backend ${backendType} is not connected`,
            { backendType }
        );
    }

    
    static blobBackendUnavailable(backendType: string, error: unknown): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_BACKEND_UNAVAILABLE,
            ErrorScope.STORAGE,
            ErrorType.THIRD_PARTY,
            `Blob backend ${backendType} is unavailable`,
            { backendType, originalError: error instanceof Error ? error.message : String(error) }
        );
    }

    
    static blobCleanupFailed(backendType: string, error: unknown): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_CLEANUP_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Blob cleanup failed for backend ${backendType}`,
            { backendType, originalError: error instanceof Error ? error.message : String(error) }
        );
    }

    
    static blobOperationFailed(
        operation: string,
        backendType: string,
        error: unknown
    ): FiusRuntimeError {
        return new FiusRuntimeError(
            StorageErrorCode.BLOB_OPERATION_FAILED,
            ErrorScope.STORAGE,
            ErrorType.SYSTEM,
            `Blob ${operation} failed for backend ${backendType}`,
            {
                operation,
                backendType,
                originalError: error instanceof Error ? error.message : String(error),
            }
        );
    }

}
