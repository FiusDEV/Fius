import type { LLMProvider, LLMPricingStatus, TokenUsage } from '@fiusdev/llm';
import type { ToolDisplayData } from '../tools/display-types.js';
import type { ToolPresentationSnapshotV1 } from '../tools/types.js';
import type { ToolCallMetadata } from '../tools/tool-call-metadata.js';

export interface ImageData {
    image: string | Uint8Array | Buffer | ArrayBuffer | URL;
    mimeType?: string;
}

export interface FileData {
    data: string | Uint8Array | Buffer | ArrayBuffer | URL;
    mimeType: string;
    filename?: string;
}

export interface TextPart {
    type: 'text';
    text: string;
}

export interface ImagePart extends ImageData {
    type: 'image';
}

export interface FilePart extends FileData {
    type: 'file';
}

export interface ResourcePart {
    type: 'resource';
    uri: string;
    name: string;
    mimeType: string;
    kind: 'text' | 'image' | 'audio' | 'video' | 'binary';
    size?: number;
    metadata?: {
        mtimeMs?: number;
        source?: 'filesystem' | 'upload' | 'generated' | 'tool' | 'remote';
    };
}

export interface UIResourcePart {
    type: 'ui-resource';
    uri: string;
    mimeType: string;
    content?: string;
    blob?: string;
    metadata?: {
        title?: string;
        preferredSize?: { width: number; height: number };
    };
}

export type ContentPart = TextPart | ImagePart | FilePart | ResourcePart | UIResourcePart;

export function isTextPart(part: ContentPart): part is TextPart {
    return part.type === 'text';
}

export function isImagePart(part: ContentPart): part is ImagePart {
    return part.type === 'image';
}

export function isFilePart(part: ContentPart): part is FilePart {
    return part.type === 'file';
}

export function isResourcePart(part: ContentPart): part is ResourcePart {
    return part.type === 'resource';
}

export function isUIResourcePart(part: ContentPart): part is UIResourcePart {
    return part.type === 'ui-resource';
}

export interface SanitizedToolResult {
    content: ContentPart[];
    resources?: Array<{
        uri: string;
        kind: 'image' | 'audio' | 'video' | 'binary';
        mimeType: string;
        filename?: string;
    }>;
    meta: {
        toolName: string;
        toolCallId: string;
        success: boolean;
        display?: ToolDisplayData;
    };
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
    providerOptions?: Record<string, unknown>;
}

export type ToolApprovalStatus = 'pending' | 'approved' | 'rejected';

interface MessageBase {
    id?: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
}

export interface SystemMessage extends MessageBase {
    role: 'system';
    content: ContentPart[];
}

export interface UserMessage extends MessageBase {
    role: 'user';
    content: ContentPart[];
}

export type AssistantOutputStopReason = 'cancelled' | 'user_stopped' | 'replaced' | 'failed';

export type AssistantOutputLifecycle =
    | { status: 'draft' }
    | { status: 'complete' }
    | { status: 'stopped'; reason: AssistantOutputStopReason };

export interface AssistantMessage extends MessageBase {
    role: 'assistant';
    content: ContentPart[] | null;
    assistantOutput: AssistantOutputLifecycle;
    reasoning?: string;
    reasoningMetadata?: Record<string, unknown>;
    tokenUsage?: TokenUsage;
    estimatedCost?: number;
    pricingStatus?: LLMPricingStatus;
    usageScopeId?: string;
    model?: string;
    provider?: LLMProvider;
    toolCalls?: ToolCall[];
}

export interface ToolMessage extends MessageBase {
    role: 'tool';
    content: ContentPart[];
    toolCallId: string;
    name: string;
    presentationSnapshot?: ToolPresentationSnapshotV1;
    meta?: ToolCallMetadata;
    success?: boolean;
    requireApproval?: boolean;
    approvalStatus?: ToolApprovalStatus;
    compactedAt?: number;
    displayData?: ToolDisplayData;
}

export type InternalMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export function isSystemMessage(msg: InternalMessage): msg is SystemMessage {
    return msg.role === 'system';
}

export function isUserMessage(msg: InternalMessage): msg is UserMessage {
    return msg.role === 'user';
}

export function isAssistantMessage(msg: InternalMessage): msg is AssistantMessage {
    return msg.role === 'assistant';
}

export function isToolMessage(msg: InternalMessage): msg is ToolMessage {
    return msg.role === 'tool';
}
