import { FiusRuntimeError } from '../../errors/FiusRuntimeError.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { LoggerErrorCode } from './error-codes.js';

export class LoggerError {
    static transportNotImplemented(
        transportType: string,
        availableTransports: string[]
    ): FiusRuntimeError {
        return new FiusRuntimeError(
            LoggerErrorCode.TRANSPORT_NOT_IMPLEMENTED,
            ErrorScope.LOGGER,
            ErrorType.USER,
            `${transportType} transport not yet implemented. Available transports: ${availableTransports.join(', ')}`,
            { transportType, availableTransports }
        );
    }

    static unknownTransportType(transportType: string): FiusRuntimeError {
        return new FiusRuntimeError(
            LoggerErrorCode.TRANSPORT_UNKNOWN_TYPE,
            ErrorScope.LOGGER,
            ErrorType.USER,
            `Unknown transport type: ${transportType}`,
            { transportType }
        );
    }

    static transportInitializationFailed(
        transportType: string,
        reason: string,
        details?: Record<string, unknown>
    ): FiusRuntimeError {
        return new FiusRuntimeError(
            LoggerErrorCode.TRANSPORT_INITIALIZATION_FAILED,
            ErrorScope.LOGGER,
            ErrorType.SYSTEM,
            `Failed to initialize ${transportType} transport: ${reason}`,
            { transportType, reason, ...(details ?? {}) }
        );
    }

    static transportWriteFailed(transportType: string, error: unknown): FiusRuntimeError {
        return new FiusRuntimeError(
            LoggerErrorCode.TRANSPORT_WRITE_FAILED,
            ErrorScope.LOGGER,
            ErrorType.SYSTEM,
            `Transport write failed for ${transportType}`,
            {
                transportType,
                originalError: error instanceof Error ? error.message : String(error),
            }
        );
    }

    static invalidConfig(message: string, context?: Record<string, unknown>): FiusRuntimeError {
        return new FiusRuntimeError(
            LoggerErrorCode.INVALID_CONFIG,
            ErrorScope.LOGGER,
            ErrorType.USER,
            `Invalid logger configuration: ${message}`,
            context
        );
    }

    static invalidLogLevel(level: string, validLevels: string[]): FiusRuntimeError {
        return new FiusRuntimeError(
            LoggerErrorCode.INVALID_LOG_LEVEL,
            ErrorScope.LOGGER,
            ErrorType.USER,
            `Invalid log level '${level}'. Valid levels: ${validLevels.join(', ')}`,
            { level, validLevels }
        );
    }
}
