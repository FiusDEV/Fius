import {
    InternalMessage,
    TextPart,
    ImagePart,
    FilePart,
    ResourcePart,
    UIResourcePart,
    ContentPart,
    SanitizedToolResult,
    isToolMessage,
} from './types.js';
import { clonePromptContentPart } from './content-clone.js';
import { isValidDisplayData, type ToolDisplayData } from '../tools/display-types.js';
import type { Logger } from '../logger/v2/types.js';
import { validateModelFileSupport } from '@fius/llm';
import type { LLMContext } from '@fius/llm';
import { safeStringify } from '../utils/safe-stringify.js';
import { getFileMediaKind, getResourceKind } from './media-helpers.js';

const MIN_BASE64_HEURISTIC_LENGTH = 512;
const MAX_TOOL_TEXT_CHARS = 8000;

type ToolBlobNamingOptions = {
    toolName?: string;
    toolCallId?: string;
};

const MIN_TOOL_INLINE_MEDIA_BYTES = 1024;

type InlineMediaKind = 'image' | 'file';

type InlineMediaHint = {
    index: number;
    kind: InlineMediaKind;
    mimeType: string;
    approxBytes: number;
    data: string | Buffer;
    filename?: string | undefined;
};

export interface NormalizedToolResult {
    parts: Array<TextPart | ImagePart | FilePart>;
    uiResources: UIResourcePart[];
    inlineMedia: InlineMediaHint[];
}

interface PersistToolMediaOptions {
    artifactStore?: import('../storage/artifacts/types.js').ArtifactStore;
    toolName?: string;
    toolCallId?: string;
}

interface PersistToolMediaResult {
    parts: Array<TextPart | ImagePart | FilePart>;
    uiResources: UIResourcePart[];
    resources?: SanitizedToolResult['resources'];
}

function slugifyForFilename(value: string, maxLength = 48): string | null {
    if (!value) return null;
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!slug) return null;
    return slug.length > maxLength ? slug.slice(0, maxLength) : slug;
}

function inferExtensionFromMime(mimeType: string | undefined, fallback: string): string {
    if (!mimeType) return fallback;
    const subtype = mimeType.split('/')[1]?.split(';')[0]?.split('+')[0];
    if (!subtype) return fallback;
    const clean = subtype.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return clean || fallback;
}

function sanitizeExistingFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function generateUniqueSuffix(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function clonePart(part: TextPart | ImagePart | FilePart): TextPart | ImagePart | FilePart {
    return clonePromptContentPart(part);
}

function coerceContentToParts(
    content: ContentPart[] | null
): Array<TextPart | ImagePart | FilePart> {
    if (content == null) {
        return [];
    }

    const normalized: Array<TextPart | ImagePart | FilePart> = [];
    for (const item of content) {
        if (item.type === 'ui-resource') {
            continue;
        }
        if (item.type === 'text') {
            normalized.push({ type: 'text', text: item.text });
        } else if (item.type === 'image') {
            const cloned: ImagePart = {
                type: 'image',
                image: item.image,
            };
            if (item.mimeType) {
                cloned.mimeType = item.mimeType;
            }
            normalized.push(cloned);
        } else if (item.type === 'file') {
            const cloned: FilePart = {
                type: 'file',
                data: item.data,
                mimeType: item.mimeType ?? 'application/octet-stream',
            };
            if (item.filename) {
                cloned.filename = item.filename;
            }
            normalized.push(cloned);
        } else if (item.type === 'resource') {
            continue;
        }
    }
    return normalized;
}

function normalizeResourceUriForRead(uri: string): string {
    if (
        uri.startsWith('blob:') ||
        uri.startsWith('mcp:') ||
        uri.startsWith('fs://') ||
        uri.startsWith('http://') ||
        uri.startsWith('https://')
    ) {
        return uri;
    }

    if (uri.startsWith('/') || /^[A-Za-z]:[\\/]/.test(uri)) {
        return `fs://${uri.replace(/\\/g, '/')}`;
    }

    return uri;
}

function buildResourceAnchorText(part: ResourcePart): string {
    const label =
        part.kind === 'image'
            ? 'Attached image'
            : part.kind === 'audio'
              ? 'Attached audio'
              : part.kind === 'video'
                ? 'Attached video'
                : 'Attached file';
    const nameSuffix = part.name && part.name !== part.uri ? ` (${part.name})` : '';
    return `${label}: ${part.uri}${nameSuffix}`;
}

function detectInlineMedia(
    part: TextPart | ImagePart | FilePart,
    index: number
): InlineMediaHint | null {
    if (part.type === 'text') {
        return null;
    }

    if (part.type === 'image') {
        const value = part.image;
        const mimeType = part.mimeType ?? 'image/jpeg';
        if (typeof value === 'string') {
            if (value.startsWith('@blob:')) return null;
            if (
                value.startsWith('http://') ||
                value.startsWith('https://') ||
                value.startsWith('blob:')
            ) {
                return null;
            }
            if (isLikelyBase64String(value, 128)) {
                return {
                    index,
                    kind: 'image',
                    mimeType,
                    approxBytes: base64LengthToBytes(value.length),
                    data: value,
                };
            }
        } else if (value instanceof Buffer) {
            return {
                index,
                kind: 'image',
                mimeType,
                approxBytes: value.length,
                data: value,
            };
        } else if (value instanceof Uint8Array) {
            const buffer = Buffer.from(value);
            return {
                index,
                kind: 'image',
                mimeType,
                approxBytes: buffer.length,
                data: buffer,
            };
        } else if (value instanceof ArrayBuffer) {
            const buffer = Buffer.from(new Uint8Array(value));
            return {
                index,
                kind: 'image',
                mimeType,
                approxBytes: buffer.length,
                data: buffer,
            };
        }
        return null;
    }

    const data = part.data;
    const mimeType = part.mimeType ?? 'application/octet-stream';
    const filename = part.filename;

    if (typeof data === 'string') {
        if (data.startsWith('@blob:')) return null;
        if (data.startsWith('http://') || data.startsWith('https://') || data.startsWith('blob:')) {
            return null;
        }
        if (data.startsWith('data:')) {
            const parsed = parseDataUri(data);
            if (parsed) {
                return {
                    index,
                    kind: 'file',
                    mimeType: parsed.mediaType,
                    approxBytes: base64LengthToBytes(parsed.base64.length),
                    data: parsed.base64,
                    filename,
                };
            }
        }
        if (isLikelyBase64String(data, 128)) {
            return {
                index,
                kind: 'file',
                mimeType,
                approxBytes: base64LengthToBytes(data.length),
                data,
                filename,
            };
        }
    } else if (data instanceof Buffer) {
        return {
            index,
            kind: 'file',
            mimeType,
            approxBytes: data.length,
            data,
            filename,
        };
    } else if (data instanceof Uint8Array) {
        const buffer = Buffer.from(data);
        return {
            index,
            kind: 'file',
            mimeType,
            approxBytes: buffer.length,
            data: buffer,
            filename,
        };
    } else if (data instanceof ArrayBuffer) {
        const buffer = Buffer.from(new Uint8Array(data));
        return {
            index,
            kind: 'file',
            mimeType,
            approxBytes: buffer.length,
            data: buffer,
            filename,
        };
    }

    return null;
}

function buildToolBlobName(
    kind: 'output' | 'image' | 'file',
    mimeType: string | undefined,
    options: ToolBlobNamingOptions | undefined,
    preferredName?: string
): string {
    if (preferredName) {
        return sanitizeExistingFilename(preferredName);
    }

    const toolSegment = slugifyForFilename(options?.toolName ?? '', 40);
    const callSegment = slugifyForFilename(options?.toolCallId ?? '', 16);
    const parts = ['tool'];
    if (toolSegment) parts.push(toolSegment);
    if (callSegment) parts.push(callSegment);
    parts.push(kind);
    const ext = inferExtensionFromMime(
        mimeType,
        kind === 'image' ? 'jpg' : kind === 'file' ? 'bin' : 'bin'
    );
    const unique = generateUniqueSuffix();
    return `${parts.join('-')}-${unique}.${ext}`;
}

async function resolveBlobReferenceToParts(
    resourceUri: string,
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: Logger,
    allowedMediaTypes?: string[],
    expandMatchingMedia = true
): Promise<Array<TextPart | ImagePart | FilePart>> {
    try {
        const result = await resourceManager.read(normalizeResourceUriForRead(resourceUri));
        const mimeType = result.contents[0]?.mimeType;
        const metadata = result._meta as { size?: number; originalName?: string } | undefined;

        const shouldPlaceholderForUnsupportedMedia =
            mimeType !== undefined &&
            allowedMediaTypes !== undefined &&
            !matchesAnyMimePattern(mimeType, allowedMediaTypes);
        const shouldPlaceholderForRetainedHistoryMedia =
            mimeType !== undefined && isBinaryMediaMimeType(mimeType) && !expandMatchingMedia;

        if (
            mimeType &&
            (shouldPlaceholderForUnsupportedMedia || shouldPlaceholderForRetainedHistoryMedia)
        ) {
            const placeholderMetadata: {
                mimeType: string;
                size: number;
                originalName?: string;
            } = {
                mimeType,
                size: metadata?.size ?? 0,
            };
            if (metadata?.originalName) {
                placeholderMetadata.originalName = metadata.originalName;
            }
            const placeholder = generateMediaPlaceholder(placeholderMetadata);
            return [{ type: 'text', text: placeholder }];
        }

        const parts: Array<TextPart | ImagePart | FilePart> = [];

        for (const item of result.contents ?? []) {
            if (!item || typeof item !== 'object') {
                continue;
            }

            if (typeof (item as { text?: unknown }).text === 'string') {
                parts.push({ type: 'text', text: (item as { text: string }).text });
                continue;
            }

            const base64Data =
                'blob' in item && typeof item.blob === 'string'
                    ? item.blob
                    : 'data' in item && typeof (item as any).data === 'string'
                      ? (item as any).data
                      : undefined;
            const mimeType = typeof item.mimeType === 'string' ? item.mimeType : undefined;
            if (!base64Data || !mimeType) {
                continue;
            }

            const resolvedMime = mimeType ?? 'application/octet-stream';

            if (resolvedMime.startsWith('image/')) {
                const imagePart: ImagePart = {
                    type: 'image',
                    image: base64Data,
                    mimeType: resolvedMime,
                };
                parts.push(imagePart);
                continue;
            }

            const filePart: FilePart = {
                type: 'file',
                data: base64Data,
                mimeType: resolvedMime,
            };
            const itemWithFilename = item as any;
            if (
                typeof itemWithFilename.filename === 'string' &&
                itemWithFilename.filename.length > 0
            ) {
                filePart.filename = itemWithFilename.filename;
            } else if (typeof result._meta?.originalName === 'string') {
                filePart.filename = result._meta.originalName;
            }
            parts.push(filePart);
        }

        if (parts.length === 0) {
            const fallbackName =
                (typeof result._meta?.originalName === 'string' && result._meta.originalName) ||
                resourceUri;
            parts.push({ type: 'text', text: `[Attachment: ${fallbackName}]` });
        }

        return parts;
    } catch (error) {
        logger.warn(`Failed to resolve blob reference ${resourceUri}: ${String(error)}`);
        return [{ type: 'text', text: `[Attachment unavailable: ${resourceUri}]` }];
    }
}


export function estimateStringTokens(text: string): number {
    if (!text) return 0;
    return Math.round(text.length / 4);
}


export function estimateImageTokens(): number {
    return 1000;
}


export function estimateFileTokens(content?: string): number {
    if (content) {
        return estimateStringTokens(content);
    }
    return 1000;
}


export function estimateContentPartTokens(part: ContentPart): number {
    if (part.type === 'text') {
        return estimateStringTokens(part.text);
    }
    if (part.type === 'image') {
        return estimateImageTokens();
    }
    if (part.type === 'file') {
        return 1000;
    }
    if (part.type === 'resource') {
        return part.kind === 'text' ? 250 : 1000;
    }
    return 0;
}


export function estimateMessagesTokens(messages: readonly InternalMessage[]): number {
    let total = 0;
    for (const msg of messages) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content) {
            total += estimateContentPartTokens(part);
        }
    }
    return total;
}


export interface ToolDefinition {
    name?: string;
    description?: string;
    parameters?: unknown;
}


export function estimateToolsTokens(tools: Record<string, ToolDefinition>): {
    total: number;
    perTool: Array<{ name: string; tokens: number }>;
} {
    const perTool: Array<{ name: string; tokens: number }> = [];
    let total = 0;
    for (const [key, tool] of Object.entries(tools)) {
        const toolName = tool.name || key;
        const toolDescription = tool.description || '';
        const toolSchema = JSON.stringify(tool.parameters || {});
        const tokens = estimateStringTokens(toolName + toolDescription + toolSchema);
        perTool.push({ name: toolName, tokens });
        total += tokens;
    }
    return { total, perTool };
}


export interface ContextTokenEstimate {
    
