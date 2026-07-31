
export enum AgentErrorCode {
    NOT_STARTED = 'agent_not_started',
    ALREADY_STARTED = 'agent_already_started',
    STOPPED = 'agent_stopped',
    INITIALIZATION_FAILED = 'agent_initialization_failed',
    SWITCH_IN_PROGRESS = 'agent_switch_in_progress',
    SESSION_BUSY = 'agent_session_busy',
    NO_CONFIG_PATH = 'agent_no_config_path',
    INVALID_CONFIG = 'agent_invalid_config',
    API_VALIDATION_ERROR = 'agent_api_validation_error',
    STREAM_FAILED = 'agent_stream_failed',
}
