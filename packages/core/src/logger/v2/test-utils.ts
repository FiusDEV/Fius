import { vi } from 'vitest';
import type { Logger, LogLevel } from './types.js';

export function createMockLogger(): Logger {
    const mockLogger: Logger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => mockLogger),
        createFileOnlyChild: vi.fn(() => mockLogger),
        destroy: vi.fn(),
        setLevel: vi.fn(),
        getLevel: vi.fn((): LogLevel => 'info'),
        getLogFilePath: vi.fn(() => null),
    };
    return mockLogger;
}

export function createSilentMockLogger(): Logger {
    const mockLogger: Logger = {
        debug: () => {},
        silly: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        trackException: () => {},
        createChild: () => mockLogger,
        createFileOnlyChild: () => mockLogger,
        destroy: async () => {},
        setLevel: () => {},
        getLevel: () => 'info',
        getLogFilePath: () => null,
    };
    return mockLogger;
}
