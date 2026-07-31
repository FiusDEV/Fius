import * as winston from 'winston';
import chalk from 'chalk';
import boxen from 'boxen';
import * as fs from 'fs';
import * as path from 'path';

const logLevels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6,
};

type ChalkColor =
    | 'black'
    | 'red'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'cyan'
    | 'white'
    | 'gray'
    | 'grey'
    | 'blackBright'
    | 'redBright'
    | 'greenBright'
    | 'yellowBright'
    | 'blueBright'
    | 'magentaBright'
    | 'cyanBright'
    | 'whiteBright';

const consoleFormat = winston.format.printf(({ level, message, timestamp, color }) => {
    const levelColorMap: Record<string, (text: string) => string> = {
        error: chalk.red,
        warn: chalk.yellow,
        info: chalk.blue,
        http: chalk.cyan,
        verbose: chalk.magenta,
        debug: chalk.gray,
        silly: chalk.gray.dim,
    };

    const colorize = levelColorMap[level] || chalk.white;

    const formattedMessage =
        color && typeof color === 'string' && chalk[color as ChalkColor]
            ? chalk[color as ChalkColor](message)
            : message;

    return `${chalk.dim(timestamp)} ${colorize(level.toUpperCase())}: ${formattedMessage}`;
});

const SHOULD_REDACT = process.env.REDACT_SECRETS !== 'false';
const SENSITIVE_KEYS = ['apiKey', 'password', 'secret', 'token'];
const MASK_REGEX = new RegExp(
    `(${SENSITIVE_KEYS.join('|')})(["']?\\s*[:=]\\s*)(["'])?.*?\\3`,
    'gi'
);
const maskFormat = winston.format((info) => {
    if (SHOULD_REDACT && typeof info.message === 'string') {
        info.message = info.message.replace(MASK_REGEX, '$1$2$3[REDACTED]$3');
    }
    return info;
});

export interface GlobalLoggerOptions {
    level?: string;
    silent?: boolean;
    logToConsole?: boolean;
    customLogPath?: string;
}

const getDefaultLogLevel = (): string => {
    const envLevel = process.env.FIUS_LOG_LEVEL;
    if (envLevel && Object.keys(logLevels).includes(envLevel.toLowerCase())) {
        return envLevel.toLowerCase();
    }
    return 'info';
};

export class GlobalLogger {
    private logger: winston.Logger;
    private isSilent: boolean = false;
    private logFilePath: string | null = null;
    private logToConsole: boolean = false;

    constructor(options: GlobalLoggerOptions = {}) {
        this.isSilent = options.silent || false;

        this.initializeTransports(options);

        this.logger = winston.createLogger({
            levels: logLevels,
            level: options.level || getDefaultLogLevel(),
            silent: options.silent || false,
            format: winston.format.combine(
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                maskFormat(),
                winston.format.errors({ stack: true }),
                winston.format.splat(),
                winston.format.json()
            ),
            transports: this.createTransports(options),
        });
    }

    private initializeTransports(options: GlobalLoggerOptions) {
        const logToConsole = options.logToConsole ?? process.env.FIUS_LOG_TO_CONSOLE === 'true';
        this.logToConsole = logToConsole;

        if (options.customLogPath) {
            this.logFilePath = options.customLogPath;
        } else {
            this.logFilePath = null;
        }
    }

