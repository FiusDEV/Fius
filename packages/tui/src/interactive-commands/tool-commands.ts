

import type { CommandDefinition, CommandContext } from './command-parser.js';
import type { TuiAgentBackend } from '../agent-backend.js';


export const toolCommands: CommandDefinition[] = [
    {
        name: 'tools',
        description: 'Browse available tools interactively',
        usage: '/tools',
        category: 'Tool Management',
        handler: async (
            _args: string[],
            _agent: TuiAgentBackend,
            _ctx: CommandContext
        ): Promise<boolean | string> => {
            // Overlay is handled via commandOverlays.ts mapping
            return true;
        },
    },
];
