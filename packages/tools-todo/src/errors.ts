/**
 * Todo Service Errors
 *
 * Error factory for todo list management operations
 */

import { FiusRuntimeError, ErrorScope, ErrorType } from '@fius/core/errors';
import { TodoErrorCode } from './error-codes.js';

/**
 * Error scope for todo-related errors.
 * Uses a custom string since todo is a custom tool, not part of core.
 */
const TODO_ERROR_SCOPE = 'todo';

/**
 * Factory class for creating Todo-related errors
 */
export class TodoError {
    private constructor() {
        // Private constructor prevents instantiation
    }

    /**
     * Service not initialized error
     */
    static notInitialized(): FiusRuntimeError {
        return new FiusRuntimeError(
            TodoErrorCode.SERVICE_NOT_INITIALIZED,
            TODO_ERROR_SCOPE,
            ErrorType.SYSTEM,
            'TodoService has not been initialized',
            {},
            'Initialize the TodoService before using it'
        );
    }

    /**
     * Todo limit exceeded error
     */
    static todoLimitExceeded(current: number, max: number): FiusRuntimeError {
        return new FiusRuntimeError(
            TodoErrorCode.TODO_LIMIT_EXCEEDED,
            TODO_ERROR_SCOPE,
            ErrorType.USER,
            `Todo limit exceeded: ${current} todos. Maximum allowed: ${max}`,
            { current, max },
            'Complete or delete existing todos before adding new ones'
        );
    }

    /**
     * Invalid todo status error
     */
    static invalidStatus(status: string): FiusRuntimeError {
        return new FiusRuntimeError(
            TodoErrorCode.INVALID_TODO_STATUS,
            TODO_ERROR_SCOPE,
            ErrorType.USER,
            `Invalid todo status: ${status}. Must be 'pending', 'in_progress', or 'completed'`,
            { status }
        );
    }

    /**
     * Database error
     */
    static databaseError(operation: string, cause: string): FiusRuntimeError {
        return new FiusRuntimeError(
            TodoErrorCode.DATABASE_ERROR,
            TODO_ERROR_SCOPE,
            ErrorType.SYSTEM,
            `Database error during ${operation}: ${cause}`,
            { operation, cause }
        );
    }
}
