import type { ToolExecutionContext } from '@fiusdev/core';
import type { SchedulerManager } from './manager.js';

export type SchedulerManagerGetter = (context: ToolExecutionContext) => Promise<SchedulerManager>;
