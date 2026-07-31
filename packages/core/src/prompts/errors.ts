import { FiusRuntimeError } from '../errors/FiusRuntimeError.js';
import { FiusValidationError } from '../errors/FiusValidationError.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { PromptErrorCode } from './error-codes.js';


export class PromptError {
    
    static notFound(name: string) {
        return new FiusRuntimeError(
            PromptErrorCode.PROMPT_NOT_FOUND,
            ErrorScope.PROMPT,
            ErrorType.NOT_FOUND,
            `Prompt not found: ${name}`,
            { name }
        );
    }

    
    static missingText() {
        return new FiusValidationError([
            {
                code: PromptErrorCode.PROMPT_MISSING_TEXT,
                message: 'Prompt missing text content',
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: {},
            },
        ]);
    }

    
    static missingRequiredArguments(missingNames: string[]) {
        return new FiusValidationError([
            {
                code: PromptErrorCode.PROMPT_MISSING_REQUIRED_ARGUMENTS,
                message: `Missing required arguments: ${missingNames.join(', ')}`,
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: { missingNames },
            },
        ]);
    }

    
    static providerNotFound(source: string) {
        return new FiusRuntimeError(
            PromptErrorCode.PROMPT_PROVIDER_NOT_FOUND,
            ErrorScope.PROMPT,
            ErrorType.NOT_FOUND,
            `No provider found for prompt source: ${source}`,
            { source }
        );
    }

    
    static nameRequired() {
        return new FiusValidationError([
            {
                code: PromptErrorCode.PROMPT_NAME_REQUIRED,
                message: 'Prompt name is required',
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: {},
            },
        ]);
    }

    
    static invalidName(name: string, guidance: string, context?: string, hint?: string) {
        const contextPrefix = context ?? 'Prompt name';
        const hintSuffix = hint ? ` ${hint}` : '';
        return new FiusValidationError([
            {
                code: PromptErrorCode.PROMPT_INVALID_NAME,
                message: `${contextPrefix} '${name}' must be ${guidance}.${hintSuffix}`,
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: { name, guidance },
            },
        ]);
    }

    
    static alreadyExists(name: string) {
        return new FiusValidationError([
            {
                code: PromptErrorCode.PROMPT_ALREADY_EXISTS,
                message: `Prompt already exists: ${name}`,
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: { name },
            },
        ]);
    }

    
    static emptyResolvedContent(name: string) {
        return new FiusRuntimeError(
            PromptErrorCode.PROMPT_EMPTY_CONTENT,
            ErrorScope.PROMPT,
            ErrorType.NOT_FOUND,
            `Prompt resolved to empty content: ${name}`,
            { name }
        );
    }

    
    static validationFailed(details: string) {
        return new FiusValidationError([
            {
                code: PromptErrorCode.PROMPT_CONFIG_INVALID,
                message: `Invalid prompts configuration: ${details}`,
                scope: ErrorScope.PROMPT,
                type: ErrorType.USER,
                severity: 'error',
                context: { details },
            },
        ]);
    }
}
