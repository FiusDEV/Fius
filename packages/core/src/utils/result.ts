import { z, ZodError } from 'zod';
import type { FiusErrorCode, Issue } from '../errors/types.js';
import { ErrorScope, ErrorType } from '../errors/types.js';


export const NonEmptyTrimmed = z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: 'Required' });

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);


function isValidUrl(s: string): boolean {
    try {
        const u = new URL(s);
        return ALLOWED_URL_PROTOCOLS.has(u.protocol);
    } catch {
        return false;
    }
}

export const OptionalURL = z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s === '' || isValidUrl(s), { message: 'Invalid URL' })
    .transform((s) => (s === '' ? undefined : s))
    .optional();

export const EnvExpandedString = (env?: Record<string, string | undefined>) =>
    z.string().transform((input) => {
        if (typeof input !== 'string') return '';
        const envToUse = env ?? process.env;
        const out = input.replace(
            /\$([A-Z_][A-Z0-9_]*)|\${([A-Z_][A-Z0-9_]*)}/gi,
            (_, a, b) => envToUse[a || b] ?? ''
        );
        return out.trim();
    });

export const NonEmptyEnvExpandedString = (env?: Record<string, string | undefined>) =>
    EnvExpandedString(env).refine((s) => s.length > 0, {
        message: 'Value is required',
    });

export const RequiredEnvURL = (env?: Record<string, string | undefined>) =>
    EnvExpandedString(env).refine(
        (s) => {
            try {
                const u = new URL(s);
                return ALLOWED_URL_PROTOCOLS.has(u.protocol);
            } catch {
                return false;
            }
        },
        { message: 'Invalid URL' }
    );


export type Result<T, C = unknown> =
    | { ok: true; data: T; issues: Issue<C>[] }
    | { ok: false; issues: Issue<C>[] };


export const ok = <T, C = unknown>(data: T, issues: Issue<C>[] = []): Result<T, C> => ({
    ok: true,
    data,
    issues,
});


export const fail = <T = never, C = unknown>(issues: Issue<C>[]): Result<T, C> => ({
    ok: false,
    issues,
});


export function hasErrors<C>(issues: Issue<C>[]) {
    return issues.some((i) => i.severity !== 'warning');
}


export function splitIssues<C>(issues: Issue<C>[]) {
    return {
        errors: issues.filter((i) => i.severity !== 'warning'),
        warnings: issues.filter((i) => i.severity === 'warning'),
    };
}


export function zodToIssues<C = unknown>(
    err: ZodError,
    severity: 'error' | 'warning' = 'error'
): Issue<C>[] {
    const issues: Issue<C>[] = [];
    const normalizePath = (path: PropertyKey[]): Array<string | number> =>
        path.filter((segment): segment is string | number => {
            return typeof segment === 'string' || typeof segment === 'number';
        });

    for (const e of err.issues) {
        if (e.code === 'invalid_union' && 'errors' in e) {
            const unionErrors = e.errors;
            let hasCollectedErrors = false;
            for (const unionIssueSet of unionErrors) {
                if (unionIssueSet.length > 0) {
                    issues.push(...zodToIssues<C>(new ZodError(unionIssueSet), severity));
                    hasCollectedErrors = true;
                }
            }

            if (!hasCollectedErrors) {
                const params = (e as any).params || {};
                issues.push({
                    code: (params.code ?? 'schema_validation') as FiusErrorCode,
                    message: e.message,
                    scope: params.scope ?? ErrorScope.AGENT,
                    type: params.type ?? ErrorType.USER,
                    path: normalizePath(e.path),
                    severity,
                    context: params as C,
                });
            }
        } else {
            const params = (e as any).params || {};
            issues.push({
                code: (params.code ?? 'schema_validation') as FiusErrorCode,
                message: e.message,
                scope: params.scope ?? ErrorScope.AGENT,
                type: params.type ?? ErrorType.USER,
                path: normalizePath(e.path),
                severity,
                context: params as C,
            });
        }
    }

    return issues;
}
