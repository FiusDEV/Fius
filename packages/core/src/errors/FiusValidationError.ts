import { FiusBaseError } from './FiusBaseError.js';
import type { Issue } from './types.js';


export class FiusValidationError extends FiusBaseError {
    public readonly issues: Issue[];

    constructor(issues: Issue[]) {
        const message = FiusValidationError.formatMessage(issues);
        super(message);
        this.name = 'FiusValidationError';
        this.issues = issues;
    }

    
    private static formatMessage(issues: Issue[]): string {
        if (issues.length === 0) {
            return 'Validation failed';
        }

        if (issues.length === 1) {
            return issues[0]!.message; // We know it exists after length check
        }

        const errors = issues.filter((i) => i.severity === 'error');
        const warnings = issues.filter((i) => i.severity === 'warning');

        const parts: string[] = [];
        if (errors.length > 0) {
            parts.push(`${errors.length} error${errors.length > 1 ? 's' : ''}`);
        }
        if (warnings.length > 0) {
            parts.push(`${warnings.length} warning${warnings.length > 1 ? 's' : ''}`);
        }

        return `Validation failed with ${parts.join(' and ')}`;
    }

    
    get errors(): Issue[] {
        return this.issues.filter((i) => i.severity === 'error');
    }

    
    get warnings(): Issue[] {
        return this.issues.filter((i) => i.severity === 'warning');
    }

    
    hasErrors(): boolean {
        return this.errors.length > 0;
    }

    
    hasWarnings(): boolean {
        return this.warnings.length > 0;
    }

    
    get firstError(): Issue | undefined {
        return this.errors[0];
    }

    
    get firstWarning(): Issue | undefined {
        return this.warnings[0];
    }

    
    format(): { errors: string[]; warnings: string[] } {
        return {
            errors: this.errors.map((e) => `[${e.code}] ${e.message}`),
            warnings: this.warnings.map((w) => `[${w.code}] ${w.message}`),
        };
    }

    
    toJSON(): Record<string, any> {
        return {
            name: this.name,
            message: this.message,
            issues: this.issues,
            traceId: this.traceId,
            errorCount: this.errors.length,
            warningCount: this.warnings.length,
        };
    }
}
