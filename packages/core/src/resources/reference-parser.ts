import type { ResourceSet } from './types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

export interface ResourceReference {
    originalRef: string;
    resourceUri?: string;
    type: 'name' | 'uri' | 'server-scoped';
    serverName?: string;
    identifier: string;
}

export interface ResourceExpansionResult {
    expandedMessage: string;
    expandedReferences: ResourceReference[];
    unresolvedReferences: ResourceReference[];
    extractedResources: Array<{
        uri: string;
        data: string;
        mimeType: string;
        name: string;
        kind: 'image' | 'audio' | 'video' | 'binary';
        size?: number;
    }>;
}

function matchesMimePattern(mimeType: string | undefined, pattern: string): boolean {
    if (!mimeType) return false;

    const normalizedMime = mimeType.toLowerCase().trim();
    const normalizedPattern = pattern.toLowerCase().trim();

    if (normalizedPattern === '*/*') {
        return true;
    }

    if (normalizedPattern.endsWith('/*')) {
        const patternType = normalizedPattern.split('/')[0];
        const mimeTypeType = normalizedMime.split('/')[0];
        return mimeTypeType === patternType;
    }

    return normalizedMime === normalizedPattern;
}

function matchesAnyMimePattern(mimeType: string | undefined, patterns: string[]): boolean {
    return patterns.some((pattern) => matchesMimePattern(mimeType, pattern));
}

