import { AsyncLocalStorage } from 'async_hooks';


export interface AsyncContext {
    
    tenantId?: string;

    
    userId?: string;
}


const asyncContext = new AsyncLocalStorage<AsyncContext>();


export function setContext(ctx: AsyncContext): void {
    asyncContext.enterWith(ctx);
}


export function getContext(): AsyncContext | undefined {
    return asyncContext.getStore();
}


export async function runWithContext<T>(ctx: AsyncContext, fn: () => Promise<T>): Promise<T> {
    return asyncContext.run(ctx, fn);
}


export function isAsyncContextAvailable(): boolean {
    try {
        return typeof AsyncLocalStorage !== 'undefined';
    } catch {
        return false;
    }
}
