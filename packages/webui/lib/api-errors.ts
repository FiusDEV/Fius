/**
 * API Error Handling Utilities
 *
 * Extracts error messages from Fius API responses which can be in multiple formats:
 * 1. FiusRuntimeError: { code, message, scope, type, context?, recovery?, traceId }
 * 2. FiusValidationError: { name, message, issues[], traceId }
 * 3. Wrapped errors: { message, context: { issues: [...] }, ... }
 * 4. Hono OpenAPI errors: { success: false, error: { issues: [...] } }
 *
 * Priority order for extraction:
 * 1. context.issues[0].message (wrapped validation errors)
 * 2. issues[0].message (direct validation errors)
 * 3. error.issues[0].message (Hono OpenAPI validation errors)
 * 4. error (some routes use this as a string)
 * 5. message (standard field)
 * 6. Fallback message
 */

/** Shape of a single validation issue from core */
export interface FiusIssue {
    code: string;
    message: string;
    scope: string;
    type: string;
    severity: 'error' | 'warning';
    path?: Array<string | number>;
    context?: unknown;
}

/** FiusRuntimeError response shape */
export interface FiusRuntimeErrorResponse {
    code: string;
    message: string;
    scope: string;
    type: string;
    context?: {
        issues?: FiusIssue[];
        [key: string]: unknown;
    };
    recovery?: string | string[];
    traceId: string;
    endpoint?: string;
    method?: string;
}

/** FiusValidationError response shape */
export interface FiusValidationErrorResponse {
    name: 'FiusValidationError';
    message: string;
    issues: FiusIssue[];
    traceId: string;
    errorCount: number;
    warningCount: number;
    endpoint?: string;
    method?: string;
}

/** Union of possible error response shapes */
export type FiusErrorResponse =
    | FiusRuntimeErrorResponse
    | FiusValidationErrorResponse
    | { error?: string; message?: string; [key: string]: unknown };

/**
 * Extract the most relevant error message from a Fius API error response
 *
 * @param errorData - The parsed JSON error response from the API
 * @param fallback - Fallback message if no error can be extracted
 * @returns The most specific error message available
 *
 * @example
 * ```ts
 * const res = await fetch('/api/agents/switch', {...});
 * if (!res.ok) {
 *   const errorData = await res.json().catch(() => ({}));
 *   const message = extractErrorMessage(errorData, 'Failed to switch agent');
 *   throw new Error(message);
 * }
 * ```
 */
export function extractErrorMessage(
    errorData: Partial<FiusErrorResponse>,
    fallback: string
): string {
    const runtimeError = errorData as Partial<FiusRuntimeErrorResponse>;
    if (runtimeError.context?.issues && Array.isArray(runtimeError.context.issues)) {
        const firstIssue = runtimeError.context.issues[0];
        if (firstIssue?.message) {
            return firstIssue.message;
        }
    }

    const issues = (errorData as FiusValidationErrorResponse).issues;
    if (issues && Array.isArray(issues)) {
        const firstIssue = issues[0];
        if (firstIssue?.message) {
            return firstIssue.message;
        }
    }

    const honoError = (errorData as any).error;
    if (honoError && typeof honoError === 'object' && Array.isArray(honoError.issues)) {
        const firstIssue = honoError.issues[0];
        if (firstIssue?.message) {
            return firstIssue.message;
        }
    }

    if (typeof honoError === 'string' && honoError.length > 0) {
        return honoError;
    }

    if (typeof errorData.message === 'string' && errorData.message.length > 0) {
        return errorData.message;
    }

    return fallback;
}

/**
 * Extract full error details for logging/debugging
 *
 * @param errorData - The parsed JSON error response
 * @returns Object with all available error information
 */
export function extractErrorDetails(errorData: Partial<FiusErrorResponse>): {
    message: string;
    code?: string;
    scope?: string;
    type?: string;
    traceId?: string;
    recovery?: string | string[];
    issues?: FiusIssue[];
    endpoint?: string;
    method?: string;
} {
    const code = (errorData as FiusRuntimeErrorResponse).code;
    const scope = (errorData as FiusRuntimeErrorResponse).scope;
    const type = (errorData as FiusRuntimeErrorResponse).type;
    const traceId = (errorData as FiusRuntimeErrorResponse | FiusValidationErrorResponse).traceId;
    const recovery = (errorData as FiusRuntimeErrorResponse).recovery;
    const endpoint = (errorData as FiusRuntimeErrorResponse | FiusValidationErrorResponse)
        .endpoint;
    const method = (errorData as FiusRuntimeErrorResponse | FiusValidationErrorResponse).method;

    let issues: FiusIssue[] | undefined;
    const runtimeErr = errorData as Partial<FiusRuntimeErrorResponse>;
    if (runtimeErr.context?.issues) {
        issues = runtimeErr.context.issues;
    } else if ((errorData as FiusValidationErrorResponse).issues) {
        issues = (errorData as FiusValidationErrorResponse).issues;
    } else if ((errorData as any).error?.issues) {
        issues = (errorData as any).error.issues;
    }

    return {
        message: extractErrorMessage(errorData, 'An error occurred'),
        code,
        scope,
        type,
        traceId,
        recovery,
        issues,
        endpoint,
        method,
    };
}

export class ApiError extends Error {
    constructor(
        message: string,
        public status: number
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export async function throwApiError(
    response: Response,
    fallbackMessage = `Request failed (${response.status})`
): Promise<never> {
    const bodyText = await response.text().catch(() => '');

    if (bodyText.trim().length === 0) {
        throw new ApiError(fallbackMessage, response.status);
    }

    try {
        const parsed = JSON.parse(bodyText) as Partial<FiusErrorResponse>;
        throw new ApiError(extractErrorMessage(parsed, fallbackMessage), response.status);
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }
    }

    throw new ApiError(bodyText, response.status);
}

type ApiResponseLike = Response & {
    json(): Promise<unknown>;
};

type SuccessResponse<TResponse extends ApiResponseLike> =
    Extract<TResponse, { ok: true }> extends never ? TResponse : Extract<TResponse, { ok: true }>;

type SuccessResponseJson<TResponse extends ApiResponseLike> = Awaited<
    ReturnType<SuccessResponse<TResponse>['json']>
>;

export async function parseApiResponse<TResponse extends ApiResponseLike>(
    responseOrPromise: TResponse | Promise<TResponse>,
    fallbackMessage?: string
): Promise<SuccessResponseJson<TResponse>> {
    const response = await responseOrPromise;

    if (!response.ok) {
        return await throwApiError(response, fallbackMessage);
    }

    return (await response.json()) as SuccessResponseJson<TResponse>;
}
