

import React from 'react';
import type { ContentPart, ToolDisplayData } from '@fius/core';
import { DiffRenderer } from './DiffRenderer.js';
import { ShellRenderer } from './ShellRenderer.js';
import { SearchRenderer } from './SearchRenderer.js';
import { FileRenderer } from './FileRenderer.js';
import { GenericRenderer } from './GenericRenderer.js';

// Re-export individual renderers for direct use
export { DiffRenderer } from './DiffRenderer.js';
export { ShellRenderer } from './ShellRenderer.js';
export { SearchRenderer } from './SearchRenderer.js';
export { FileRenderer } from './FileRenderer.js';
export { GenericRenderer } from './GenericRenderer.js';

// File preview renderers for approval prompts (full content, no truncation)
export { DiffPreview, CreateFilePreview, DIFF_MAX_HEIGHT } from './FilePreviewRenderer.js';

interface ToolResultRendererProps {
    
    display?: ToolDisplayData;
    
    content: ContentPart[];
    
    maxLines?: number;
}


export function ToolResultRenderer({ display, content, maxLines }: ToolResultRendererProps) {
    // Default to generic if no display data
    const displayData = display ?? { type: 'generic' as const };

    switch (displayData.type) {
        case 'diff':
            return (
                <DiffRenderer data={displayData} {...(maxLines !== undefined && { maxLines })} />
            );

        case 'shell':
            return (
                <ShellRenderer data={displayData} {...(maxLines !== undefined && { maxLines })} />
            );

        case 'search':
            return (
                <SearchRenderer
                    data={displayData}
                    {...(maxLines !== undefined && { maxMatches: maxLines })}
                />
            );

        case 'file':
            return (
                <FileRenderer data={displayData} {...(maxLines !== undefined && { maxLines })} />
            );

        case 'generic':
        default:
            return (
                <GenericRenderer content={content} {...(maxLines !== undefined && { maxLines })} />
            );
    }
}
