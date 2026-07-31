import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

export interface FlattenedPromptResult {
    text: string;
    resourceUris: string[];
}


function isValidResourceUri(uri: string): boolean {
    try {
        if (uri.includes(':')) {
            const scheme = uri.split(':')[0]?.toLowerCase();
            if (!scheme) return false;
            const allowedSchemes = ['mcp', 'blob', 'file', 'http', 'https'];
            return allowedSchemes.includes(scheme);
        }
        return true;
    } catch {
        return false;
    }
}

function handleContent(
    content: unknown,
    accumulator: {
        textParts: string[];
        resourceUris: string[];
    }
): void {
    if (content == null) {
        return;
    }

    if (typeof content === 'string') {
        accumulator.textParts.push(content);
        return;
    }

    if (Array.isArray(content)) {
        for (const part of content) {
            handleContent(part, accumulator);
        }
        return;
    }

    if (typeof content === 'object') {
        const candidate = content as { type?: string };
        switch (candidate.type) {
            case 'text': {
                const textCandidate = content as { text?: unknown };
                if (typeof textCandidate.text === 'string') {
                    accumulator.textParts.push(textCandidate.text);
                }
                return;
            }
            case 'resource': {
                const resourceContent = content as {
                    resource?: {
                        uri?: string;
                        text?: unknown;
                    };
                };
                const resource = resourceContent.resource;
                if (resource) {
                    if (typeof resource.text === 'string') {
                        accumulator.textParts.push(resource.text);
                    }
                    if (typeof resource.uri === 'string' && resource.uri.length > 0) {
                        accumulator.resourceUris.push(resource.uri);
                    }
                }
                return;
            }
            case 'resource_link': {
                const linkContent = content as {
                    resource?: {
                        uri?: string;
                    };
                };
                const resource = linkContent.resource;
                if (resource && typeof resource.uri === 'string' && resource.uri.length > 0) {
                    if (isValidResourceUri(resource.uri)) {
                        accumulator.textParts.push(`@<${resource.uri}>`);
                        accumulator.resourceUris.push(resource.uri);
                    }
                }
                return;
            }
            default:
                return;
        }
    }
}

export function flattenPromptResult(result: GetPromptResult): FlattenedPromptResult {
    const accumulator = { textParts: [] as string[], resourceUris: [] as string[] };
    const messages = Array.isArray(result.messages) ? result.messages : [];

    for (const message of messages) {
        const maybeContent = (message as { content?: unknown }).content;
        handleContent(maybeContent, accumulator);
    }

    const uniqueUris = Array.from(new Set(accumulator.resourceUris));
    const joinedText = accumulator.textParts
        .map((part) => (typeof part === 'string' ? part : ''))
        .filter((part) => part.length > 0)
        .join('\n')
        .trim();

    return {
        text: joinedText,
        resourceUris: uniqueUris,
    };
}


export function normalizePromptArgs(input: Record<string, unknown>): {
    args: Record<string, string>;
    context?: string | undefined;
} {
    const args: Record<string, string> = {};
    let context: string | undefined;

    for (const [key, value] of Object.entries(input)) {
        if (key === '_context') {
            if (typeof value === 'string' && value.trim().length > 0) {
                const trimmed = value.trim();
                context = trimmed;
            }
            continue;
        }

        if (key === '_positional') {
            (args as any)._positional = value;
            continue;
        }

        if (typeof value === 'string') {
            args[key] = value;
        } else if (value !== undefined && value !== null) {
            try {
                args[key] = JSON.stringify(value);
            } catch {
                args[key] = String(value);
            }
        }
    }

    return { args, context };
}


export function appendContext(text: string, context?: string): string {
    if (!context || context.trim().length === 0) {
        return text ?? '';
    }
    if (!text || text.trim().length === 0) {
        return context;
    }
    return `${text}\n\n${context}`;
}


export function expandPlaceholders(content: string, args?: Record<string, unknown>): string {
    if (!content) return '';

    const positional = Array.isArray((args as any)?._positional)
        ? ((args as any)._positional as string[])
        : [];

    const ESC = '__DOLLAR__PLACEHOLDER__';
    let out = content.replaceAll('$$', ESC);

    let maxExplicitIndex = 0;
    for (let i = 1; i <= 9; i++) {
        if (out.includes(`$${i}`)) {
            maxExplicitIndex = i;
        }
    }

    if (out.includes('$ARGUMENTS')) {
        const remainingArgs = positional.slice(maxExplicitIndex);
        out = out.replaceAll('$ARGUMENTS', remainingArgs.join(' '));
    }

    for (let i = 1; i <= 9; i++) {
        const token = `$${i}`;
        if (out.includes(token)) {
            const val = positional[i - 1] ?? '';
            out = out.split(token).join(val);
        }
    }

    out = out.replaceAll(ESC, '$');
    return out;
}
