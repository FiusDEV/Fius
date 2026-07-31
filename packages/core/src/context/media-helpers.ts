


export function getFileMediaKind(mimeType: string | undefined): 'audio' | 'video' | 'binary' {
    if (mimeType?.startsWith('audio/')) return 'audio';
    if (mimeType?.startsWith('video/')) return 'video';
    return 'binary';
}


export function getResourceKind(
    mimeType: string | undefined
): 'image' | 'audio' | 'video' | 'binary' {
    if (mimeType?.startsWith('image/')) return 'image';
    if (mimeType?.startsWith('audio/')) return 'audio';
    if (mimeType?.startsWith('video/')) return 'video';
    return 'binary';
}
