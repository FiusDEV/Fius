export type MemorySource = 'user' | 'system';

export interface Memory {
    id: string;
    content: string;
    createdAt: number;
    updatedAt: number;
    tags?: string[] | undefined;
    metadata?:
        | {
              source?: MemorySource | undefined;
              pinned?: boolean | undefined;
              [key: string]: unknown;
          }
        | undefined;
}

export interface CreateMemoryInput {
    content: string;
    tags?: string[];
    metadata?: {
        source?: MemorySource;
        [key: string]: unknown;
    };
}

export interface UpdateMemoryInput {
    content?: string;
    tags?: string[];
    metadata?: {
        source?: MemorySource;
        pinned?: boolean;
        [key: string]: unknown;
    };
}

export interface ListMemoriesOptions {
    tags?: string[];
    source?: MemorySource;
    pinned?: boolean;
    limit?: number;
    offset?: number;
}
