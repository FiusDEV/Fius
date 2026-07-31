

import type { ContentPart } from '../context/types.js';
import type { LLMTokenUsage } from '../llm/services/types.js';
import type { LLMProvider, LLMPricingStatus } from '@fius/llm';
import type { HostRuntimeContext } from '../runtime/index.js';


export type {
    ContentPart,
    TextPart,
    ImagePart,
    FilePart,
    ImageData,
    FileData,
} from '../context/types.js';
export type { LLMTokenUsage as TokenUsage } from '../llm/services/types.js';


export interface AgentToolCall {
    toolName: string;
    args: Record<string, any>;
    callId: string;
    result?:
        | {
              success: boolean;
              data: any;
          }
        | undefined;
}


export type ContentInput = string | ContentPart[];


export type AgentExecutionContext = HostRuntimeContext;


export interface GenerateOptions {
    
    signal?: AbortSignal;
    
    disconnectSignal?: AbortSignal;
    
    executionContext?: AgentExecutionContext;
}


export interface GenerateResponse {
    content: string;
    reasoning?: string | undefined;
    usage: LLMTokenUsage;
    toolCalls: AgentToolCall[];
    sessionId: string;
    messageId?: string;
    usageScopeId?: string;
    provider?: LLMProvider;
    model?: string;
    estimatedCost?: number;
    pricingStatus?: LLMPricingStatus;
    hostRuntime?: HostRuntimeContext;
}


export type StreamOptions = GenerateOptions;
