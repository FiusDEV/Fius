import chalk from 'chalk';
import type { LoggerTransport, LogEntry, LogLevel } from '../types.js';

export interface ConsoleTransportConfig {
    colorize?: boolean;
}

export class ConsoleTransport implements LoggerTransport {
    private colorize: boolean;

    constructor(config: ConsoleTransportConfig = {}) {
        this.colorize = config.colorize ?? true;
    }

    write(entry: LogEntry): void {
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        const component = `[${entry.component}:${entry.agentId}]`;
        const levelLabel = `[${entry.level.toUpperCase()}]`;

        let message = `${timestamp} ${levelLabel} ${component} ${entry.message}`;

        if (this.colorize) {
            const colorFn = this.getColorForLevel(entry.level);
            message = colorFn(message);
        }

        if (entry.context && Object.keys(entry.context).length > 0) {
            message += '\n' + JSON.stringify(entry.context, null, 2);
        }

        if (entry.level === 'error' || entry.level === 'warn') {
            console.error(message);
        } else {
            console.log(message);
        }
    }

    private getColorForLevel(level: LogLevel): (text: string) => string {
        switch (level) {
            case 'debug':
                return chalk.gray;
            case 'info':
                return chalk.cyan;
            case 'warn':
                return chalk.yellow;
            case 'error':
                return chalk.red;
            default:
                return (s: string) => s;
        }
    }
}
