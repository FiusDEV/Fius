

import React from 'react';
import { Box } from 'ink';
import { TextBufferInput, type OverlayTrigger } from '../TextBufferInput.js';
import type { TextBuffer } from '../shared/text-buffer.js';
import type { PendingImage, PastedBlock } from '../../state/types.js';

export type { OverlayTrigger };

interface InputAreaProps {
    
    buffer: TextBuffer;
    
    onSubmit: (value: string) => void;
    
    onQueueSubmit?: ((value: string) => void) | undefined;
    
    isDisabled: boolean;
    
    isActive: boolean;
    
    placeholder?: string | undefined;
    
    onHistoryNavigate?: ((direction: 'up' | 'down') => void) | undefined;
    
    onCurrentTurnEdit?: (() => boolean) | undefined;
    
    onTriggerOverlay?: ((trigger: OverlayTrigger) => void) | undefined;
    
    onKeyboardScroll?: ((direction: 'up' | 'down') => void) | undefined;
    
    imageCount?: number | undefined;
    
    onImagePaste?: ((image: PendingImage) => void) | undefined;
    
    images?: PendingImage[] | undefined;
    
    onImageRemove?: ((imageId: string) => void) | undefined;
    
    pastedBlocks?: PastedBlock[] | undefined;
    
    onPasteBlock?: ((block: PastedBlock) => void) | undefined;
    
    onPasteBlockUpdate?: ((blockId: string, updates: Partial<PastedBlock>) => void) | undefined;
    
    onPasteBlockRemove?: ((blockId: string) => void) | undefined;
    
    highlightQuery?: string | undefined;
    
    onCycleReasoningVariant?: (() => void) | undefined;
}

export function InputArea({
    buffer,
    onSubmit,
    onQueueSubmit,
    isDisabled,
    isActive,
    placeholder,
    onHistoryNavigate,
    onCurrentTurnEdit,
    onTriggerOverlay,
    onKeyboardScroll,
    imageCount,
    onImagePaste,
    images,
    onImageRemove,
    pastedBlocks,
    onPasteBlock,
    onPasteBlockUpdate,
    onPasteBlockRemove,
    highlightQuery,
    onCycleReasoningVariant,
}: InputAreaProps) {
    return (
        <Box flexDirection="column">
            <TextBufferInput
                buffer={buffer}
                onSubmit={onSubmit}
                onQueueSubmit={onQueueSubmit}
                placeholder={placeholder}
                isDisabled={isDisabled}
                isActive={isActive}
                onHistoryNavigate={onHistoryNavigate}
                onCurrentTurnEdit={onCurrentTurnEdit}
                onTriggerOverlay={onTriggerOverlay}
                onKeyboardScroll={onKeyboardScroll}
                imageCount={imageCount}
                onImagePaste={onImagePaste}
                images={images}
                onImageRemove={onImageRemove}
                pastedBlocks={pastedBlocks}
                onPasteBlock={onPasteBlock}
                onPasteBlockUpdate={onPasteBlockUpdate}
                onPasteBlockRemove={onPasteBlockRemove}
                highlightQuery={highlightQuery}
                onCycleReasoningVariant={onCycleReasoningVariant}
            />
        </Box>
    );
}
