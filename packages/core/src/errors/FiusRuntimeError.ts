import { FiusBaseError } from './FiusBaseError.js';
import { ErrorScope } from './types.js';
import { ErrorType } from './types.js';
import type { FiusErrorCode, ErrorRetryDisposition } from './types.js';


export class FiusRuntimeError<C = unknown> extends FiusBaseError {
    constructor(
        public readonly code: FiusErrorCode | string,
        public readonly scope: ErrorScope | string,
        public readonly type: ErrorType,
        message: string,
        public readonly context?: C,
        public readonly recovery?: string | string[],
        traceId?: string,
        public readonly retryDisposition: ErrorRetryDisposition = 'unknown'
    ) {
        super(message, traceId);
        this.name = 'FiusRuntimeError';
    }

    toJSON() {
        return {
            code: this.code,
            message: this.message,
            scope: this.scope,
            type: this.type,
            context: this.context,
            recovery: this.recovery,
            ...(this.retryDisposition === 'unknown'
                ? {}
                : { retryDisposition: this.retryDisposition }),
            traceId: this.traceId,
        };
    }
}
