

const SENSITIVE_FIELDS = [
    'apikey',
    'api_key',
    'token',
    'access_token',
    'refresh_token',
    'password',
    'secret',
];

const FILE_DATA_FIELDS = [
    'base64',
    'filedata',
    'file_data',
    'imagedata',
    'image_data',
    'audiodata',
    'audio_data',
    'data',
];

const SENSITIVE_PATTERNS: RegExp[] = [
    /\bsk-[A-Za-z0-9]{20,}\b/g,
    /\bBearer\s+[A-Za-z0-9\-_.=]+\b/gi,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g;

const SIGNED_URL_PATTERNS = [
    /supabase\.co\/storage\/.*\?token=/i,
    /\.r2\.cloudflarestorage\.com\/.*\?/i,
    /\.s3\..*amazonaws\.com\/.*\?(X-Amz-|AWSAccessKeyId)/i,
    /storage\.googleapis\.com\/.*\?/i,
];

const REDACTED = '[REDACTED]';
const REDACTED_CIRCULAR = '[REDACTED_CIRCULAR]';
const FILE_DATA_TRUNCATED = '[FILE_DATA_TRUNCATED]';


function isLargeBase64Data(value: string): boolean {
    return value.length > 1000 && /^[A-Za-z0-9+/=]{1000,}$/.test(value.substring(0, 1000));
}


function truncateFileData(value: unknown, key: string, parent?: Record<string, unknown>): unknown {
    if (typeof value !== 'string') return value;
    const lowerKey = key.toLowerCase();
    const hasFileContext =
        !!parent && ('mimeType' in parent || 'filename' in parent || 'fileName' in parent);
    const looksLikeFileField =
        FILE_DATA_FIELDS.includes(lowerKey) || (lowerKey === 'data' && hasFileContext);
    if (looksLikeFileField && isLargeBase64Data(value)) {
        return `${FILE_DATA_TRUNCATED} (${value.length} chars)`;
    }
    return value;
}



function isSignedUrl(value: string): boolean {
    return SIGNED_URL_PATTERNS.some((pattern) => pattern.test(value));
}

export function redactSensitiveData(input: unknown, seen = new WeakSet()): unknown {
    if (typeof input === 'string') {
        let result = input;
        for (const pattern of SENSITIVE_PATTERNS) {
            result = result.replace(pattern, REDACTED);
        }
        if (!isSignedUrl(result)) {
            result = result.replace(JWT_PATTERN, REDACTED);
        }
        return result;
    }
    if (Array.isArray(input)) {
        if (seen.has(input)) return REDACTED_CIRCULAR;
        seen.add(input);
        return input.map((item) => redactSensitiveData(item, seen));
    }
    if (input && typeof input === 'object') {
        if (seen.has(input)) return REDACTED_CIRCULAR;
        seen.add(input);
        const result: any = {};
        for (const [key, value] of Object.entries(input)) {
            if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
                result[key] = REDACTED;
            } else {
                const truncatedValue = truncateFileData(
                    value,
                    key,
                    input as Record<string, unknown>
                );
                result[key] = redactSensitiveData(truncatedValue, seen);
            }
        }
        return result;
    }
    return input;
}
