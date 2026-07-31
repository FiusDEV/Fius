export enum LoggerErrorCode {
    TRANSPORT_NOT_IMPLEMENTED = 'logger_transport_not_implemented',
    TRANSPORT_UNKNOWN_TYPE = 'logger_transport_unknown_type',
    TRANSPORT_INITIALIZATION_FAILED = 'logger_transport_initialization_failed',
    TRANSPORT_WRITE_FAILED = 'logger_transport_write_failed',

    INVALID_CONFIG = 'logger_invalid_config',
    INVALID_LOG_LEVEL = 'logger_invalid_log_level',
}
