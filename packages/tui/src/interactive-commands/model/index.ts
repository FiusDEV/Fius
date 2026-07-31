

import type { CommandDefinition } from '../command-parser.js';
import { overlayOnlyHandler } from '../command-parser.js';


export const modelCommands: CommandDefinition = {
    name: 'models',
    description: 'Switch AI model (interactive selector)',
    usage: '/models',
    category: 'General',
    aliases: ['m', 'model'],
    handler: overlayOnlyHandler,
};