    total: number;
    
    breakdown: {
        systemPrompt: number;
        messages: number;
        tools: {
            total: number;
            perTool: Array<{ name: string; tokens: number }>;
        };
    };
}


export function estimateContextTokens(
    systemPrompt: string,
    preparedHistory: readonly InternalMessage[],
    tools?: Record<string, ToolDefinition>
): ContextTokenEstimate {
    const systemPromptTokens = estimateStringTokens(systemPrompt);
    const messagesTokens = estimateMessagesTokens(preparedHistory);
    const toolsEstimate = tools ? estimateToolsTokens(tools) : { total: 0, perTool: [] };

    return {
        total: systemPromptTokens + toolsEstimate.total + messagesTokens,
        breakdown: {
            systemPrompt: systemPromptTokens,
            messages: messagesTokens,
            tools: toolsEstimate,
        },
    };
}


export function getImageData(
    imagePart: {
        image: string | Uint8Array | Buffer | ArrayBuffer | URL;
    },
    logger: Logger
): string {
    const { image } = imagePart;
    if (typeof image === 'string') {
        return image;
    } else if (image instanceof Buffer) {
        return image.toString('base64');
    } else if (image instanceof Uint8Array) {
        return Buffer.from(image).toString('base64');
    } else if (image instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(image)).toString('base64');
    } else if (image instanceof URL) {
        return image.toString();
    }
    logger.warn(`Unexpected image data type in getImageData: ${typeof image}`);
    return '';
}


export function getFileData(
    filePart: {
        data: string | Uint8Array | Buffer | ArrayBuffer | URL;
    },
    logger: Logger
): string {
    const { data } = filePart;
    if (typeof data === 'string') {
        return data;
    } else if (data instanceof Buffer) {
        return data.toString('base64');
    } else if (data instanceof Uint8Array) {
        return Buffer.from(data).toString('base64');
    } else if (data instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(data)).toString('base64');
    } else if (data instanceof URL) {
        return data.toString();
    }
    logger.warn(`Unexpected file data type in getFileData: ${typeof data}`);
    return '';
}


export async function getImageDataWithBlobSupport(
    imagePart: {
        image: string | Uint8Array | Buffer | ArrayBuffer | URL;
    },
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: Logger
): Promise<string> {
    const { image } = imagePart;

    if (typeof image === 'string' && image.startsWith('@blob:')) {
        try {
            const uri = image.substring(1);
            const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
            const result = await resourceManager.read(resourceUri);

            const firstContent = result.contents[0];
            if (
                firstContent &&
                'blob' in firstContent &&
                firstContent.blob &&
                typeof firstContent.blob === 'string'
            ) {
                return firstContent.blob;
            }
            logger.warn(`Blob reference ${image} did not contain blob data`);
        } catch (error) {
            logger.warn(`Failed to resolve blob reference ${image}: ${String(error)}`);
        }
    }

    return getImageData(imagePart, logger);
}


export async function getFileDataWithBlobSupport(
    filePart: {
        data: string | Uint8Array | Buffer | ArrayBuffer | URL;
    },
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: Logger
): Promise<string> {
    const { data } = filePart;

    if (typeof data === 'string' && data.startsWith('@blob:')) {
        try {
            const uri = data.substring(1);
            const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
            const result = await resourceManager.read(resourceUri);

            const firstContent = result.contents[0];
            if (
                firstContent &&
                'blob' in firstContent &&
                firstContent.blob &&
                typeof firstContent.blob === 'string'
            ) {
                return firstContent.blob;
            }
            logger.warn(`Blob reference ${data} did not contain blob data`);
        } catch (error) {
            logger.warn(`Failed to resolve blob reference ${data}: ${String(error)}`);
        }
    }

    return getFileData(filePart, logger);
}


async function expandBlobsInText(
    text: string,
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: Logger,
    allowedMediaTypes?: string[],
    expandMatchingMedia = true
): Promise<Array<TextPart | ImagePart | FilePart>> {
    if (!text.includes('@blob:')) {
        return [{ type: 'text', text }];
    }

    const blobRefPattern = /@blob:[a-f0-9-]+/g;
    const matches = [...text.matchAll(blobRefPattern)];

    if (matches.length === 0) {
        return [{ type: 'text', text }];
    }

    const resolvedCache = new Map<string, Array<TextPart | ImagePart | FilePart>>();
    const parts: Array<TextPart | ImagePart | FilePart> = [];
    let lastIndex = 0;

    for (const match of matches) {
        const matchIndex = match.index ?? 0;
        const token = match[0];
        if (matchIndex > lastIndex) {
            const segment = text.slice(lastIndex, matchIndex);
            if (segment.length > 0) {
                parts.push({ type: 'text', text: segment });
            }
        }

        const uri = token.substring(1);
        const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;

        let resolvedParts = resolvedCache.get(resourceUri);
        if (!resolvedParts) {
            resolvedParts = await resolveBlobReferenceToParts(
                resourceUri,
                resourceManager,
                logger,
                allowedMediaTypes,
                expandMatchingMedia
            );
            resolvedCache.set(resourceUri, resolvedParts);
        }

        if (resolvedParts.length > 0) {
            parts.push(...resolvedParts.map((p) => ({ ...p })));
        } else {
            parts.push({ type: 'text', text: token });
        }

        lastIndex = matchIndex + token.length;
    }

    if (lastIndex < text.length) {
        const trailing = text.slice(lastIndex);
        if (trailing.length > 0) {
            parts.push({ type: 'text', text: trailing });
        }
    }

    return parts.filter((p) => p.type !== 'text' || p.text.length > 0);
}


