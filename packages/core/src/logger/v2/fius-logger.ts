import type { Logger, LoggerTransport, LogEntry, LogLevel, FiusLogComponent } from './types.js';

export interface FiusLoggerConfig {
    level: LogLevel;
    component: FiusLogComponent;
    agentId: string;
    sessionId?: string;
    transports: LoggerTransport[];
    _levelRef?: { value: LogLevel };
}

export class FiusLogger implements Logger {
    private levelRef: { value: LogLevel };
    private component: FiusLogComponent;
    private agentId: string;
    private sessionId: string | undefined;
    private transports: LoggerTransport[];

    private static readonly LEVELS: Record<LogLevel, number> = {
        error: 0,
        warn: 1,
        info: 2,
        debug: 3,
        silly: 4,
    };

    constructor(config: FiusLoggerConfig) {
        this.levelRef = config._levelRef ?? { value: config.level };
        this.component = config.component;
        this.agentId = config.agentId;
        this.sessionId = config.sessionId;
        this.transports = config.transports;
    }

    debug(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('debug')) {
            this.log('debug', message, context);
        }
    }

    silly(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('silly')) {
            this.log('silly', message, context);
        }
    }

    info(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('info')) {
            this.log('info', message, context);
        }
    }

    warn(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('warn')) {
            this.log('warn', message, context);
        }
    }

    error(message: string, context?: Record<string, unknown>): void {
        if (this.shouldLog('error')) {
            this.log('error', message, context);
        }
    }

    trackException(error: Error, context?: Record<string, unknown>): void {
        this.error(error.message, {
            ...context,
            errorName: error.name,
            errorStack: error.stack,
            errorType: error.constructor.name,
        });
    }

    private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
        const entry: LogEntry = {
            level,
            message,
            timestamp: new Date().toISOString(),
            component: this.component,
            agentId: this.agentId,
            ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
            context,
        };

        for (const transport of this.transports) {
            try {
                const result = transport.write(entry);
                if (result && typeof result === 'object' && 'catch' in result) {
                    (result as Promise<void>).catch((error) => {
                        console.error('Logger transport error:', error);
                    });
                }
            } catch (error) {
                console.error('Logger transport error:', error);
            }
        }
    }

    private shouldLog(level: LogLevel): boolean {
        return FiusLogger.LEVELS[level] <= FiusLogger.LEVELS[this.levelRef.value];
    }

    setLevel(level: LogLevel): void {
        this.levelRef.value = level;
    }

    getLevel(): LogLevel {
        return this.levelRef.value;
    }

    getLogFilePath(): string | null {
        for (const transport of this.transports) {
            if ('getFilePath' in transport && typeof transport.getFilePath === 'function') {
                return transport.getFilePath();
            }
        }
        return null;
    }

    createChild(component: FiusLogComponent): FiusLogger {
        return new FiusLogger({
            level: this.levelRef.value,
            component,
            agentId: this.agentId,
            ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
            transports: this.transports,
            _levelRef: this.levelRef,
        });
    }

    createScopedLogger(options: {
        component: FiusLogComponent;
        agentId?: string;
        sessionId?: string;
        transports?: LoggerTransport[];
    }): FiusLogger {
        return new FiusLogger({
            level: this.levelRef.value,
            component: options.component,
            agentId: options.agentId ?? this.agentId,
            ...(options.sessionId !== undefined && { sessionId: options.sessionId }),
            transports: options.transports ?? this.transports,
            _levelRef: this.levelRef,
        });
    }

    createFileOnlyChild(component: FiusLogComponent): FiusLogger {
        const fileTransports = this.transports.filter(
            (transport) => 'getFilePath' in transport && typeof transport.getFilePath === 'function'
        );

        return new FiusLogger({
            level: this.levelRef.value,
            component,
            agentId: this.agentId,
            ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
            transports: fileTransports,
            _levelRef: this.levelRef,
        });
    }

    async destroy(): Promise<void> {
        for (const transport of this.transports) {
            if (transport.destroy) {
                try {
                    await transport.destroy();
                } catch (error) {
                    console.error('Error destroying transport:', error);
                }
            }
        }
    }
}
