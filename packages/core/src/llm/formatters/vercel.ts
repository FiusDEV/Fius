import type { ModelMessage, AssistantContent, ToolContent, ToolResultPart } from 'ai';
import type { LLMContext } from '@fius/llm';
import type {
    InternalMessage,
    AssistantMessage,
    ToolMessage,
    FilePart,
} from '../../context/types.js';
import {
    getImageData,
    getFileData,
    filterMessagesByLLMCapabilities,
    parseDataUri,
} from '../../context/utils.js';
import type { Logger } from '../../logger/v2/types.js';
import { FiusLogComponent } from '../../logger/v2/types.js';

function toUrlIfString<T>(value: T): T | URL {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
        try {
            return new URL(value);
        } catch {
            return value;
        }
    }
    return value;
}

function normalizeToolMediaData(data: string): string | null {
    const dataUri = parseDataUri(data);
    if (dataUri) return dataUri.base64;

    if (/^https?:\/\//i.test(data) || data.startsWith('blob:') || data.startsWith('@blob:')) {
        return null;
    }

    return data;
}

function isTextLikeMimeType(mimeType: string): boolean {
    const normalized = mimeType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
    if (normalized.startsWith('text/')) return true;
    if (normalized.endsWith('+json') || normalized.endsWith('+xml')) return true;

    return [
        'application/json',
        'application/ld+json',
        'application/xml',
        'application/yaml',
        'application/x-yaml',
        'application/toml',
        'application/x-toml',
        'application/javascript',
        'application/typescript',
        'application/x-sh',
        'application/sql',
    ].includes(normalized);
}

function isRemoteFileData(data: FilePart['data']): boolean {
    return (
        data instanceof URL ||
        (typeof data === 'string' &&
            (/^https?:\/\//i.test(data) || data.startsWith('blob:') || data.startsWith('@blob:')))
    );
}

function decodeLikelyBase64Text(value: string): string | null {
    const normalized = value.replace(/\s/g, '');
    if (
        normalized.length === 0 ||
        normalized.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
    ) {
        return null;
    }

    const decoded = Buffer.from(normalized, 'base64');
    const canonical = decoded.toString('base64').replace(/=+$/, '');
    if (canonical !== normalized.replace(/=+$/, '')) return null;

    const text = decoded.toString('utf8');
    const hasInvalidControlCharacter = [...text].some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 && code !== 9 && code !== 10 && code !== 13;
    });
    if (text.includes('\uFFFD') || hasInvalidControlCharacter) {
        return null;
    }

    return text;
}

function decodeBase64Text(value: string): string {
    return Buffer.from(value.replace(/\s/g, ''), 'base64').toString('utf8');
}

function decodeTextFileData(data: FilePart['data']): string | null {
    if (data instanceof URL) return null;

        if (typeof data === 'string') {
            const dataUri = parseDataUri(data);
            if (dataUri) return decodeBase64Text(dataUri.base64);
            if (isRemoteFileData(data)) return null;

            return decodeLikelyBase64Text(data) ?? data;
    }

    return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('utf8');
}

function filePartToText(part: FilePart): { type: 'text'; text: string } | null {
    if (!isTextLikeMimeType(part.mimeType) || isRemoteFileData(part.data)) return null;

    const text = decodeTextFileData(part.data);
    if (text === null) return null;

    const filename = part.filename ?? 'attachment';
    return {
        type: 'text',
        text: `Attached file "${filename}" (${part.mimeType}):\n\n${text}`,
    };
}