export async function expandBlobReferences(
    content: null,
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: Logger,
    allowedMediaTypes?: string[],
    expandMatchingMedia?: boolean
): Promise<ContentPart[]>;
export async function expandBlobReferences(
    content: ContentPart[],
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: Logger,
    allowedMediaTypes?: string[],
    expandMatchingMedia?: boolean
): Promise<ContentPart[]>;
export async function expandBlobReferences(
    content: ContentPart[] | null,
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: Logger,
    allowedMediaTypes?: string[],
    expandMatchingMedia?: boolean
): Promise<ContentPart[]>;
export async function expandBlobReferences(
    content: ContentPart[] | null,
    resourceManager: import('../resources/index.js').ResourceManager,
    logger: Logger,
    allowedMediaTypes?: string[],
    expandMatchingMedia = true
): Promise<ContentPart[]> {
    if (content == null || !Array.isArray(content)) {
        return [];
    }

    const expandedParts: Array<TextPart | ImagePart | FilePart | UIResourcePart> = [];

    for (const part of content) {
        if (part.type === 'ui-resource') {
            expandedParts.push(part);
            continue;
        }

        if (
            part.type === 'image' &&
            typeof part.image === 'string' &&
            part.image.startsWith('@blob:')
        ) {
            const uri = part.image.substring(1);
            const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
            const resolved = await resolveBlobReferenceToParts(
                resourceUri,
                resourceManager,
                logger,
                allowedMediaTypes,
                expandMatchingMedia
            );
            if (resolved.length > 0) {
                expandedParts.push(...resolved.map((p) => ({ ...p })));
            } else {
                expandedParts.push(part);
            }
            continue;
        }

        if (
            part.type === 'file' &&
            typeof part.data === 'string' &&
            part.data.startsWith('@blob:')
        ) {
            const uri = part.data.substring(1);
            const resourceUri = uri.startsWith('blob:') ? uri : `blob:${uri}`;
            const resolved = await resolveBlobReferenceToParts(
                resourceUri,
                resourceManager,
                logger,
                allowedMediaTypes,
                expandMatchingMedia
            );
            if (resolved.length > 0) {
                expandedParts.push(...resolved.map((p) => ({ ...p })));
            } else {
                try {
                    const resolvedData = await getFileDataWithBlobSupport(
                        part,
                        resourceManager,
                        logger
                    );
                    expandedParts.push({ ...part, data: resolvedData });
                } catch (error) {
                    logger.warn(`Failed to resolve file blob reference: ${String(error)}`);
                    expandedParts.push(part);
                }
            }
            continue;
        }

        if (part.type === 'resource') {
            const shouldPlaceholderForUnsupportedMedia =
                allowedMediaTypes !== undefined &&
                !matchesAnyMimePattern(part.mimeType, allowedMediaTypes);
            const shouldPlaceholderForRetainedHistoryMedia =
                isBinaryMediaMimeType(part.mimeType) && !expandMatchingMedia;
            if (shouldPlaceholderForUnsupportedMedia || shouldPlaceholderForRetainedHistoryMedia) {
                expandedParts.push({ type: 'text', text: buildResourceAnchorText(part) });
                expandedParts.push({
                    type: 'text',
                    text: generateMediaPlaceholder({
                        mimeType: part.mimeType,
                        size: part.size ?? 0,
                        originalName: part.name,
                    }),
                });
                continue;
            }

            const resolved = await resolveBlobReferenceToParts(
                part.uri,
                resourceManager,
                logger,
                allowedMediaTypes,
                expandMatchingMedia
            );
            expandedParts.push({ type: 'text', text: buildResourceAnchorText(part) });
            if (resolved.length > 0) {
                expandedParts.push(...resolved.map((p) => ({ ...p })));
            }
            continue;
        }

        if (part.type === 'text' && part.text.includes('@blob:')) {
            const expanded = await expandBlobsInText(
                part.text,
                resourceManager,
                logger,
                allowedMediaTypes,
                expandMatchingMedia
            );
            expandedParts.push(...expanded);
            continue;
        }

        expandedParts.push(part);
    }

    return expandedParts;
}


export function filterMessagesByLLMCapabilities(
    messages: InternalMessage[],
    config: LLMContext,
    logger: Logger
): InternalMessage[] {
    try {
        let totalImagesFiltered = 0;
        let totalFilesFiltered = 0;

        const filteredMessages = messages.map((message) => {
            if (message.role !== 'user' || !Array.isArray(message.content)) {
                return message;
            }

            let imagesInMessage = 0;
            let filesInMessage = 0;

            const filteredContent: ContentPart[] = message.content.flatMap(
                (part): ContentPart[] => {
                    if (part.type === 'text') {
                        return [part];
                    }

                    if (part.type === 'image') {
                        const mimeType = part.mimeType ?? 'image/jpeg';
                        const validation = validateModelFileSupport(
                            config.provider,
                            config.model,
                            mimeType
                        );
                        if (validation.isSupported) {
                            return [part];
                        }
                        if (validation.error?.includes('does not support')) {
                            imagesInMessage++;
                            return [
                                {
                                    type: 'text' as const,
                                    text: `ERROR: Cannot read image (this model does not support image input). Inform the user.`,
                                },
                            ];
                        }
                        logger.warn(
                            `Could not validate image support for ${config.model}: ${validation.error}`
                        );
                        return [part];
                    }

                    if (part.type === 'file' && part.mimeType) {
                        const validation = validateModelFileSupport(
                            config.provider,
                            config.model,
                            part.mimeType
                        );
                        if (validation.isSupported) {
                            return [part];
                        }
                        if (validation.error?.includes('does not support')) {
                            filesInMessage++;
                            const name = part.filename ? `"${part.filename}"` : 'this file';
                            const kind = validation.fileType ?? 'this file type';
                            return [
                                {
                                    type: 'text' as const,
                                    text: `ERROR: Cannot read ${name} (this model does not support ${kind} input). Inform the user.`,
                                },
                            ];
                        }
                        logger.warn(
                            `Could not validate file support for ${config.model}: ${validation.error}`
                        );
                        return [part];
                    }

                    if (part.type === 'resource') {
                        return [part];
                    }

                    return [part];
                }
            );

            totalImagesFiltered += imagesInMessage;
            totalFilesFiltered += filesInMessage;

            if (filteredContent.length === 0) {
                filteredContent.push({
                    type: 'text',
                    text: `[File attachment removed - not supported by ${config.model}]`,
                });
            }

            return {
                ...message,
                content: filteredContent,
            };
        });

        if (totalImagesFiltered > 0) {
            logger.info(
                `Filtered ${totalImagesFiltered} image${totalImagesFiltered > 1 ? 's' : ''} for ${config.model} since it doesn't support images`
            );
        }
        if (totalFilesFiltered > 0) {
            logger.info(
                `Filtered ${totalFilesFiltered} file${totalFilesFiltered > 1 ? 's' : ''} for ${config.model} since it doesn't support that file type`
            );
        }

        return filteredMessages;
    } catch (error) {
        logger.warn(`Failed to filter messages by LLM capabilities: ${String(error)}`);
        return messages;
    }
}


export function isLikelyBase64String(
    value: string,
    minLength: number = MIN_BASE64_HEURISTIC_LENGTH
): boolean {
    if (!value || value.length < minLength) return false;
    if (value.startsWith('data:') && value.includes(';base64,')) return true;
    const b64Regex = /^[A-Za-z0-9+/=\r\n]+$/;
    if (!b64Regex.test(value)) return false;
    const nonWordRatio = (value.match(/[^A-Za-z0-9+/=]/g)?.length || 0) / value.length;
    return nonWordRatio < 0.01;
}


