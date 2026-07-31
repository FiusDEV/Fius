
export enum SessionErrorCode {
    SESSION_NOT_FOUND = 'session_not_found',
    SESSION_INITIALIZATION_FAILED = 'session_initialization_failed',
    SESSION_MAX_SESSIONS_EXCEEDED = 'session_max_sessions_exceeded',

    SESSION_STORAGE_FAILED = 'session_storage_failed',

    SESSION_RESET_FAILED = 'session_reset_failed',
    SESSION_BUSY = 'session_busy',
}
