import { FiusRuntimeError, FiusValidationError, ErrorType, zodToIssues } from '@fius/core';
import { logger } from '@fius/core';
import { ZodError } from 'zod';

export const mapErrorTypeToStatus = (type: ErrorType): number => {
    switch (type) {
        case ErrorType.USER:
            return 400;
        case ErrorType.PAYMENT_REQUIRED:
            return 402;
        case ErrorType.FORBIDDEN:
            return 403;
        case ErrorType.NOT_FOUND:
            return 404;
        case ErrorType.TIMEOUT:
            return 408;
        case ErrorType.CONFLICT:
            return 409;
        case ErrorType.RATE_LIMIT:
            return 429;
        case ErrorType.SYSTEM:
            return 500;
        case ErrorType.THIRD_PARTY:
            return 502;
        case ErrorType.UNKNOWN:
        default:
            return 500;
    }
};

export const statusForValidation = (issues: ReturnType<typeof zodToIssues>): number => {
    const firstError = issues.find((i) => i.severity === 'error');
    const type = firstError?.type ?? ErrorType.USER;
    return mapErrorTypeToStatus(type);
};

export function handleHonoError(ctx: any, err: unknown) {
    const endpoint = ctx.req.path || 'unknown';
    const method = ctx.req.method || 'unknown';

    if (err instanceof FiusRuntimeError) {
        return ctx.json(
            {
                ...err.toJSON(),
                endpoint,
                method,
            },
            mapErrorTypeToStatus(err.type)
        );
    }

    if (err instanceof FiusValidationError) {
        return ctx.json(
            {
                ...err.toJSON(),
                endpoint,
                method,
            },
            statusForValidation(err.issues)
        );
    }

    if (err instanceof ZodError) {
        const issues = zodToIssues(err);
        const dexErr = new FiusValidationError(issues);
        return ctx.json(
            {
                ...dexErr.toJSON(),
                endpoint,
                method,
            },
            statusForValidation(issues)
        );
    }

    if (err instanceof SyntaxError) {
        return ctx.json(
            {
                code: 'invalid_json',
                message: err.message || 'Invalid JSON body',
                scope: 'agent',
                type: 'user',
                severity: 'error',
                endpoint,
                method,
            },
            400
        );
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    logger.error(
        `Unhandled error in API middleware: ${errorMessage}, endpoint: ${method} ${endpoint}, stack: ${errorStack}, type: ${typeof err}`
    );

    const isDevelopment = process.env.NODE_ENV === 'development';
    const userMessage = isDevelopment
        ? `An unexpected error occurred: ${errorMessage}`
        : 'An unexpected error occurred. Please try again later.';

    return ctx.json(
        {
            code: 'internal_error',
            message: userMessage,
            scope: 'system',
            type: 'system',
            severity: 'error',
            endpoint,
            method,
            ...(isDevelopment && errorStack ? { stack: errorStack } : {}),
        },
        500
    );
}