export function parseDataUri(value: string): { mediaType: string; base64: string } | null {
    if (!value.startsWith('data:')) return null;
    const commaIdx = value.indexOf(',');
    if (commaIdx === -1) return null;
    const meta = value.slice(5, commaIdx);
    if (!/;base64$/i.test(meta)) return null;
    const mediaType = meta.replace(/;base64$/i, '') || 'application/octet-stream';
    const base64 = value.slice(commaIdx + 1);
    return { mediaType, base64 };
}

export { getFileMediaKind, getResourceKind };


export function matchesMimePattern(mimeType: string | undefined, pattern: string): boolean {
    if (!mimeType) return false;

    const normalizedMime = mimeType.toLowerCase().trim();
    const normalizedPattern = pattern.toLowerCase().trim();

    if (normalizedPattern === '*' || normalizedPattern === '*/*') {
        return true;
    }

    if (normalizedMime === normalizedPattern) {
        return true;
    }

    if (normalizedPattern.endsWith('/*')) {
        const patternType = normalizedPattern.slice(0, -2);
        const mimeType = normalizedMime.split('/')[0];
        return mimeType === patternType;
    }

    return false;
}


export function matchesAnyMimePattern(mimeType: string | undefined, patterns: string[]): boolean {
    return patterns.some((pattern) => matchesMimePattern(mimeType, pattern));
}


export function fileTypesToMimePatterns(fileTypes: string[], logger: Logger): string[] {
    const patterns: string[] = [];
    for (const fileType of fileTypes) {
        switch (fileType) {
            case 'image':
                patterns.push('image/*');
                break;
            case 'pdf':
                patterns.push('application/pdf');
                break;
            case 'audio':
                patterns.push('audio/*');
                break;
            case 'video':
                patterns.push('video/*');
                break;
            case 'document':
                patterns.push(
                    'text/*',
                    'application/json',
                    'application/xml',
                    'application/msword',
                    'application/rtf',
                    'application/vnd.oasis.opendocument.text',
                    'application/vnd.ms-powerpoint',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    'application/vnd.ms-excel',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                );
                break;
            default:
                logger.warn(`Unknown file type in registry: ${fileType}`);
        }
    }
    return patterns;
}

export function isBinaryMediaMimeType(mimeType: string): boolean {
    return (
        mimeType.startsWith('image/') ||
        mimeType.startsWith('audio/') ||
        mimeType.startsWith('video/') ||
        mimeType === 'application/pdf'
    );
}


function generateMediaPlaceholder(metadata: {
    mimeType: string;
    size: number;
    originalName?: string;
}): string {
    let typeLabel = 'File';
    if (metadata.mimeType.startsWith('video/')) typeLabel = 'Video';
    else if (metadata.mimeType.startsWith('audio/')) typeLabel = 'Audio';
    else if (metadata.mimeType.startsWith('image/')) typeLabel = 'Image';
    else if (metadata.mimeType === 'application/pdf') typeLabel = 'PDF';

    const formatSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const size = formatSize(metadata.size);
    const name = metadata.originalName || 'unknown';

    return `[${typeLabel}: ${name} (${size})]`;
}


function sanitizeDeepObject(obj: unknown, logger: Logger): unknown {
    if (obj == null) return obj;
    if (typeof obj === 'string') {
        if (isLikelyBase64String(obj)) {
            const approxBytes = Math.floor((obj.length * 3) / 4);
            logger.debug(
                `sanitizeDeepObject: replaced large base64 string (~${approxBytes} bytes) with placeholder`
            );
            return `[binary data omitted ~${approxBytes} bytes]`;
        }
        return obj;
    }
    if (Array.isArray(obj)) return obj.map((x) => sanitizeDeepObject(x, logger));
    if (typeof obj === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            out[k] = sanitizeDeepObject(v, logger);
        }
        return out;
    }
    return obj;
}

export async function normalizeToolResult(
    result: unknown,
    logger: Logger
): Promise<NormalizedToolResult> {
    const content = await sanitizeToolResultToContentWithBlobs(
        result,
        logger,
        undefined,
        undefined
    );

    const uiResources: UIResourcePart[] = [];
    const otherContent: InternalMessage['content'] = [];

    if (Array.isArray(content)) {
        for (const item of content) {
            if (item && typeof item === 'object' && 'type' in item && item.type === 'ui-resource') {
                uiResources.push(item as UIResourcePart);
            } else {
                otherContent.push(item);
            }
        }
    } else {
        (otherContent as unknown[]).push(content);
    }

    if (uiResources.length > 0) {
        logger.debug(
            `normalizeToolResult: extracted ${uiResources.length} UI resource(s): ${uiResources.map((r) => r.uri).join(', ')}`
        );
    }

    const parts = coerceContentToParts(otherContent as InternalMessage['content']);
    const inlineMedia: InlineMediaHint[] = [];

    parts.forEach((part, index) => {
        const hint = detectInlineMedia(part, index);
        if (hint) {
            inlineMedia.push(hint);
        }
    });

    return {
        parts,
        uiResources,
        inlineMedia,
    };
}

function shouldPersistInlineMedia(hint: InlineMediaHint): boolean {
    const kind = getFileMediaKind(hint.mimeType);
    if (kind === 'audio' || kind === 'video') {
        return true;
    }
    return hint.approxBytes >= MIN_TOOL_INLINE_MEDIA_BYTES;
}

