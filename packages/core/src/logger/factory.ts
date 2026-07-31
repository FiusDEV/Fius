import type { LoggerConfig } from './v2/schemas.js';
import type { Logger, LogLevel } from './v2/types.js';
import { FiusLogComponent } from './v2/types.js';
import { FiusLogger } from './v2/fius-logger.js';
import { createTransport } from './v2/transport-factory.js';

export interface CreateLoggerOptions {
    config: LoggerConfig;
    agentId: string;
    component?: FiusLogComponent;
}

function getEffectiveLogLevel(configLevel: LogLevel): LogLevel {
    const envLevel = process.env.FIUS_LOG_LEVEL;
    if (envLevel) {
        const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silly'];
        const normalizedLevel = envLevel.toLowerCase() as LogLevel;
        if (validLevels.includes(normalizedLevel)) {
            return normalizedLevel;
        }
    }
    return configLevel;
}

export function createLogger(options: CreateLoggerOptions): Logger {
    const { config, agentId, component = FiusLogComponent.AGENT } = options;

    const effectiveLevel = getEffectiveLogLevel(config.level);

    const transports = config.transports.map((transportConfig) => {
        return createTransport(transportConfig);
    });

    return new FiusLogger({
        level: effectiveLevel,
        component,
        agentId,
        transports,
    });
}
