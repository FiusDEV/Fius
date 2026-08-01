import type { Command } from 'commander';
import type { FiusAgent } from '@fiusdev/core';

export type BootstrapAgentMode = 'headless-run' | 'non-interactive';

export interface RuntimeCommandRegisterContext {
    program: Command;
    cliVersion: string;
    bootstrapAgentFromGlobalOpts: (options: {
        mode: BootstrapAgentMode;
        modelOverride?: string;
    }) => Promise<FiusAgent>;
}