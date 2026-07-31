import type {
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcBatchRequest,
    JsonRpcBatchResponse,
    JsonRpcError,
} from './types.js';
import { JsonRpcErrorCode } from './types.js';

export type JsonRpcMethodHandler = (params: any) => Promise<any>;

export interface JsonRpcServerOptions {
    methods: Record<string, JsonRpcMethodHandler>;
    onError?: (error: Error, request?: JsonRpcRequest) => void;
}

export class JsonRpcServer {
    private methods: Record<string, JsonRpcMethodHandler>;
    private onError: ((error: Error, request?: JsonRpcRequest) => void) | undefined;

    constructor(options: JsonRpcServerOptions) {
        this.methods = options.methods;
        this.onError = options.onError;
    }

    async handle(
        request: JsonRpcRequest | JsonRpcBatchRequest
    ): Promise<JsonRpcResponse | JsonRpcBatchResponse | undefined> {
        if (Array.isArray(request)) {
            return await this.handleBatch(request);
        }

        return await this.handleSingle(request);
    }

    private async handleBatch(
        requests: JsonRpcBatchRequest
    ): Promise<JsonRpcBatchResponse | undefined> {
        if (requests.length === 0) {
            return [
                this.createErrorResponse(null, JsonRpcErrorCode.INVALID_REQUEST, 'Empty batch'),
            ];
        }

        const responses = await Promise.all(requests.map((req) => this.handleSingle(req)));

        const validResponses = responses.filter((res): res is JsonRpcResponse => res !== undefined);

        if (validResponses.length === 0) {
            return undefined;
        }

        return validResponses;
    }

    private async handleSingle(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
        try {
            if (request.jsonrpc !== '2.0') {
                if (request.id === undefined) {
                    return undefined;
                }
                return this.createErrorResponse(
                    request.id ?? null,
                    JsonRpcErrorCode.INVALID_REQUEST,
                    'Invalid JSON-RPC version (must be "2.0")'
                );
            }

            if (typeof request.method !== 'string') {
                if (request.id === undefined) {
                    return undefined;
                }
                return this.createErrorResponse(
                    request.id ?? null,
                    JsonRpcErrorCode.INVALID_REQUEST,
                    'Method must be a string'
                );
            }

            const handler = this.methods[request.method];
            if (!handler) {
                if (request.id === undefined) {
                    return undefined;
                }
                return this.createErrorResponse(
                    request.id ?? null,
                    JsonRpcErrorCode.METHOD_NOT_FOUND,
                    `Method not found: ${request.method}`
                );
            }

            try {
                const result = await handler(request.params);

                if (request.id === undefined) {
                    return undefined;
                }

                return this.createSuccessResponse(request.id ?? null, result);
            } catch (error) {
                if (this.onError) {
                    this.onError(
                        error instanceof Error ? error : new Error(String(error)),
                        request
                    );
                }

                if (request.id === undefined) {
                    return undefined;
                }

                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorData = error instanceof Error ? { name: error.name } : undefined;

                return this.createErrorResponse(
                    request.id ?? null,
                    JsonRpcErrorCode.INTERNAL_ERROR,
                    errorMessage,
                    errorData
                );
            }
        } catch (error) {
            if (request.id === undefined) {
                return undefined;
            }
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.createErrorResponse(null, JsonRpcErrorCode.INVALID_REQUEST, errorMessage);
        }
    }

    private createSuccessResponse(id: string | number | null, result: any): JsonRpcResponse {
        return {
            jsonrpc: '2.0',
            result,
            id,
        };
    }

    private createErrorResponse(
        id: string | number | null,
        code: number,
        message: string,
        data?: any
    ): JsonRpcResponse {
        const error: JsonRpcError = { code, message };
        if (data !== undefined) {
            error.data = data;
        }

        return {
            jsonrpc: '2.0',
            error,
            id,
        };
    }

    registerMethod(method: string, handler: JsonRpcMethodHandler): void {
        this.methods[method] = handler;
    }

    unregisterMethod(method: string): void {
        delete this.methods[method];
    }

    hasMethod(method: string): boolean {
        return method in this.methods;
    }

    getMethods(): string[] {
        return Object.keys(this.methods);
    }
}
