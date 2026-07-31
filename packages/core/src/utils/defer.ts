


export type CleanupFunction = () => void | Promise<void>;


export interface DeferredCleanup extends Disposable, AsyncDisposable {
    [Symbol.dispose]: () => void;
    [Symbol.asyncDispose]: () => Promise<void>;
}


export function defer(cleanupFn: CleanupFunction): DeferredCleanup {
    return {
        [Symbol.dispose](): void {
            const result = cleanupFn();
            if (result instanceof Promise) {
                result.catch((err) => {
                    console.error('Deferred async cleanup failed (used sync dispose):', err);
                });
            }
        },

        [Symbol.asyncDispose](): Promise<void> {
            return Promise.resolve(cleanupFn());
        },
    };
}
