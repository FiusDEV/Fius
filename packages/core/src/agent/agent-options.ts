import type { CompactionStrategy } from '../context/compaction/types.js';
import type { Logger } from '../logger/v2/types.js';
import type { Hook } from '../hooks/types.js';
import type { Tool } from '../tools/types.js';
import type { InitializeServicesOptions, ToolkitLoader } from '../utils/service-initializer.js';
import type { FiusStores } from '../storage/stores/types.js';
import type { FiusAgentConfigInput } from './runtime-config.js';
import type { SkillSource } from '../skills/index.js';


export interface FiusAgentOptions {
    overrides?: InitializeServicesOptions | undefined;

    
    logger: Logger;

    
    stores: FiusStores;

    
    tools?: Tool[] | undefined;

    
    skillSources?: SkillSource[] | undefined;

    
    toolkitLoader?: ToolkitLoader | undefined;

    
    hooks?: Hook[] | undefined;

    
    compaction?: CompactionStrategy | null | undefined;
}

export interface FiusAgentOptions extends FiusAgentConfigInput {}
