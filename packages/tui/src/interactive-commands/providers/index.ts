

import type { CommandDefinition } from '../command-parser.js';
import { overlayOnlyHandler } from '../command-parser.js';

export const providersCommands: CommandDefinition = {
    name: 'providers',
    description: 'Browse available providers and models',
    usage: '/providers',
    category: 'General',
    aliases: ['provider'],
    handler: overlayOnlyHandler,
};