function escapeRegExp(literal: string): string {
    return literal.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function deriveExtractedKind(mimeType: string): 'image' | 'audio' | 'video' | 'binary' {
    const normalizedMimeType = mimeType.trim().toLowerCase();
    if (normalizedMimeType.startsWith('image/')) return 'image';
    if (normalizedMimeType.startsWith('audio/')) return 'audio';
    if (normalizedMimeType.startsWith('video/')) return 'video';
    return 'binary';
}

function getCanonicalResourceReference(
    resourceUri: string,
    resource?: ResourceSet[string]
): string {
    const originalUri =
        typeof resource?.metadata?.originalUri === 'string'
            ? resource.metadata.originalUri
            : undefined;
    const candidate = originalUri ?? resourceUri;
    return candidate.startsWith('fs://') ? candidate.replace('fs://', '') : candidate;
}


export function parseResourceReferences(message: string): ResourceReference[] {
    const references: ResourceReference[] = [];
    const regex =
        /(?:^|(?<=\s))@(?:(<[^>]+>)|([a-zA-Z0-9_-]+):([a-zA-Z0-9._/-]+)|([a-zA-Z0-9._/-]+))(?![a-zA-Z0-9@.])/g;
    let match;
    while ((match = regex.exec(message)) !== null) {
        const [originalRef, uriWithBrackets, serverName, serverResource, simpleName] = match;
        if (uriWithBrackets) {
            references.push({ originalRef, type: 'uri', identifier: uriWithBrackets.slice(1, -1) });
        } else if (serverName && serverResource) {
            references.push({
                originalRef,
                type: 'server-scoped',
                serverName,
                identifier: serverResource,
            });
        } else if (simpleName) {
            references.push({ originalRef, type: 'name', identifier: simpleName });
        }
    }
    return references;
}

export function resolveResourceReferences(
    references: ResourceReference[],
    availableResources: ResourceSet
): ResourceReference[] {
    const resolvedRefs = references.map((ref) => ({ ...ref }));
    for (const ref of resolvedRefs) {
        switch (ref.type) {
            case 'uri': {
                if (availableResources[ref.identifier]) {
                    ref.resourceUri = ref.identifier;
                } else {
                    const uriMatchUri = findResourceByOriginalUri(
                        availableResources,
                        ref.identifier
                    );
                    if (uriMatchUri) ref.resourceUri = uriMatchUri;
                }
                break;
            }
            case 'server-scoped': {
                const serverScopedUri = findResourceByServerAndName(
                    availableResources,
                    ref.serverName!,
                    ref.identifier
                );
                if (serverScopedUri) ref.resourceUri = serverScopedUri;
                break;
            }
            case 'name': {
                const nameMatchUri = findResourceByName(availableResources, ref.identifier);
                if (nameMatchUri) ref.resourceUri = nameMatchUri;
                break;
            }
        }
    }
    return resolvedRefs;
}

function findResourceByOriginalUri(resources: ResourceSet, uri: string): string | undefined {
    const normalizedUri = uri.trim().toLowerCase();

    for (const [resourceUri, resource] of Object.entries(resources)) {
        const originalUri =
            typeof resource.metadata?.originalUri === 'string'
                ? resource.metadata.originalUri
                : undefined;
        if (originalUri && originalUri.toLowerCase() === normalizedUri) {
            return resourceUri;
        }
    }

    for (const [resourceUri, resource] of Object.entries(resources)) {
        const originalUri =
            typeof resource.metadata?.originalUri === 'string'
                ? resource.metadata.originalUri
                : undefined;
        if (originalUri && originalUri.toLowerCase().includes(normalizedUri)) {
            return resourceUri;
        }
    }

    return undefined;
}

function findResourceByServerAndName(
    resources: ResourceSet,
    serverName: string,
    identifier: string
): string | undefined {
    const normalizedIdentifier = identifier.trim().toLowerCase();
    const matchingResources = Object.entries(resources).filter(
        ([, resource]) => resource.serverName === serverName
    );

    for (const [uri, resource] of matchingResources) {
        if (!resource.name) continue;
        const normalizedName = resource.name.trim().toLowerCase();
        if (
            normalizedName === normalizedIdentifier ||
            normalizedName.includes(normalizedIdentifier)
        ) {
            return uri;
        }
    }

    for (const [uri, resource] of matchingResources) {
        const metadataUri =
            typeof resource.metadata?.originalUri === 'string'
                ? resource.metadata.originalUri
                : undefined;
        if (
            metadataUri?.toLowerCase().includes(normalizedIdentifier) ||
            uri.toLowerCase().includes(normalizedIdentifier)
        ) {
            return uri;
        }
    }

    return undefined;
}

function findResourceByName(resources: ResourceSet, identifier: string): string | undefined {
    const normalizedIdentifier = identifier.trim().toLowerCase();

    for (const [uri, resource] of Object.entries(resources)) {
        if (!resource.name) continue;
        const normalizedName = resource.name.trim().toLowerCase();
        if (
            normalizedName === normalizedIdentifier ||
            normalizedName.includes(normalizedIdentifier)
        ) {
            return uri;
        }
    }

    for (const [uri, resource] of Object.entries(resources)) {
        const originalUri =
            typeof resource.metadata?.originalUri === 'string'
                ? resource.metadata.originalUri
                : undefined;
        if (
            originalUri?.toLowerCase().includes(normalizedIdentifier) ||
            uri.toLowerCase().includes(normalizedIdentifier)
        ) {
            return uri;
        }
    }

    return undefined;
}

export function formatResourceContent(
    resourceUri: string,
    resourceName: string,
    content: ReadResourceResult
): string {
    const contentParts: string[] = [];
    contentParts.push(`\n--- Content from resource: ${resourceName} (${resourceUri}) ---`);
    for (const item of content.contents) {
        if ('text' in item && item.text && typeof item.text === 'string') {
            contentParts.push(item.text);
        } else if ('blob' in item && item.blob) {
            const blobSize = typeof item.blob === 'string' ? item.blob.length : 'unknown';
            contentParts.push(`[Binary content: ${item.mimeType || 'unknown'}, ${blobSize} bytes]`);
        }
    }
    contentParts.push('--- End of resource content ---\n');
    return contentParts.join('\n');
}

export async function expandMessageReferences(
    message: string,
    availableResources: ResourceSet,
    resourceReader: (uri: string) => Promise<ReadResourceResult>,
    allowedMediaTypes?: string[]
): Promise<ResourceExpansionResult> {
    const parsedRefs = parseResourceReferences(message);
    if (parsedRefs.length === 0) {
        return {
            expandedMessage: message,
            expandedReferences: [],
            unresolvedReferences: [],
            extractedResources: [],
        };
    }

    const resolvedRefs = resolveResourceReferences(parsedRefs, availableResources);
    const expandedReferences = resolvedRefs.filter((ref) => ref.resourceUri);
    const unresolvedReferences = resolvedRefs.filter((ref) => !ref.resourceUri);

    let expandedMessage = message;
    const failedRefs: ResourceReference[] = [];
    const extractedResources: ResourceExpansionResult['extractedResources'] = [];

    for (const ref of expandedReferences) {
        try {
            const content = await resourceReader(ref.resourceUri!);
            const resource = availableResources[ref.resourceUri!];
            const extractedFromResource: ResourceExpansionResult['extractedResources'] = [];

            for (const item of content.contents) {
                if ('blob' in item && item.blob && item.mimeType && typeof item.blob === 'string') {
                    const isAllowed =
                        !allowedMediaTypes ||
                        matchesAnyMimePattern(item.mimeType, allowedMediaTypes);
                    if (!isAllowed) {
                        continue;
                    }

                    extractedFromResource.push({
                        uri: getCanonicalResourceReference(ref.resourceUri!, resource),
                        data: item.blob,
                        mimeType: item.mimeType,
                        name: resource?.name || ref.identifier,
                        kind: deriveExtractedKind(item.mimeType),
                        ...(typeof content._meta?.size === 'number'
                            ? { size: content._meta.size }
                            : {}),
                    });
                }
            }

            if (extractedFromResource.length > 0) {
                extractedResources.push(...extractedFromResource);

                const pattern = new RegExp(escapeRegExp(ref.originalRef), 'g');
                expandedMessage = expandedMessage
                    .replace(pattern, ' ')
                    .replace(/\s{2,}/g, ' ')
                    .trim();
            } else {
                const formattedContent = formatResourceContent(
                    ref.resourceUri!,
                    resource?.name || ref.identifier,
                    content
                );
                const pattern = new RegExp(escapeRegExp(ref.originalRef), 'g');
                expandedMessage = expandedMessage.replace(pattern, formattedContent);
            }
        } catch (_error) {
            failedRefs.push(ref);
        }
    }

    const failedRefSet = new Set(failedRefs);
    const finalExpandedReferences = expandedReferences.filter((ref) => !failedRefSet.has(ref));
    unresolvedReferences.push(...failedRefs);

    return {
        expandedMessage,
        expandedReferences: finalExpandedReferences,
        unresolvedReferences,
        extractedResources,
    };
}
