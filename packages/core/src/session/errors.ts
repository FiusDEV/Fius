import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { SessionErrorCode } from './error-codes.js';


export class SessionError {
    
    static notFound(sessionId: string) {
        return new FiusRuntimeError(
            SessionErrorCode.SESSION_NOT_FOUND,
            ErrorScope.SESSION,
            ErrorType.NOT_FOUND,
            `Session ${sessionId} not found`,
            { sessionId }
        );
    }

    
    static initializationFailed(sessionId: string, reason: string) {
        return new FiusRuntimeError(
            SessionErrorCode.SESSION_INITIALIZATION_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to initialize session '${sessionId}': ${reason}`,
            { sessionId, reason }
        );
    }

    
    static maxSessionsExceeded(currentCount: number, maxSessions: number) {
        return new FiusRuntimeError(
            SessionErrorCode.SESSION_MAX_SESSIONS_EXCEEDED,
            ErrorScope.SESSION,
            ErrorType.USER,
            `Maximum sessions (${maxSessions}) reached`,
            { currentCount, maxSessions },
            'Delete unused sessions or increase maxSessions limit in configuration'
        );
    }

    
    static storageFailed(sessionId: string, operation: string, reason: string) {
        return new FiusRuntimeError(
            SessionErrorCode.SESSION_STORAGE_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to ${operation} session '${sessionId}': ${reason}`,
            { sessionId, operation, reason }
        );
    }

    
    static resetFailed(sessionId: string, reason: string) {
        return new FiusRuntimeError(
            SessionErrorCode.SESSION_RESET_FAILED,
            ErrorScope.SESSION,
            ErrorType.SYSTEM,
            `Failed to reset session '${sessionId}': ${reason}`,
            { sessionId, reason }
        );
    }

    
    static busy(sessionId: string) {
        return new FiusRuntimeError(
            SessionErrorCode.SESSION_BUSY,
            ErrorScope.SESSION,
            ErrorType.CONFLICT,
            `Session '${sessionId}' is already processing a message`,
            { sessionId },
            'Wait for the current run to finish before starting another one'
        );
    }
}
