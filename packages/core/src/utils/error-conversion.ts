

import { safeStringify } from './safe-stringify.js';
import type { Logger } from '../logger/v2/types.js';


export function toError(error: unknown, logger: Logger): Error {
    if (error instanceof Error) {
        logger.info(`error is already an Error: ${error.message}`);
        return error;
    }

    if (error && typeof error === 'object') {
        const errorObj = error as any;

        if (errorObj.error?.data?.error?.message) {
            logger.info(
                `Extracted error from error.error.data.error.message: ${errorObj.error.data.error.message}`
            );
            return new Error(errorObj.error.data.error.message, { cause: error });
        }

        if (errorObj.error?.responseBody && typeof errorObj.error.responseBody === 'string') {
            try {
                const parsed = JSON.parse(errorObj.error.responseBody);
                if (parsed?.error?.message) {
                    logger.info(
                        `Extracted error from error.error.responseBody: ${parsed.error.message}`
                    );
                    return new Error(parsed.error.message, { cause: error });
                }
            } catch {
                logger.info(`Failed to parse error.error.responseBody as JSON`);
            }
        }

        if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
            return new Error((error as { message: string }).message, { cause: error });
        }
        if ('error' in error && typeof (error as { error?: unknown }).error === 'string') {
            return new Error((error as { error: string }).error, { cause: error });
        }
        if ('details' in error && typeof (error as { details?: unknown }).details === 'string') {
            return new Error((error as { details: string }).details, { cause: error });
        }
        if (
            'description' in error &&
            typeof (error as { description?: unknown }).description === 'string'
        ) {
            return new Error((error as { description: string }).description, { cause: error });
        }
        const serialized = safeStringify(error);
        logger.info(`falling back to safe serialization for complex objects: ${serialized}`);
        return new Error(serialized);
    }

    if (typeof error === 'string') {
        return new Error(error, { cause: error });
    }

    return new Error(String(error), { cause: error as unknown });
}
