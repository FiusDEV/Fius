import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { AgentErrorCode } from './error-codes.js';


export class AgentError {
    
    static notStarted() {
        return new FiusRuntimeError(
            AgentErrorCode.NOT_STARTED,
            ErrorScope.AGENT,
            ErrorType.USER,
            'Agent must be started before use',
            undefined,
            'Call agent.start() before using other methods'
        );
    }

    
    static alreadyStarted() {
        return new FiusRuntimeError(
            AgentErrorCode.ALREADY_STARTED,
            ErrorScope.AGENT,
            ErrorType.USER,
            'Agent is already started',
            undefined,
            'Call agent.stop() before starting again'
        );
    }

    
    static stopped() {
        return new FiusRuntimeError(
            AgentErrorCode.STOPPED,
            ErrorScope.AGENT,
            ErrorType.USER,
            'Agent has been stopped and cannot be used',
            undefined,
            'Create a new agent instance or restart this one'
        );
    }

    
    static switchInProgress() {
        return new FiusRuntimeError(
            AgentErrorCode.SWITCH_IN_PROGRESS,
            ErrorScope.AGENT,
            ErrorType.CONFLICT,
            'Agent switch already in progress',
            undefined,
            'Wait for the current switch operation to complete before starting a new one'
        );
    }

    
    static sessionBusy(sessionId: string) {
        return new FiusRuntimeError(
            AgentErrorCode.SESSION_BUSY,
            ErrorScope.AGENT,
            ErrorType.CONFLICT,
            `Session '${sessionId}' is already processing a message`,
            { sessionId },
            'Wait for the current run to finish or queue the next message'
        );
    }

    
    static initializationFailed(reason: string, details?: unknown) {
        return new FiusRuntimeError(
            AgentErrorCode.INITIALIZATION_FAILED,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            `Agent initialization failed: ${reason}`,
            details,
            'Check logs for initialization errors'
        );
    }

    
    static noConfigPath() {
        return new FiusRuntimeError(
            AgentErrorCode.NO_CONFIG_PATH,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            'No configuration file path is available',
            undefined,
            'Agent was created without a config file path, cannot perform file operations'
        );
    }

    
    static apiValidationError(message: string, details?: unknown) {
        return new FiusRuntimeError(
            AgentErrorCode.API_VALIDATION_ERROR,
            ErrorScope.AGENT,
            ErrorType.USER,
            message,
            details,
            'Check the request parameters and try again'
        );
    }

    
    static streamFailed(message: string, details?: unknown) {
        return new FiusRuntimeError(
            AgentErrorCode.STREAM_FAILED,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            message,
            details,
            'Check logs for details'
        );
    }
}
