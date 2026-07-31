import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { ResourceErrorCodes } from './error-codes.js';


export class ResourceError {
    private static redactUri(uri: string): string {
        try {
            const u = new URL(uri);
            if (u.username) u.username = '***';
            if (u.password) u.password = '***';
            u.searchParams.forEach((_, k) => {
                if (/token|key|secret|sig|pwd|password/i.test(k)) u.searchParams.set(k, '***');
            });
            return u.toString();
        } catch {
            return uri
                .replace(/\/\/([^@]+)@/gi, '$1***');
        }
    }

    private static toMessageAndRaw(reason: unknown): { message: string; raw: unknown } {
        if (reason instanceof Error) {
            return {
                message: reason.message,
                raw: { name: reason.name, message: reason.message, stack: reason.stack },
            };
        }
        if (typeof reason === 'string') return { message: reason, raw: reason };
        try {
            return { message: JSON.stringify(reason), raw: reason };
        } catch {
            return { message: String(reason), raw: reason };
        }
    }
    static invalidUriFormat(uri: string, expected?: string) {
        return new FiusRuntimeError(
            ResourceErrorCodes.INVALID_URI_FORMAT,
            ErrorScope.RESOURCE,
            ErrorType.USER,
            `Invalid resource URI format: '${ResourceError.redactUri(uri)}'${expected ? ` (expected ${expected})` : ''}`,
            { uri: ResourceError.redactUri(uri), uriRaw: uri, expected },
            expected ? `Use format: ${expected}` : 'Check the resource URI format'
        );
    }

    static emptyUri() {
        return new FiusRuntimeError(
            ResourceErrorCodes.EMPTY_URI,
            ErrorScope.RESOURCE,
            ErrorType.USER,
            'Resource URI cannot be empty',
            {},
            'Provide a valid resource URI'
        );
    }

    static resourceNotFound(uri: string) {
        return new FiusRuntimeError(
            ResourceErrorCodes.RESOURCE_NOT_FOUND,
            ErrorScope.RESOURCE,
            ErrorType.NOT_FOUND,
            `Resource not found: '${ResourceError.redactUri(uri)}'`,
            { uri: ResourceError.redactUri(uri), uriRaw: uri },
            'Check that the resource exists and is accessible'
        );
    }

    static providerNotInitialized(providerType: string, uri: string) {
        return new FiusRuntimeError(
            ResourceErrorCodes.PROVIDER_NOT_INITIALIZED,
            ErrorScope.RESOURCE,
            ErrorType.SYSTEM,
            `${providerType} resource provider not initialized for: '${ResourceError.redactUri(uri)}'`,
            { providerType, uri: ResourceError.redactUri(uri), uriRaw: uri },
            'Ensure the resource provider is properly configured'
        );
    }

    static providerNotAvailable(providerType: string) {
        return new FiusRuntimeError(
            ResourceErrorCodes.PROVIDER_NOT_AVAILABLE,
            ErrorScope.RESOURCE,
            ErrorType.SYSTEM,
            `${providerType} resource provider is not available`,
            { providerType },
            'Check resource provider configuration and availability'
        );
    }

    static readFailed(uri: string, reason: unknown) {
        const { message: reasonMsg, raw: reasonRaw } = ResourceError.toMessageAndRaw(reason);
        return new FiusRuntimeError(
            ResourceErrorCodes.READ_FAILED,
            ErrorScope.RESOURCE,
            ErrorType.SYSTEM,
            `Failed to read resource '${ResourceError.redactUri(uri)}': ${reasonMsg}`,
            { uri: ResourceError.redactUri(uri), uriRaw: uri, reason: reasonMsg, reasonRaw },
            'Check resource permissions and availability'
        );
    }

    static accessDenied(uri: string) {
        return new FiusRuntimeError(
            ResourceErrorCodes.ACCESS_DENIED,
            ErrorScope.RESOURCE,
            ErrorType.FORBIDDEN,
            `Access denied to resource: '${ResourceError.redactUri(uri)}'`,
            { uri: ResourceError.redactUri(uri), uriRaw: uri },
            'Ensure you have permission to access this resource'
        );
    }

    static noSuitableProvider(uri: string) {
        return new FiusRuntimeError(
            ResourceErrorCodes.NO_SUITABLE_PROVIDER,
            ErrorScope.RESOURCE,
            ErrorType.NOT_FOUND,
            `No suitable provider found for resource: '${ResourceError.redactUri(uri)}'`,
            { uri: ResourceError.redactUri(uri), uriRaw: uri },
            'Check that the resource type is supported'
        );
    }

    static providerError(providerType: string, operation: string, reason: unknown) {
        const { message: reasonMsg, raw: reasonRaw } = ResourceError.toMessageAndRaw(reason);
        return new FiusRuntimeError(
            ResourceErrorCodes.PROVIDER_ERROR,
            ErrorScope.RESOURCE,
            ErrorType.SYSTEM,
            `${providerType} provider failed during ${operation}: ${reasonMsg}`,
            { providerType, operation, reason: reasonMsg, reasonRaw },
            'Check provider configuration and logs for details'
        );
    }
}
