

import { randomUUID } from 'crypto';


export function generateMessageId(type: string): string {
    return `${type}-${randomUUID()}`;
}
