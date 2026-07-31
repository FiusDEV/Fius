import { ResourceError } from '../errors.js';
import { FileSystemResourceHandler } from './filesystem-handler.js';
import { BlobResourceHandler } from './blob-handler.js';
import type { InternalResourceServices, InternalResourceHandler } from './types.js';
import type { ValidatedResourceConfig } from '../schemas.js';
import type { Logger } from '../../logger/v2/types.js';


export function createInternalResourceHandler(
    config: ValidatedResourceConfig,
    services: InternalResourceServices,
    logger: Logger
): InternalResourceHandler {
    const type = config.type;
    if (type === 'filesystem') {
        const artifactStoragePath = services.artifactStore.getStoragePath();
        return new FileSystemResourceHandler(config, logger, artifactStoragePath);
    }
    if (type === 'blob') {
        return new BlobResourceHandler(config, services.artifactStore, logger);
    }
    throw ResourceError.providerError(
        'Internal',
        'createInternalResourceHandler',
        `Unsupported internal resource handler type: ${type}`
    );
}


export function getInternalResourceHandlerTypes(): string[] {
    return ['filesystem', 'blob'];
}
