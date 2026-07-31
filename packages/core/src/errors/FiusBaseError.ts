import { randomUUID } from 'crypto';


export abstract class FiusBaseError extends Error {
    public readonly traceId: string;

    constructor(message: string, traceId?: string) {
        super(message);
        this.traceId = traceId || randomUUID();
        this.name = this.constructor.name;
    }

    
    abstract toJSON(): Record<string, any>;
}
