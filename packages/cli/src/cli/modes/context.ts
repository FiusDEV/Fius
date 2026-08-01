import type { ValidatedAgentConfig } from '@fiusdev/agent-config';
import type { FiusAgent } from '@fiusdev/core';
import type { UpdateInfo } from '../utils/version-check.js';

export interface MainModeOptions {
    mode: string;
    port?: string;
    resume?: string;
    continue?: boolean;
    bypassPermissions?: boolean;
}

export interface MainModeContext {
    agent: FiusAgent;
    opts: MainModeOptions;
    workspaceRoot: string;
    validatedConfig: ValidatedAgentConfig;
    resolvedPath: string;
    derivedAgentId: string;
    initialPrompt: string | undefined;
    getVersionCheckResult: () => Promise<UpdateInfo | null>;
}