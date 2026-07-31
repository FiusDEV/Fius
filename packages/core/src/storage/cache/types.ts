
export interface Cache {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;

    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    getStoreType(): string;
}
