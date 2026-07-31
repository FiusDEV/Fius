


function isIndexInsideCodeBlock(content: string, indexToTest: number): boolean {
    let fenceCount = 0;
    let searchPos = 0;

    while (searchPos < content.length) {
        const nextFence = content.indexOf('```', searchPos);
        if (nextFence === -1 || nextFence >= indexToTest) {
            break;
        }
        fenceCount++;
        searchPos = nextFence + 3;
    }

    return fenceCount % 2 === 1;
}


function findEnclosingCodeBlockStart(content: string, index: number): number {
    if (!isIndexInsideCodeBlock(content, index)) {
        return -1;
    }

    let currentSearchPos = 0;
    while (currentSearchPos < index) {
        const blockStartIndex = content.indexOf('```', currentSearchPos);
        if (blockStartIndex === -1 || blockStartIndex >= index) {
            break;
        }

        const blockEndIndex = content.indexOf('```', blockStartIndex + 3);
        if (blockStartIndex < index) {
            if (blockEndIndex === -1 || index < blockEndIndex + 3) {
                return blockStartIndex;
            }
        }

        if (blockEndIndex === -1) break;
        currentSearchPos = blockEndIndex + 3;
    }

    return -1;
}


export function findLastSafeSplitPoint(content: string): number {
    // If we're inside a code block at the end, split before it
    const enclosingBlockStart = findEnclosingCodeBlockStart(content, content.length);
    if (enclosingBlockStart !== -1) {
        return enclosingBlockStart;
    }

    // Search for the last double newline (\n\n) not in a code block
    let searchStartIndex = content.length;
    while (searchStartIndex >= 0) {
        const dnlIndex = content.lastIndexOf('\n\n', searchStartIndex);
        if (dnlIndex === -1) {
            break;
        }

        const potentialSplitPoint = dnlIndex + 2;
        if (!isIndexInsideCodeBlock(content, potentialSplitPoint)) {
            return potentialSplitPoint;
        }

        // If potentialSplitPoint was inside a code block,
        // search before the \n\n we just found
        searchStartIndex = dnlIndex - 1;
    }

    // No safe split point found, return full length
    return content.length;
}


export function findLastSafeNewline(content: string): number {
    let searchPos = content.length;

    while (searchPos > 0) {
        const nlIndex = content.lastIndexOf('\n', searchPos - 1);
        if (nlIndex === -1) {
            break;
        }

        if (!isIndexInsideCodeBlock(content, nlIndex)) {
            return nlIndex + 1; // Return position after the newline
        }

        searchPos = nlIndex;
    }

    return -1; // No safe newline found
}


const MIN_PARAGRAPH_SPLIT_LENGTH = 200;


const MAX_PENDING_LENGTH = 300;


export function checkForSplit(content: string): {
    shouldSplit: boolean;
    splitIndex?: number;
    before?: string;
    after?: string;
} {
    // Don't split very small content
    if (content.length < MIN_PARAGRAPH_SPLIT_LENGTH) {
        return { shouldSplit: false };
    }

    // Try paragraph-based split first (cleaner breaks)
    const paragraphSplitPoint = findLastSafeSplitPoint(content);
    if (paragraphSplitPoint > 80 && paragraphSplitPoint < content.length - 20) {
        return {
            shouldSplit: true,
            splitIndex: paragraphSplitPoint,
            before: content.substring(0, paragraphSplitPoint),
            after: content.substring(paragraphSplitPoint),
        };
    }

    // If content is getting too long, force a line-based split to reduce flickering
    if (content.length > MAX_PENDING_LENGTH) {
        const lineSplitPoint = findLastSafeNewline(content);
        if (lineSplitPoint > 80 && lineSplitPoint < content.length - 20) {
            return {
                shouldSplit: true,
                splitIndex: lineSplitPoint,
                before: content.substring(0, lineSplitPoint),
                after: content.substring(lineSplitPoint),
            };
        }
    }

    return { shouldSplit: false };
}
