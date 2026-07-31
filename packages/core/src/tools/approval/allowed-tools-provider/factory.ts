import { InMemoryAllowedToolsProvider } from './in-memory.js';
import { StorageAllowedToolsProvider } from './storage.js';
import type { AllowedToolsProvider } from './types.js';
import type { ToolPreferenceStore } from '../../../storage/index.js';
import { ToolError } from '../../errors.js';
import type { Logger } from '../../../logger/v2/types.js';

export type AllowedToolsConfig =
    | {
          type: 'memory';
      }
    | {
          type: 'storage';
          toolPreferenceStore: ToolPreferenceStore;
      };


export function createAllowedToolsProvider(
    config: AllowedToolsConfig,
    logger: Logger
): AllowedToolsProvider {
    switch (config.type) {
        case 'memory':
            return new InMemoryAllowedToolsProvider();
        case 'storage':
            return new StorageAllowedToolsProvider(config.toolPreferenceStore, logger);
        default: {
            const _exhaustive: never = config;
            throw ToolError.configInvalid(
                `Unsupported AllowedToolsConfig type: ${(config as any)?.type}`
            );
        }
    }
}