    private createTransports(_options: GlobalLoggerOptions): winston.transport[] {
        const transports: winston.transport[] = [];

        if (this.logToConsole) {
            transports.push(
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.timestamp({ format: 'HH:mm:ss' }),
                        maskFormat(),
                        consoleFormat
                    ),
                })
            );
        }

        if (this.logFilePath) {
            try {
                const logDir = path.dirname(this.logFilePath);
                fs.mkdirSync(logDir, { recursive: true });

                transports.push(
                    new winston.transports.File({
                        filename: this.logFilePath,
                        format: winston.format.combine(
                            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                            maskFormat(),
                            winston.format.errors({ stack: true }),
                            winston.format.json()
                        ),
                        maxsize: 10 * 1024 * 1024,
                        maxFiles: 7,
                        tailable: true,
                    })
                );
            } catch (error) {
                console.error(
                    `Failed to initialize file logging: ${error}. Falling back to console.`
                );
                if (!this.logToConsole) {
                    this.logToConsole = true;
                    transports.push(
                        new winston.transports.Console({
                            format: winston.format.combine(
                                winston.format.timestamp({ format: 'HH:mm:ss' }),
                                maskFormat(),
                                consoleFormat
                            ),
                        })
                    );
                }
            }
        }

        if (transports.length === 0) {
            this.logToConsole = true;
            transports.push(
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.timestamp({ format: 'HH:mm:ss' }),
                        maskFormat(),
                        consoleFormat
                    ),
                })
            );
        }

        return transports;
    }

    error(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.error(message, meta);
        } else {
            this.logger.error(message, { ...meta, color });
        }
    }

    warn(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.warn(message, meta);
        } else {
            this.logger.warn(message, { ...meta, color });
        }
    }

    info(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.info(message, meta);
        } else {
            this.logger.info(message, { ...meta, color });
        }
    }

    http(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.http(message, meta);
        } else {
            this.logger.http(message, { ...meta, color });
        }
    }

    verbose(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.verbose(message, meta);
        } else {
            this.logger.verbose(message, { ...meta, color });
        }
    }

    debug(message: string | object, meta?: any, color?: ChalkColor) {
        const formattedMessage =
            typeof message === 'string' ? message : JSON.stringify(message, null, 2);
        if (meta instanceof Error) {
            this.logger.debug(formattedMessage, meta);
        } else {
            this.logger.debug(formattedMessage, { ...meta, color });
        }
    }

    silly(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.silly(message, meta);
        } else {
            this.logger.silly(message, { ...meta, color });
        }
    }

    displayAIResponse(response: any) {
        if (this.isSilent) return;

        if (response.content) {
            console.log(
                boxen(chalk.white(response.content), {
                    padding: 1,
                    borderColor: 'yellow',
                    title: '🤖 AI Response',
                    titleAlignment: 'center',
                })
            );
        } else {
            console.log(chalk.yellow('AI is thinking...'));
        }
    }

    toolCall(toolName: string, args: any) {
        if (this.isSilent) return;
        console.log(
            boxen(
                `${chalk.cyan('Tool Call')}: ${chalk.yellow(toolName)}\n${chalk.dim('Arguments')}:\n${chalk.white(JSON.stringify(args, null, 2))}`,
                { padding: 1, borderColor: 'blue', title: '🔧 Tool Call', titleAlignment: 'center' }
            )
        );
    }

    toolResult(result: any) {
        if (this.isSilent) return;
        let displayText = '';
        let isError = false;
        let borderColor = 'green';
        let title = '✅ Tool Result';

        if (result?.error || result?.isError) {
            isError = true;
            borderColor = 'yellow';
            title = '⚠️ Tool Result (Error)';
        }

        if (result?.content && Array.isArray(result.content)) {
            result.content.forEach((item: any) => {
                if (item.type === 'text') {
                    displayText += item.text;
                } else if (item.type === 'image' && item.url) {
                    displayText += `[Image URL: ${item.url}]`;
                } else if (item.type === 'image') {
                    displayText += `[Image Data: ${item.mimeType || 'unknown type'}]`;
                } else if (item.type === 'markdown') {
                    displayText += item.markdown;
                } else {
                    displayText += `[Unsupported content type: ${item.type}]`;
                }
                displayText += '\n';
            });
        } else if (result?.message) {
            displayText = result.message;
            isError = true;
            borderColor = 'red';
            title = '❌ Tool Error';
        } else if (typeof result === 'string') {
            if (result.length > 1000) {
                displayText = `${result.slice(0, 500)}... [${result.length - 500} chars omitted]`;
            } else {
                displayText = result;
            }
        } else {
            try {
                const resultStr = JSON.stringify(result, null, 2);
                if (resultStr.length > 2000) {
                    displayText = `${resultStr.slice(0, 1000)}... [${resultStr.length - 1000} chars omitted]`;
                } else {
                    displayText = resultStr;
                }
            } catch {
                displayText = `[Unparseable result: ${typeof result}]`;
            }
        }

        if (!displayText || displayText.trim() === '') {
            displayText = '[Empty result]';
        }

        const textColor = isError ? chalk.yellow : chalk.green;
        console.log(
            boxen(textColor(displayText), {
                padding: 1,
                borderColor,
                title,
                titleAlignment: 'center',
            })
        );
    }

    setLevel(level: string) {
        if (Object.keys(logLevels).includes(level.toLowerCase())) {
            this.logger.level = level.toLowerCase();
            if (!this.isSilent) {
                console.log(`Log level set to: ${level}`);
            }
        } else {
            this.error(`Invalid log level: ${level}. Using current level: ${this.logger.level}`);
        }
    }

    getLogFilePath(): string | null {
        return this.logFilePath;
    }

    getLevel(): string {
        return this.logger.level;
    }

    displayStartupInfo(info: {
        configPath?: string;
        model?: string;
        provider?: string;
        connectedServers?: { count: number; names: string[] };
        failedConnections?: { [key: string]: string };
        toolStats?: { total: number; mcp: number; internal: number };
        sessionId?: string;
        logLevel?: string;
        logFile?: string;
    }) {
        if (this.isSilent) return;

        console.log('');

        if (info.configPath) {
            console.log(`📄 ${chalk.bold('Config:')} ${chalk.dim(info.configPath)}`);
        }

        if (info.model && info.provider) {
            console.log(
                `🤖 ${chalk.bold('Current Model:')} ${chalk.cyan(info.model)} ${chalk.dim(`(${info.provider})`)}`
            );
        }

        if (info.connectedServers) {
            if (info.connectedServers.count > 0) {
                const serverNames = info.connectedServers.names.join(', ');
                console.log(
                    `🔗 ${chalk.bold('Connected Servers:')} ${chalk.green(info.connectedServers.count)} ${chalk.dim(`(${serverNames})`)}`
                );
            } else {
                console.log(
                    `🔗 ${chalk.bold('Connected Servers:')} ${chalk.yellow('0')} ${chalk.dim('(no MCP servers connected)')}`
                );
            }
        }

        if (info.failedConnections && Object.keys(info.failedConnections).length > 0) {
            const failedNames = Object.keys(info.failedConnections);
            console.log(
                `❌ ${chalk.bold('Failed Connections:')} ${chalk.red(failedNames.length)} ${chalk.dim(`(${failedNames.join(', ')})`)}`
            );
            for (const [serverName, error] of Object.entries(info.failedConnections)) {
                console.log(`   ${chalk.red('•')} ${chalk.dim(serverName)}: ${chalk.red(error)}`);
            }
        }

        if (info.toolStats) {
            console.log(
                `🛠️  ${chalk.bold('Available Tools:')} ${chalk.green(info.toolStats.total)} total ${chalk.dim(`(${info.toolStats.mcp} MCP, ${info.toolStats.internal} internal)`)}`
            );
        }

        if (info.sessionId) {
            console.log(`💬 ${chalk.bold('Session:')} ${chalk.blue(info.sessionId)}`);
        }

        if (info.logLevel && info.logFile) {
            console.log(
                `📋 ${chalk.bold('Log Level:')} ${chalk.cyan(info.logLevel)} ${chalk.dim(`(file: ${info.logFile})`)}`
            );
        }
    }

    displayError(message: string, error?: Error) {
        if (this.isSilent) return;

        const showStack = this.getLevel() === 'debug';
        const errorContent =
            error?.stack && showStack
                ? `${chalk.red('Error')}: ${chalk.red(message)}\n${chalk.dim(error.stack)}`
                : `${chalk.red('Error')}: ${chalk.red(message)}`;

        console.log(
            boxen(errorContent, {
                padding: 1,
                borderColor: 'red',
                title: '❌ Error',
                titleAlignment: 'center',
            })
        );
    }
}

export const logger = new GlobalLogger();
