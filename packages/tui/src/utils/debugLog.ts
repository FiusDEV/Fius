

import { appendFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface DebugLogger {
    
    log: (msg: string, data?: Record<string, unknown>) => void;
    
    isEnabled: () => boolean;
    
    getLogPath: () => string;
    
    reset: (header?: string) => void;
}


export function createDebugLogger(_name: string): DebugLogger {
    const noop = (): void => {};
    return {
        log: noop,
        isEnabled: () => false,
        getLogPath: () => '',
        reset: noop,
    };
}
