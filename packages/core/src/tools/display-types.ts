

export type ToolDisplayData =
    | DiffDisplayData
    | ShellDisplayData
    | SearchDisplayData
    | FileDisplayData
    | GenericDisplayData;


export interface DiffDisplayData {
    type: 'diff';
    
    title?: string;
    
    unified: string;
    
    filename: string;
    
    additions: number;
    
    deletions: number;
    
    beforeContent?: string;
    
    afterContent?: string;
}


export interface ShellDisplayData {
    type: 'shell';
    
    title?: string;
    
    command: string;
    
    exitCode: number;
    
    duration: number;
    
    isBackground?: boolean;
    
    stdout?: string;
    
    stderr?: string;
}


export interface SearchDisplayData {
    type: 'search';
    
    title?: string;
    
    pattern: string;
    
    matches: SearchMatch[];
    
    totalMatches: number;
    
    truncated: boolean;
}


export interface SearchMatch {
    
    file: string;
    
    line: number;
    
    content: string;
    
    context?: string[];
}


export interface FileDisplayData {
    type: 'file';
    
    title?: string;
    
    path: string;
    
    operation: 'read' | 'write' | 'create' | 'delete';
    
    size?: number;
    
    lineCount?: number;
    
    backupPath?: string;
    
    content?: string;
}


export interface GenericDisplayData {
    type: 'generic';
    
    title?: string;
}

export function isDiffDisplay(d: ToolDisplayData): d is DiffDisplayData {
    return d.type === 'diff';
}


export function isShellDisplay(d: ToolDisplayData): d is ShellDisplayData {
    return d.type === 'shell';
}


export function isSearchDisplay(d: ToolDisplayData): d is SearchDisplayData {
    return d.type === 'search';
}


export function isFileDisplay(d: ToolDisplayData): d is FileDisplayData {
    return d.type === 'file';
}


export function isGenericDisplay(d: ToolDisplayData): d is GenericDisplayData {
    return d.type === 'generic';
}

const VALID_DISPLAY_TYPES = ['diff', 'shell', 'search', 'file', 'generic'] as const;


export function isValidDisplayData(d: unknown): d is ToolDisplayData {
    if (d === null || typeof d !== 'object') {
        return false;
    }
    const obj = d as Record<string, unknown>;
    return (
        typeof obj.type === 'string' &&
        (VALID_DISPLAY_TYPES as readonly string[]).includes(obj.type)
    );
}
