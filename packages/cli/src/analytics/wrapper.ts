export function withAnalytics<A extends unknown[], R = unknown>(
    _commandName: string,
    handler: (...args: A) => Promise<R> | R,
    _opts?: { timeoutMs?: number }
): (...args: A) => Promise<R> {
    return async (...args: A): Promise<R> => {
        return handler(...args);
    };
}

export class ExitSignal extends Error {
    code: number;
    reason?: string | undefined;
    commandName?: string | undefined;
    constructor(code: number = 0, reason?: string, commandName?: string) {
        super('ExitSignal');
        this.name = 'ExitSignal';
        this.code = code;
        this.reason = reason;
        this.commandName = commandName;
    }
}

export function safeExit(commandName: string, code: number = 0, reason?: string): never {
    throw new ExitSignal(code, reason, commandName);
}