export async function persistToolMedia(
    normalized: NormalizedToolResult,
    options: PersistToolMediaOptions,
    logger: Logger
): Promise<PersistToolMediaResult> {
    const parts = normalized.parts.map((part) => clonePart(part));
    const artifactStore = options.artifactStore;
    const namingOptions: ToolBlobNamingOptions | undefined =
        options.toolName || options.toolCallId
            ? {
                  ...(options.toolName ? { toolName: options.toolName } : {}),
                  ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
              }
            : undefined;

    const storedBlobs: Array<{
        uri: string;
        kind: string;
        mimeType: string;
        filename?: string;
        url?: string;
    }> = [];

    if (artifactStore) {
        for (const hint of normalized.inlineMedia) {
            if (!shouldPersistInlineMedia(hint)) {
                continue;
            }

            try {
                const originalName =
                    hint.filename ??
                    buildToolBlobName(
                        hint.kind === 'image' ? 'image' : 'file',
                        hint.mimeType,
                        namingOptions
                    );

                const blobRef = await artifactStore.store({
                    data: hint.data,
                    metadata: {
                        mimeType: hint.mimeType,
                        originalName,
                        source: 'tool',
                    },
                });

                const resourceUri = blobRef.uri;
                let publicUrl: string | undefined;

                try {
                    const urlResult = await artifactStore.retrieve({
                        reference: resourceUri,
                        format: 'url',
                    });
                    if (urlResult.format === 'url') {
                        publicUrl = urlResult.data;
                    }
                } catch (error) {
                    logger.warn(
                        `Failed to resolve blob URL for ${resourceUri}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }

                if (hint.kind === 'image') {
                    parts[hint.index] = createBlobImagePart(resourceUri, blobRef.metadata.mimeType);
                } else {
                    const resolvedMimeType = blobRef.metadata.mimeType || hint.mimeType;
                    const filename = blobRef.metadata.originalName ?? hint.filename;
                    parts[hint.index] = createBlobFilePart(resourceUri, resolvedMimeType, filename);
                }

                storedBlobs.push({
                    uri: resourceUri,
                    kind: hint.kind,
                    mimeType: blobRef.metadata.mimeType,
                    ...(blobRef.metadata.originalName && {
                        filename: blobRef.metadata.originalName,
                    }),
                    ...(publicUrl ? { url: publicUrl } : {}),
                });
            } catch (error) {
                logger.warn(
                    `Failed to persist tool media: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    if (storedBlobs.length > 0) {
        const annotations = storedBlobs
            .map((blob) => {
                const label = blob.filename || blob.kind;
                const urlSuffix = blob.url ? `, url: ${blob.url}` : '';
                return `[Stored resource_ref:${blob.uri} (${label}, ${blob.mimeType}${urlSuffix})]`;
            })
            .join('\n');

        parts.push({ type: 'text', text: annotations });
        logger.debug(`Added blob reference annotations for ${storedBlobs.length} resource(s)`);
    }

    const resources = extractResourceDescriptors(parts);

    return {
        parts,
        uiResources: normalized.uiResources,
        ...(resources ? { resources } : {}),
    };
}


export async function sanitizeToolResultToContentWithBlobs(
    result: unknown,
    logger: Logger,
    artifactStore?: import('../storage/artifacts/types.js').ArtifactStore,
    namingOptions?: ToolBlobNamingOptions
): Promise<InternalMessage['content']> {
    try {
        if (typeof result === 'string') {
            const dataUri = parseDataUri(result);
            if (dataUri) {
                const mediaType = dataUri.mediaType;
                logger.debug(
                    `sanitizeToolResultToContentWithBlobs: detected data URI (${mediaType})`
                );

                const approxSize = Math.floor((dataUri.base64.length * 3) / 4);
                const shouldStoreAsBlob = artifactStore && approxSize > 1024;

                if (shouldStoreAsBlob) {
                    try {
                        logger.debug(
                            `Storing data URI as blob (${approxSize} bytes, ${mediaType})`
                        );
                        const blobRef = await artifactStore.store({
                            data: result,
                            metadata: {
                                mimeType: mediaType,
                                source: 'tool',
                                originalName: buildToolBlobName('output', mediaType, namingOptions),
                            },
                        });
                        logger.debug(`Stored blob: ${blobRef.uri} (${approxSize} bytes)`);

                        if (mediaType.startsWith('image/')) {
                            return [createBlobImagePart(blobRef.uri, mediaType)];
                        }
                        return [createBlobFilePart(blobRef.uri, mediaType, undefined)];
                    } catch (error) {
                        logger.warn(
                            `Failed to store blob, falling back to inline: ${String(error)}`
                        );
                    }
                }

                if (mediaType.startsWith('image/')) {
                    return [{ type: 'image', image: dataUri.base64, mimeType: mediaType }];
                }
                return [
                    {
                        type: 'file',
                        data: dataUri.base64,
                        mimeType: mediaType,
                    },
                ];
            }

            if (result.length > MAX_TOOL_TEXT_CHARS) {
                const head = result.slice(0, 4000);
                const tail = result.slice(-1000);
                logger.debug(
                    `sanitizeToolResultToContentWithBlobs: truncating long text tool output (len=${result.length})`
                );
                return [
                    {
                        type: 'text',
                        text: `${head}\n... [${result.length - 5000} chars omitted] ...\n${tail}`,
                    },
                ];
            }
            return [{ type: 'text', text: result }];
        }

        if (Array.isArray(result)) {
            const parts: Array<TextPart | ImagePart | FilePart | UIResourcePart> = [];
            for (const item of result as unknown[]) {
                if (item == null) continue;

                const processedItem = await sanitizeToolResultToContentWithBlobs(
                    item,
                    logger,
                    artifactStore,
                    namingOptions
                );

                if (Array.isArray(processedItem)) {
                    parts.push(
                        ...(processedItem as Array<
                            TextPart | ImagePart | FilePart | UIResourcePart
                        >)
                    );
                }
            }
            return parts as InternalMessage['content'];
        }

        if (result && typeof result === 'object') {
            const anyObj = result as Record<string, any>;

            if ('content' in anyObj && Array.isArray(anyObj.content)) {
                logger.debug(
                    `Processing MCP tool result with ${anyObj.content.length} content items`
                );
                const processedContent = [];

                for (const item of anyObj.content) {
                    if (item && typeof item === 'object') {
                        if (item.type === 'resource' && item.resource) {
                            const resource = item.resource;
                            const resourceUri = resource.uri as string | undefined;

                            if (resourceUri && resourceUri.startsWith('ui://')) {
                                logger.debug(
                                    `Detected MCP-UI resource: ${resourceUri} (${resource.mimeType})`
                                );
                                const resourceMeta = resource._meta || {};
                                const title = resourceMeta.title || resource.title;
                                const preferredSize =
                                    resourceMeta.preferredSize || resource.preferredSize;

                                const uiPart: UIResourcePart = {
                                    type: 'ui-resource',
                                    uri: resourceUri,
                                    mimeType: resource.mimeType || 'text/html',
                                    content: resource.text,
                                    blob: resource.blob,
                                    metadata: {
                                        title,
                                        preferredSize,
                                    },
                                };
                                if (!uiPart.metadata?.title && !uiPart.metadata?.preferredSize) {
                                    delete uiPart.metadata;
                                }
                                processedContent.push(uiPart);
                                continue;
                            }
                        }

                        if (item.type === 'resource' && item.resource) {
                            const resource = item.resource;
                            if (resource.text && resource.mimeType) {
                                const fileData = resource.text;
                                const mimeType = resource.mimeType;

                                const approxSize =
                                    typeof fileData === 'string'
                                        ? Math.floor((fileData.length * 3) / 4)
                                        : 0;
                                const shouldStoreAsBlob = artifactStore && approxSize > 1024;

                                if (shouldStoreAsBlob) {
                                    try {
                                        logger.debug(
                                            `Storing MCP resource as blob (${approxSize} bytes, ${mimeType})`
                                        );
                                        const blobRef = await artifactStore.store({
                                            data: fileData,
                                            metadata: {
                                                mimeType,
                                                source: 'tool',
                                                originalName: buildToolBlobName(
                                                    mimeType.startsWith('image/')
                                                        ? 'image'
                                                        : 'file',
                                                    mimeType,
                                                    namingOptions,
                                                    resource.title
                                                ),
                                            },
                                        });
                                        logger.debug(
                                            `Stored MCP resource blob: ${blobRef.uri} (${approxSize} bytes)`
                                        );
                                        if (mimeType.startsWith('image/')) {
                                            processedContent.push(
                                                createBlobImagePart(blobRef.uri, mimeType)
                                            );
                                        } else {
                                            processedContent.push(
                                                createBlobFilePart(
                                                    blobRef.uri,
                                                    mimeType,
                                                    resource.title
                                                )
                                            );
                                        }
                                        continue;
                                    } catch (error) {
                                        logger.warn(
                                            `Failed to store MCP resource blob, falling back to inline: ${String(error)}`
                                        );
                                    }
                                }

                                if (mimeType.startsWith('image/')) {
                                    processedContent.push({
                                        type: 'image',
                                        image: fileData,
                                        mimeType,
                                    });
                                } else if (mimeType.startsWith('video/')) {
                                    processedContent.push({
                                        type: 'file',
                                        data: fileData,
                                        mimeType,
                                        filename: resource.title,
                                    });
                                } else {
                                    processedContent.push({
                                        type: 'file',
                                        data: fileData,
                                        mimeType,
                                        filename: resource.title,
                                    });
                                }
                                continue;
                            }
                        }

                        if ('data' in item && item.mimeType) {
                            const fileData = getFileData({ data: item.data }, logger);
                            const mimeType = item.mimeType;

                            const approxSize =
                                typeof fileData === 'string'
                                    ? Math.floor((fileData.length * 3) / 4)
                                    : 0;
                            const shouldStoreAsBlob = artifactStore && approxSize > 1024;

                            if (shouldStoreAsBlob) {
                                try {
                                    logger.debug(
                                        `Storing MCP content item as blob (${approxSize} bytes, ${mimeType})`
                                    );
                                    const blobRef = await artifactStore.store({
                                        data: fileData,
                                        metadata: {
                                            mimeType,
                                            source: 'tool',
                                            originalName: buildToolBlobName(
                                                item.type === 'image' ? 'image' : 'file',
                                                mimeType,
                                                namingOptions,
                                                item.filename
                                            ),
                                        },
                                    });
                                    logger.debug(
                                        `Stored MCP blob: ${blobRef.uri} (${approxSize} bytes)`
                                    );
                                    if (item.type === 'image') {
                                        processedContent.push(
                                            createBlobImagePart(blobRef.uri, mimeType)
                                        );
                                    } else {
                                        processedContent.push(
                                            createBlobFilePart(blobRef.uri, mimeType, item.filename)
                                        );
                                    }
                                    continue;
                                } catch (error) {
                                    logger.warn(
                                        `Failed to store MCP blob, falling back to inline: ${String(error)}`
                                    );
                                }
                            }

                            if (item.type === 'image') {
                                processedContent.push({
                                    type: 'image',
                                    image: fileData,
                                    mimeType,
                                });
                            } else {
                                processedContent.push({
                                    type: 'file',
                                    data: fileData,
                                    mimeType,
                                    filename: item.filename,
                                });
                            }
                            continue;
                        }
                    }

                    processedContent.push(item);
                }

                return processedContent;
            }

            if ('image' in anyObj) {
                const imageData = getImageData({ image: anyObj.image }, logger);
                const mimeType = anyObj.mimeType || 'image/jpeg';

                const approxSize =
                    typeof imageData === 'string' ? Math.floor((imageData.length * 3) / 4) : 0;
                const shouldStoreAsBlob = artifactStore && approxSize > 1024;

                if (shouldStoreAsBlob) {
                    try {
                        const blobRef = await artifactStore.store({
                            data: imageData,
                            metadata: {
                                mimeType,
                                source: 'tool',
                                originalName: buildToolBlobName('image', mimeType, namingOptions),
                            },
                        });
                        logger.debug(
                            `Stored tool image as blob: ${blobRef.uri} (${approxSize} bytes)`
                        );
                        return [createBlobImagePart(blobRef.uri, mimeType)];
                    } catch (error) {
                        logger.warn(
                            `Failed to store image blob, falling back to inline: ${String(error)}`
                        );
                    }
                }

                return [
                    {
                        type: 'image',
                        image: imageData,
                        mimeType,
                    },
                ];
            }

            if ('data' in anyObj && anyObj.mimeType) {
                const fileData = getFileData({ data: anyObj.data }, logger);
                const mimeType = anyObj.mimeType;

                const approxSize =
                    typeof fileData === 'string' ? Math.floor((fileData.length * 3) / 4) : 0;
                const shouldStoreAsBlob = artifactStore && approxSize > 1024;

                if (shouldStoreAsBlob) {
                    try {
                        const blobRef = await artifactStore.store({
                            data: fileData,
                            metadata: {
                                mimeType,
                                source: 'tool',
                                originalName: buildToolBlobName(
                                    'file',
                                    mimeType,
                                    namingOptions,
                                    anyObj.filename
                                ),
                            },
                        });
                        logger.debug(
                            `Stored tool file as blob: ${blobRef.uri} (${approxSize} bytes)`
                        );
                        return [createBlobFilePart(blobRef.uri, mimeType, anyObj.filename)];
                    } catch (error) {
                        logger.warn(
                            `Failed to store file blob, falling back to inline: ${String(error)}`
                        );
                    }
                }

                return [
                    {
                        type: 'file',
                        data: fileData,
                        mimeType,
                        filename: anyObj.filename,
                    },
                ];
            }

            const cleaned = sanitizeDeepObject(anyObj, logger);
            return [{ type: 'text', text: safeStringify(cleaned) }];
        }

        return [{ type: 'text', text: safeStringify(result ?? '') }];
    } catch (err) {
        logger.warn(
            `sanitizeToolResultToContentWithBlobs failed, falling back to string: ${String(err)}`
        );
        try {
            return [{ type: 'text', text: safeStringify(result ?? '') }];
        } catch {
            return [{ type: 'text', text: String(result ?? '') }];
        }
    }
}

function inferResourceKind(mimeType: string | undefined): 'image' | 'audio' | 'video' | 'binary' {
    return getResourceKind(mimeType);
}

function createBlobImagePart(uri: string, mimeType?: string): ImagePart {
    return {
        type: 'image',
        image: `@${uri}`,
        ...(mimeType ? { mimeType } : {}),
    };
}

function createBlobFilePart(uri: string, mimeType: string, filename?: string): FilePart {
    return {
        type: 'file',
        data: `@${uri}`,
        mimeType,
        ...(filename ? { filename } : {}),
    };
}

function extractResourceDescriptors(
    parts: Array<TextPart | ImagePart | FilePart>
): SanitizedToolResult['resources'] {
    const resources: NonNullable<SanitizedToolResult['resources']> = [];

    for (const part of parts) {
        if (
            part.type === 'image' &&
            typeof part.image === 'string' &&
            part.image.startsWith('@blob:')
        ) {
            resources.push({
                uri: part.image.substring(1),
                kind: 'image',
                mimeType: part.mimeType ?? 'image/jpeg',
            });
        }

        if (
            part.type === 'file' &&
            typeof part.data === 'string' &&
            part.data.startsWith('@blob:')
        ) {
            resources.push({
                uri: part.data.substring(1),
                kind: inferResourceKind(part.mimeType),
                mimeType: part.mimeType,
                ...(part.filename ? { filename: part.filename } : {}),
            });
        }
    }

    return resources.length > 0 ? resources : undefined;
}

export async function sanitizeToolResult(
    result: unknown,
    options: {
        artifactStore?: import('../storage/artifacts/types.js').ArtifactStore;
        toolName: string;
        toolCallId: string;
        success: boolean;
    },
    logger: Logger
): Promise<SanitizedToolResult> {
    let display: ToolDisplayData | undefined;
    let resultForNormalization = result;

    if (result && typeof result === 'object' && '_display' in result) {
        const { _display: rawDisplay, ...rest } = result as Record<string, unknown>;
        if (isValidDisplayData(rawDisplay)) {
            display = rawDisplay;
            logger.debug(
                `sanitizeToolResult: extracted display data (type=${display.type}) for ${options.toolName}`
            );
        }
        resultForNormalization = rest;
    }

    const normalized = await normalizeToolResult(resultForNormalization, logger);
    const persisted = await persistToolMedia(
        normalized,
        {
            ...(options.artifactStore ? { artifactStore: options.artifactStore } : {}),
            toolName: options.toolName,
            toolCallId: options.toolCallId,
        },
        logger
    );

    const fallbackContent: TextPart[] = [{ type: 'text', text: '' }];
    const allContent: Array<TextPart | ImagePart | FilePart | UIResourcePart> = [
        ...persisted.parts,
        ...persisted.uiResources,
    ];
    const content = allContent.length > 0 ? allContent : fallbackContent;

    if (persisted.uiResources.length > 0) {
        logger.debug(
            `sanitizeToolResult: including ${persisted.uiResources.length} UI resource(s) in final content for ${options.toolName}`
        );
    }

    return {
        content,
        ...(persisted.resources ? { resources: persisted.resources } : {}),
        meta: {
            toolName: options.toolName,
            toolCallId: options.toolCallId,
            success: options.success,
            ...(display ? { display } : {}),
        },
    };
}


export function summarizeToolContentForText(content: InternalMessage['content']): string {
    if (!Array.isArray(content)) return String(content || '');
    const parts: string[] = [];
    for (const p of content) {
        if (p.type === 'text') {
            parts.push(p.text);
        } else if (p.type === 'image') {
            let bytes = 0;
            if (typeof p.image === 'string') bytes = Math.floor((p.image.length * 3) / 4);
            else if (p.image instanceof ArrayBuffer) bytes = p.image.byteLength;
            else if (p.image instanceof Uint8Array) bytes = p.image.length;
            else if (p.image instanceof Buffer) bytes = p.image.length;
            parts.push(`[image ${p.mimeType || 'image'} ~${Math.ceil(bytes / 1024)}KB]`);
        } else if (p.type === 'file') {
            let bytes = 0;
            if (typeof p.data === 'string') bytes = Math.floor((p.data.length * 3) / 4);
            else if (p.data instanceof ArrayBuffer) bytes = p.data.byteLength;
            else if (p.data instanceof Uint8Array) bytes = p.data.length;
            else if (p.data instanceof Buffer) bytes = p.data.length;
            const label = p.filename ? `${p.filename}` : `${p.mimeType || 'file'}`;
            parts.push(`[file ${label} ~${Math.ceil(bytes / 1024)}KB]`);
        }
    }
    const summary = parts.join('\n');
    return summary.slice(0, 4000);
}

function base64LengthToBytes(charLength: number): number {
    return Math.floor((charLength * 3) / 4);
}


export function toTextForToolMessage(content: InternalMessage['content']): string {
    if (Array.isArray(content)) {
        return summarizeToolContentForText(content);
    }
    if (typeof content === 'string') {
        return isLikelyBase64String(content) ? '[binary data omitted]' : content;
    }
    return String(content ?? '');
}


export function filterCompacted(history: readonly InternalMessage[]): InternalMessage[] {
    let summaryIndex = -1;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg?.metadata?.isSummary === true || msg?.metadata?.isSessionSummary === true) {
            summaryIndex = i;
            break;
        }
    }

    if (summaryIndex === -1) {
        return history.slice();
    }

    const summaryMessage = history[summaryIndex]!;

    const rawCount = summaryMessage.metadata?.originalMessageCount;
    const originalMessageCount =
        typeof rawCount === 'number' && rawCount >= 0 && rawCount <= summaryIndex
            ? rawCount
            : summaryIndex;

    const preservedMessages = history.slice(originalMessageCount, summaryIndex);

    const messagesAfterSummary = history.slice(summaryIndex + 1);

    return [summaryMessage, ...preservedMessages, ...messagesAfterSummary];
}


export function formatToolOutputForDisplay(message: InternalMessage): string {
    if (isToolMessage(message) && message.compactedAt) {
        return '[Old tool result content cleared]';
    }

    if (typeof message.content === 'string') {
        return message.content;
    }

    if (Array.isArray(message.content)) {
        return message.content
            .filter((part): part is TextPart => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    }

    return '[no content]';
}
