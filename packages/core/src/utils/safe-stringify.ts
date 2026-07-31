import { redactSensitiveData } from './redactor.js';


export function safeStringify(value: unknown, maxLen?: number): string {
    try {
        if (typeof value === 'bigint') {
            return value.toString();
        }
        const redacted = redactSensitiveData(value);
        const str = JSON.stringify(redacted, (_, v) => {
            if (v instanceof Error) {
                return { name: v.name, message: v.message, stack: v.stack };
            }
            if (typeof v === 'bigint') return v.toString();
            return v;
        });
        if (typeof str === 'string') {
            if (maxLen !== undefined && maxLen > 0 && str.length > maxLen) {
                const indicator = '…(truncated)';
                if (maxLen <= indicator.length) {
                    return str.slice(0, maxLen);
                }
                const sliceLen = maxLen - indicator.length;
                return `${str.slice(0, sliceLen)}${indicator}`;
            }
            return str;
        }
        return String(value);
    } catch {
        try {
            return String(value);
        } catch {
            return '[Unserializable value]';
        }
    }
}
