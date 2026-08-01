/**
 * Process Service Errors
 *
 * Error classes for process execution and management
 */

import { FiusRuntimeError, ErrorType } from '@fiusdev/core/errors';

/** Error scope for process operations */
const PROCESS_SCOPE = 'process';
import { ProcessErrorCode } from './error-codes.js';

export interface ProcessErrorContext {
    command?: string;
    processId?: string;
    timeout?: number;
    [key: string]: unknown;
}

/**
 * Factory class for creating Process-related errors
 */
export class ProcessError {
    private constructor() {
        // Private constructor prevents instantiation
    }

    /**
     * Invalid command error
     */
    static invalidCommand(command: string, reason: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.INVALID_COMMAND,
            PROCESS_SCOPE,
            ErrorType.USER,
            `Invalid command: ${command}. ${reason}`,
            { command, reason }
        );
    }

    /**
     * Command blocked error
     */
    static commandBlocked(command: string, reason: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.COMMAND_BLOCKED,
            PROCESS_SCOPE,
            ErrorType.FORBIDDEN,
            `Command is blocked: ${command}. ${reason}`,
            { command, reason }
        );
    }

    /**
     * Command too long error
     */
    static commandTooLong(length: number, maxLength: number): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.COMMAND_TOO_LONG,
            PROCESS_SCOPE,
            ErrorType.USER,
            `Command too long: ${length} characters. Maximum allowed: ${maxLength}`,
            { length, maxLength }
        );
    }

    /**
     * Command injection detected error
     */
    static commandInjection(command: string, pattern: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.INJECTION_DETECTED,
            PROCESS_SCOPE,
            ErrorType.FORBIDDEN,
            `Potential command injection detected in: ${command}. Pattern: ${pattern}`,
            { command, pattern }
        );
    }

    /**
     * Command approval required error
     */
    static approvalRequired(command: string, reason?: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.APPROVAL_REQUIRED,
            PROCESS_SCOPE,
            ErrorType.FORBIDDEN,
            `Command requires approval: ${command}${reason ? `. ${reason}` : ''}`,
            { command, reason },
            'Provide an approval function to execute dangerous commands'
        );
    }

    /**
     * Command approval denied error
     */
    static approvalDenied(command: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.APPROVAL_DENIED,
            PROCESS_SCOPE,
            ErrorType.FORBIDDEN,
            `Command approval denied by user: ${command}`,
            { command }
        );
    }

    /**
     * Command execution failed error
     */
    static executionFailed(command: string, cause: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.EXECUTION_FAILED,
            PROCESS_SCOPE,
            ErrorType.SYSTEM,
            `Command execution failed: ${command}. ${cause}`,
            { command, cause }
        );
    }

    /**
     * Command timeout error
     */
    static timeout(command: string, timeout: number): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.TIMEOUT,
            PROCESS_SCOPE,
            ErrorType.TIMEOUT,
            `Command timed out after ${timeout}ms: ${command}`,
            { command, timeout },
            'Increase timeout or optimize the command'
        );
    }

    /**
     * Permission denied error
     */
    static permissionDenied(command: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.PERMISSION_DENIED,
            PROCESS_SCOPE,
            ErrorType.FORBIDDEN,
            `Permission denied: ${command}`,
            { command }
        );
    }

    /**
     * Command not found error
     */
    static commandNotFound(command: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.COMMAND_NOT_FOUND,
            PROCESS_SCOPE,
            ErrorType.NOT_FOUND,
            `Command not found: ${command}`,
            { command },
            'Ensure the command is installed and available in PATH'
        );
    }

    /**
     * Invalid working directory error
     */
    static invalidWorkingDirectory(path: string, reason: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.WORKING_DIRECTORY_INVALID,
            PROCESS_SCOPE,
            ErrorType.USER,
            `Invalid working directory: ${path}. ${reason}`,
            { path, reason }
        );
    }

    /**
     * Process not found error
     */
    static processNotFound(processId: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.PROCESS_NOT_FOUND,
            PROCESS_SCOPE,
            ErrorType.NOT_FOUND,
            `Process not found: ${processId}`,
            { processId }
        );
    }

    /**
     * Too many concurrent processes error
     */
    static tooManyProcesses(current: number, max: number): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.TOO_MANY_PROCESSES,
            PROCESS_SCOPE,
            ErrorType.USER,
            `Too many concurrent processes: ${current}. Maximum allowed: ${max}`,
            { current, max },
            'Wait for running processes to complete or increase the limit'
        );
    }

    /**
     * Kill process failed error
     */
    static killFailed(processId: string, cause: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.KILL_FAILED,
            PROCESS_SCOPE,
            ErrorType.SYSTEM,
            `Failed to kill process ${processId}: ${cause}`,
            { processId, cause }
        );
    }

    /**
     * Output buffer full error
     */
    static outputBufferFull(processId: string, size: number, maxSize: number): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.OUTPUT_BUFFER_FULL,
            PROCESS_SCOPE,
            ErrorType.SYSTEM,
            `Output buffer full for process ${processId}: ${size} bytes. Maximum: ${maxSize}`,
            { processId, size, maxSize },
            'Process output exceeded buffer limit'
        );
    }

    /**
     * Invalid configuration error
     */
    static invalidConfig(reason: string): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.INVALID_CONFIG,
            PROCESS_SCOPE,
            ErrorType.USER,
            `Invalid Process configuration: ${reason}`,
            { reason }
        );
    }

    /**
     * Service not initialized error
     */
    static notInitialized(): FiusRuntimeError {
        return new FiusRuntimeError(
            ProcessErrorCode.SERVICE_NOT_INITIALIZED,
            PROCESS_SCOPE,
            ErrorType.SYSTEM,
            'ProcessService has not been initialized',
            {},
            'Initialize the ProcessService before using it'
        );
    }
}
