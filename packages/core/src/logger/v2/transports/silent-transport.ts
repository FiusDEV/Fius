import type { LoggerTransport, LogEntry } from '../types.js';

export class SilentTransport implements LoggerTransport {
    write(_entry: LogEntry): void {
    }

    destroy(): void {
    }
}
