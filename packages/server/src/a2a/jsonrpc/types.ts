export interface JsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: any;
    id?: string | number | null;
}

export interface JsonRpcSuccessResponse {
    jsonrpc: '2.0';
    result: any;
    id: string | number | null;
}

export interface JsonRpcErrorResponse {
    jsonrpc: '2.0';
    error: JsonRpcError;
    id: string | number | null;
}

export interface JsonRpcError {
    code: number;
    message: string;
    data?: any;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export type JsonRpcBatchRequest = JsonRpcRequest[];

export type JsonRpcBatchResponse = JsonRpcResponse[];

export enum JsonRpcErrorCode {
    PARSE_ERROR = -32700,
    INVALID_REQUEST = -32600,
    METHOD_NOT_FOUND = -32601,
    INVALID_PARAMS = -32602,
    INTERNAL_ERROR = -32603,
    SERVER_ERROR_START = -32099,
    SERVER_ERROR_END = -32000,
}

export function isJsonRpcError(response: JsonRpcResponse): response is JsonRpcErrorResponse {
    return 'error' in response;
}

export function isJsonRpcSuccess(response: JsonRpcResponse): response is JsonRpcSuccessResponse {
    return 'result' in response;
}
