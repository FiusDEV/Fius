

import type { CommandDefinition, CommandContext } from '../command-parser.js';
import type { TuiAgentBackend } from '../../agent-backend.js';


export const sessionsCommand: CommandDefinition = {
    name: 'sessions',
    description: 'Switch to a different session (interactive selector)',
    usage: '/sessions',
    category: 'General',
    aliases: ['r'],
    handler: async (
        _args: string[],
        _agent: TuiAgentBackend,
        _ctx: CommandContext
    ): Promise<boolean | string> => {
        const helpText = [
            ' Sessions',
            '\nType /sessions to show the session selector\n',
        ].join('\n');

        return helpText;
    },
};


export const searchCommand: CommandDefinition = {
    name: 'search',
    description: 'Search messages across all sessions',
    usage: '/search',
    category: 'General',
    aliases: ['find'],
    handler: async (
        _args: string[],
        _agent: TuiAgentBackend,
        _ctx: CommandContext
    ): Promise<boolean> => {
        // Interactive overlay handles everything - just return success
        return true;
    },
};


export const renameCommand: CommandDefinition = {
    name: 'rename',
    description: 'Rename the current session',
    usage: '/rename',
    category: 'General',
    handler: async (
        _args: string[],
        _agent: TuiAgentBackend,
        _ctx: CommandContext
    ): Promise<boolean> => {
        // Interactive overlay handles everything - just return success
        return true;
    },
};


export const forkCommand: CommandDefinition = {
    name: 'fork',
    description: 'Fork a session and create a child session with copied history',
    usage: '/fork',
    category: 'General',
    handler: async (
        _args: string[],
        agent: TuiAgentBackend,
        ctx: CommandContext
    ): Promise<string> => {
        const parentSessionId = ctx.sessionId;

        if (!parentSessionId) {
            return ['⚠  No active session to fork.', 'Start a session first, then run /fork.'].join(
                '\n'
            );
        }

        const childSession = await agent.forkSession(parentSessionId);
        const childMetadata = await agent.getSessionMetadata(childSession.id);
        const title = childMetadata?.title ? ` (${childMetadata.title})` : '';

        return [
            ' Session forked',
            `Parent: ${parentSessionId}`,
            `Child: ${childSession.id}${title}`,
            '',
            'Use /sessions to switch to the new session.',
        ].join('\n');
    },
};
