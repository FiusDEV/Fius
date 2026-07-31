

export type { ResourceSource, ResourceMetadata, ResourceProvider, ResourceSet } from './types.js';
export type {
    ResourcesConfig,
    ValidatedResourcesConfig,
    ValidatedResourceConfig,
    ValidatedFileSystemResourceConfig,
    ValidatedBlobResourceConfig,
} from './schemas.js';

export { ResourceManager } from './manager.js';
export { ResourceError } from './errors.js';
export { ResourceErrorCodes } from './error-codes.js';

export type { InternalResourceHandler, InternalResourceServices } from './handlers/types.js';
export { AgentResourcesProvider } from './agent-resources-provider.js';
export {
    createInternalResourceHandler,
    getInternalResourceHandlerTypes,
} from './handlers/factory.js';


export type { ResourceReference, ResourceExpansionResult } from './reference-parser.js';
export {
    parseResourceReferences,
    resolveResourceReferences,
    expandMessageReferences,
    formatResourceContent,
} from './reference-parser.js';

export { ResourceConfigSchema, ResourcesConfigSchema } from './schemas.js';