export class VercelMessageFormatter {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.createChild(FiusLogComponent.LLM);
    }
    format(
        history: Readonly<InternalMessage[]>,
        context: LLMContext,
        systemPrompt: string | null
        ): ModelMessage[] {
        const formatted: ModelMessage[] = [];

        let filteredHistory: InternalMessage[];
        try {
            filteredHistory = filterMessagesByLLMCapabilities([...history], context, this.logger);

            const modelInfo = `${context.provider}/${context.model}`;
            this.logger.debug(`Applied Vercel filtering for ${modelInfo}`);
        } catch (error) {
            this.logger.warn(
                `Failed to apply capability filtering, using original history: ${error}`
            );
            filteredHistory = [...history];
        }

        if (systemPrompt) {
            const modelLower = context.model?.toLowerCase() ?? '';
            const isClaudeModel = modelLower.includes('claude');
            const isAnthropicProvider =
                context.provider === 'anthropic' ||
                (context.provider === 'bedrock' && isClaudeModel) ||
                (context.provider === 'vertex' && isClaudeModel);

            formatted.push({
                role: 'system',
                content: systemPrompt,
                ...(isAnthropicProvider && {
                    providerOptions: {
                        anthropic: { cacheControl: { type: 'ephemeral' } },
                    },
                }),
            });
        }

        const pendingToolCalls = new Map<string, string>();

        for (const msg of filteredHistory) {
            switch (msg.role) {
                case 'user':
                    if (msg.content !== null) {
                        const content =
                            typeof msg.content === 'string'
                                ? msg.content
                                : msg.content
                                      .filter(
                                          (part) =>
                                              part.type !== 'ui-resource' &&
                                              part.type !== 'resource'
                                      )
                                      .map((part) => {
                    if (part.type === 'file') {
                        const textPart = filePartToText(part);
                        if (textPart) return textPart;

                        return {
                            type: 'file' as const,
                            data: toUrlIfString(part.data),
                            mediaType: part.mimeType,
                            ...(part.filename && { filename: part.filename }),
                        };
                    } else if (part.type === 'image') {
                        return {
                            type: 'image' as const,
                            image: toUrlIfString(part.image),
                            ...(part.mimeType && {
                                mediaType: part.mimeType,
                            }),
                        };
                    }
                    return part;
                                      });

                        formatted.push({
                            role: 'user',
                            content,
                        });
                    }
                    break;

                case 'system':
                    if (msg.content !== null) {
                        formatted.push({
                            role: 'system',
                            content: String(msg.content),
                        });
                    }
                    break;

                case 'assistant':
                    formatted.push({
                        role: 'assistant',
                        ...this.formatAssistantMessage(msg, {
                            includeReasoning: this.shouldRoundTripReasoning(context),
                        }),
                    });
                    if (msg.toolCalls && msg.toolCalls.length > 0) {
                        for (const toolCall of msg.toolCalls) {
                            pendingToolCalls.set(toolCall.id, toolCall.function.name);
                        }
                    }
                    break;

                case 'tool':
                    if (msg.toolCallId && pendingToolCalls.has(msg.toolCallId)) {
                        formatted.push({ role: 'tool', ...this.formatToolMessage(msg) });
                        pendingToolCalls.delete(msg.toolCallId);
                    } else {
                        this.logger.warn(
                            `Skipping orphaned tool result ${msg.toolCallId} (no matching tool call found) - cannot send to Vercel AI SDK without corresponding tool-call`
                        );
                    }
                    break;
            }
        }

        if (pendingToolCalls.size > 0) {
            for (const [toolCallId, toolName] of pendingToolCalls.entries()) {
                formatted.push({
                    role: 'tool',
                    content: [
                        {
                            type: 'tool-result',
                            toolCallId: toolCallId,
                            toolName: toolName,
                            output: {
                                type: 'text',
                                value: 'Error: Tool execution was interrupted (session crashed or cancelled before completion)',
                            },
                            isError: true,
                        } as ToolResultPart,
                    ],
                });
                this.logger.warn(
                    `Tool call ${toolCallId} (${toolName}) had no matching tool result - added synthetic error result to prevent API errors`
                );
            }
        }

        return formatted;
    }

    formatSystemPrompt(): null {
        return null;
    }

    private shouldRoundTripReasoning(_context: LLMContext): boolean {
        return false;
    }

    private formatAssistantMessage(
        msg: AssistantMessage,
        config?: { includeReasoning?: boolean }
    ): {
        content: AssistantContent;
        function_call?: { name: string; arguments: string };
    } {
        const contentParts: AssistantContent = [];
        const includeReasoning = config?.includeReasoning ?? false;

        if (includeReasoning && msg.reasoning) {
            const reasoningPart = {
                type: 'reasoning' as const,
                text: msg.reasoning,
                ...(msg.reasoningMetadata && { providerOptions: msg.reasoningMetadata }),
            };
            contentParts.push(reasoningPart as (typeof contentParts)[number]);
        }

        if (Array.isArray(msg.content)) {
            const combined = msg.content
                .map((part) => (part.type === 'text' ? part.text : ''))
                .filter(Boolean)
                .join('\n');
            if (combined) {
                contentParts.push({ type: 'text', text: combined });
            }
        } else if (typeof msg.content === 'string') {
            contentParts.push({ type: 'text', text: msg.content });
        }

        if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const toolCall of msg.toolCalls) {
                const rawArgs = toolCall.function.arguments;
                let parsed: unknown = {};
                if (typeof rawArgs === 'string') {
                    try {
                        parsed = JSON.parse(rawArgs);
                    } catch {
                        parsed = {};
                        this.logger.warn(
                            `Vercel formatter: invalid tool args JSON for ${toolCall.function.name}`
                        );
                    }
                } else {
                    parsed = rawArgs ?? {};
                }
                const toolCallPart: (typeof contentParts)[number] = {
                    type: 'tool-call',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    input: parsed,
                };
                if (toolCall.providerOptions) {
                    (toolCallPart as { providerOptions?: unknown }).providerOptions =
                        toolCall.providerOptions;
                }
                contentParts.push(toolCallPart);
            }

            const firstToolCall = msg.toolCalls[0]!;
            const argString = (() => {
                const raw = firstToolCall.function.arguments;
                if (typeof raw === 'string') return raw;
                try {
                    return JSON.stringify(raw ?? {});
                } catch {
                    return '{}';
                }
            })();
            return {
                content: contentParts,
                function_call: {
                    name: firstToolCall.function.name,
                    arguments: argString,
                },
            };
        }

        return {
            content: contentParts.length > 0 ? contentParts : [],
        };
    }

    private formatToolMessage(msg: ToolMessage): { content: ToolContent } {
        let toolResultPart: ToolResultPart;
        if (Array.isArray(msg.content)) {
            const content = msg.content
                .map((part) => {
                    if (part.type === 'text') {
                        return { type: 'text' as const, text: part.text };
                    }
                    if (part.type === 'image') {
                        const data = getImageData(part, this.logger);
                        const mediaData = normalizeToolMediaData(data);
                        if (!mediaData) {
                            return { type: 'text' as const, text: `Attached image: ${data}` };
                        }
                        return {
                            type: 'media' as const,
                            data: mediaData,
                            mediaType: part.mimeType || 'image/jpeg',
                        };
                    }
                    if (part.type === 'file') {
                        const data = getFileData(part, this.logger);
                        const mediaData = normalizeToolMediaData(data);
                        if (!mediaData) {
                            return { type: 'text' as const, text: `Attached file: ${data}` };
                        }
                        return {
                            type: 'media' as const,
                            data: mediaData,
                            mediaType: part.mimeType,
                        };
                    }
                    if (part.type === 'resource') {
                        return { type: 'text' as const, text: `${part.name}: ${part.uri}` };
                    }
                    return null;
                })
                .filter((part) => part !== null);

            if (content.some((part) => part.type === 'media')) {
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId,
                    toolName: msg.name,
                    output: {
                        type: 'content',
                        value: content,
                    },
                };
            } else {
                toolResultPart = {
                    type: 'tool-result',
                    toolCallId: msg.toolCallId,
                    toolName: msg.name,
                    output: {
                        type: 'text',
                        value:
                            content
                                .filter((part) => part.type === 'text')
                                .map((part) => part.text)
                                .join('\n') || '[empty result]',
                    },
                };
            }
        } else {
            toolResultPart = {
                type: 'tool-result',
                toolCallId: msg.toolCallId,
                toolName: msg.name,
                output: {
                    type: 'text',
                    value: String(msg.content || ''),
                },
            };
        }
        return { content: [toolResultPart] };
    }
}
