


export type BlobInput =
    | string
    | Uint8Array
    | Buffer
    | ArrayBuffer;


export interface BlobMetadata {
    mimeType?: string | undefined;
    originalName?: string | undefined;
    createdAt?: Date | undefined;
    source?: 'tool' | 'user' | 'system' | undefined;
    size?: number | undefined;
}


export interface StoredBlobMetadata {
    id: string;
    mimeType: string;
    originalName?: string | undefined;
    createdAt: Date;
    size: number;
    hash: string;
    source?: 'tool' | 'user' | 'system' | undefined;
}


export interface BlobReference {
    id: string;
    uri: string;
    metadata: StoredBlobMetadata;
}


export type BlobData =
    | { format: 'base64'; data: string; metadata: StoredBlobMetadata }
    | { format: 'buffer'; data: Buffer; metadata: StoredBlobMetadata }
    | { format: 'path'; data: string; metadata: StoredBlobMetadata }
    | { format: 'stream'; data: NodeJS.ReadableStream; metadata: StoredBlobMetadata }
    | { format: 'url'; data: string; metadata: StoredBlobMetadata };


export interface BlobStats {
    count: number;
    totalSize: number;
    backendType: string;
    storePath: string;
}


export interface BlobStore {
    
    store(input: BlobInput, metadata?: BlobMetadata): Promise<BlobReference>;

    
    retrieve(
        reference: string,
        format?: 'base64' | 'buffer' | 'path' | 'stream' | 'url'
    ): Promise<BlobData>;

    
    exists(reference: string): Promise<boolean>;

    
    delete(reference: string): Promise<void>;

    
    cleanup(olderThan?: Date): Promise<number>;

    
    getStats(): Promise<BlobStats>;

    
    listBlobs(): Promise<BlobReference[]>;

    
    getStoragePath(): string | undefined;

    
    connect(): Promise<void>;

    
    disconnect(): Promise<void>;

    
    isConnected(): boolean;

    
    getStoreType(): string;
}
