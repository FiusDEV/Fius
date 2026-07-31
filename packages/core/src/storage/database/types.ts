
export interface Database {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    setIfAbsent<T>(key: string, value: T): Promise<{ value: T; inserted: boolean }>;
    delete(key: string): Promise<void>;

    list(prefix: string): Promise<string[]>;

    append<T>(key: string, item: T): Promise<void>;
    
    updateList<T, R>(key: string, updater: (items: T[]) => { items: T[]; result: R }): Promise<R>;
    
    getRange<T>(key: string, start: number, count: number): Promise<T[]>;

    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    getStoreType(): string;
}
