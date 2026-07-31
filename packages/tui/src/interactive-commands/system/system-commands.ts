
import {
    type CommandDefinition,
    type CommandHandlerResult,
    type CommandContext,
} from '../command-parser.js';
import type { TuiAgentBackend } from '../../agent-backend.js';


export const systemCommands: CommandDefinition[] = [
    {
        name: 'stream',
        description: 'Toggle streaming mode for LLM responses',
        usage: '/stream',
        category: 'System',
        handler: async (
            _args: string[],
            _agent: TuiAgentBackend,
            _ctx: CommandContext
        ): Promise<boolean | string> => {
            // Overlay is handled via commandOverlays.ts mapping
            return true;
        },
    },
    {
        name: 'access',
        description: 'Choose access level: Full Access or Confirm Actions',
        usage: '/access',
        category: 'System',
        handler: async (
            _args: string[],
            _agent: TuiAgentBackend,
            _ctx: CommandContext
        ): Promise<boolean | string> => {
            // Overlay is handled via commandOverlays.ts mapping
            return true;
        },
    },
    {
        name: 'mode',
        description: 'Choose build mode: Plan or Build',
        usage: '/mode',
        category: 'System',
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
