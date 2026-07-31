import type { Hook } from '@fius/core';
import type { CompactionStrategy } from '@fius/core';
import type { Logger } from '@fius/core';
import type { FiusStores } from '@fius/core/storage';
import type { SkillSource, Tool, ToolkitLoader } from '@fius/core';
import type { WorkspaceHandleProvider } from '@fius/core/workspace';

export interface ResolvedServices {
    logger: Logger;
    stores: FiusStores;
    tools: Tool[];
    skillSources: SkillSource[];
    toolkitLoader?: ToolkitLoader;
    workspaceHandleProvider?: WorkspaceHandleProvider;
    hooks: Hook[];
    compaction: CompactionStrategy | null;
}
