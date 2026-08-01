import type { Hook } from '@fiusdev/core';
import type { CompactionStrategy } from '@fiusdev/core';
import type { Logger } from '@fiusdev/core';
import type { FiusStores } from '@fiusdev/core/storage';
import type { SkillSource, Tool, ToolkitLoader } from '@fiusdev/core';
import type { WorkspaceHandleProvider } from '@fiusdev/core/workspace';

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
