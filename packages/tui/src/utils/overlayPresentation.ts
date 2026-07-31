import type { OverlayType } from '../state/types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

export type OverlayPresentation = 'none' | 'inline' | 'focus';

const INLINE_OVERLAYS: ReadonlySet<OverlayType> = new Set([
    'slash-autocomplete',
    'resource-autocomplete',
]);


export function getOverlayPresentation(
    activeOverlay: OverlayType,
    approval: ApprovalRequest | null
): OverlayPresentation {
    if (approval) return 'focus';

    if (activeOverlay === 'none') return 'none';
    if (INLINE_OVERLAYS.has(activeOverlay)) return 'inline';
    return 'focus';
}

export function shouldHideCliChrome(
    activeOverlay: OverlayType,
    approval: ApprovalRequest | null
): boolean {
    return getOverlayPresentation(activeOverlay, approval) === 'focus';
}


export function shouldHideStatusChrome(
    activeOverlay: OverlayType,
    approval: ApprovalRequest | null
): boolean {
    if (approval) return true;
    return activeOverlay !== 'none';
}
