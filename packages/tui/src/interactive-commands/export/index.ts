

import type { CommandDefinition, CommandContext, CommandHandlerResult } from '../command-parser.js';
import type { TuiAgentBackend } from '../../agent-backend.js';


export const exportCommand: CommandDefinition = {
    name: 'export',
    description: 'Export conversation to markdown or JSON',
    usage: '/export',
    category: 'Session',
    handler: async (
        _args: string[],
        _agent: TuiAgentBackend,
        _ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        // This handler is never called - export is in ALWAYS_OVERLAY
        // which intercepts and shows the export wizard overlay instead
        return true;
    },
};
