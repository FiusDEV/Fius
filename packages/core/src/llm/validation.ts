import { getAllowedMimeTypes, validateModelFileSupport } from '@fius/llm';
import type { LLMProvider } from '@fius/llm';
import type { Logger } from '../logger/v2/types.js';
import type { ImageData, FileData } from '../context/types.js';
import { Result, ok, fail } from '../utils/result.js';
import { Issue, ErrorScope, ErrorType } from '../errors/types.js';
import { LLMErrorCode } from './error-codes.js';

export interface ValidationLLMConfig {
    provider: LLMProvider;
    model?: string;
}

export interface ValidationContext {
    provider?: string;
    model?: string | undefined;
    fileSize?: number;
    maxFileSize?: number;
    filename?: string | undefined;
    mimeType?: string;
    fileType?: string | undefined;
    suggestedAction?: string;
}

export interface ValidationData {
    fileValidation?: {
        isSupported: boolean;
        fileType?: string;
        error?: string;
    };
    imageValidation?: {
        isSupported: boolean;
        error?: string;
    };
}

export interface ValidationInput {
    text?: string;
    imageData?: ImageData | undefined;
    fileData?: FileData | undefined;
}

const MAX_FILE_SIZE = 67108864;
const MAX_IMAGE_SIZE = 20971520;

export function validateInputForLLM(
    input: ValidationInput,
    config: ValidationLLMConfig,
    logger: Logger
): Result<ValidationData, ValidationContext> {
    const issues: Issue<ValidationContext>[] = [];
    const validationData: ValidationData = {};

    try {
        const context: ValidationContext = {
            provider: config.provider,
            model: config.model,
        };

        if (input.fileData) {
            const fileValidation = validateFileInput(input.fileData, config, logger);
            validationData.fileValidation = fileValidation;

            if (!fileValidation.isSupported) {
                issues.push({
                    code: LLMErrorCode.INPUT_FILE_UNSUPPORTED,
                    message: fileValidation.error || 'File type not supported by current LLM',
                    scope: ErrorScope.LLM,
                    type: ErrorType.USER,
                    severity: 'error',
                    context: {
                        ...context,
                        fileType: fileValidation.fileType,
                        mimeType: input.fileData.mimeType,
                        filename: input.fileData.filename,
                        suggestedAction: 'Use a supported file type or different model',
                    },
                });
            }
        }

        if (input.imageData) {
            const imageValidation = validateImageInput(input.imageData, config, logger);
            validationData.imageValidation = imageValidation;

            if (!imageValidation.isSupported) {
                issues.push({
                    code: LLMErrorCode.INPUT_IMAGE_UNSUPPORTED,
                    message: imageValidation.error || 'Image format not supported by current LLM',
                    scope: ErrorScope.LLM,
                    type: ErrorType.USER,
                    severity: 'error',
                    context: {
                        ...context,
                        suggestedAction: 'Use a supported image format or different model',
                    },
                });
            }
        }

        return issues.length === 0 ? ok(validationData, issues) : fail(issues);
    } catch (error) {
        logger.error(`Error during input validation: ${error}`);
        return fail([
            {
                code: LLMErrorCode.REQUEST_INVALID_SCHEMA,
                message: 'Failed to validate input',
                scope: ErrorScope.LLM,
                type: ErrorType.SYSTEM,
                severity: 'error',
                context: {
                    provider: config.provider,
                    model: config.model,
                    suggestedAction: 'Check input format and try again',
                },
            },
        ]);
    }
}

function validateFileInput(
    fileData: FileData,
    config: ValidationLLMConfig,
    logger: Logger
): NonNullable<ValidationData['fileValidation']> {
    logger.info(`Validating file input: ${fileData.mimeType}`);

    if (typeof fileData.data === 'string' && fileData.data.length > MAX_FILE_SIZE) {
        return {
            isSupported: false,
            error: 'File size too large (max 64MB)',
        };
    }

    const baseMimeType =
        fileData.mimeType.toLowerCase().split(';')[0]?.trim() || fileData.mimeType.toLowerCase();
    const allowedMimeTypes = getAllowedMimeTypes();
    if (!allowedMimeTypes.includes(baseMimeType)) {
        return {
            isSupported: false,
            error: `Unsupported file type: ${fileData.mimeType}`,
        };
    }

    if (typeof fileData.data === 'string') {
        const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
        if (!base64Regex.test(fileData.data) || fileData.data.length % 4 !== 0) {
            return {
                isSupported: false,
                error: 'Invalid file data format',
            };
        }
    }

    if (config.model) {
        return validateModelFileSupport(config.provider, config.model, fileData.mimeType);
    }

    return {
        isSupported: false,
        error: 'Model must be specified for file capability validation',
    };
}

function validateImageInput(
    imageData: ImageData,
    config: ValidationLLMConfig,
    logger: Logger
): NonNullable<ValidationData['imageValidation']> {
    logger.info(`Validating image input: ${imageData.mimeType}`);

    if (typeof imageData.image === 'string' && imageData.image.length > MAX_IMAGE_SIZE) {
        return {
            isSupported: false,
            error: `Image size too large (max ${MAX_IMAGE_SIZE / 1048576}MB)`,
        };
    }

    let resolvedMime: string | undefined = imageData.mimeType?.toLowerCase();
    if (!resolvedMime && typeof imageData.image === 'string') {
        const dataUrlMatch = /^data:([^;]+);base64,/i.exec(imageData.image);
        if (dataUrlMatch && dataUrlMatch[1]) {
            resolvedMime = dataUrlMatch[1].toLowerCase();
        }
    }

    if (!resolvedMime) {
        return { isSupported: false, error: 'Missing image MIME type' };
    }

    if (!config.model) {
        return {
            isSupported: false,
            error: 'Model must be specified for image capability validation',
        };
    }

    const baseMimeType = resolvedMime.split(';')[0]?.trim() || resolvedMime;

    const res = validateModelFileSupport(config.provider, config.model, baseMimeType);
    return {
        isSupported: res.isSupported,
        ...(res.error ? { error: res.error } : {}),
    };
}
