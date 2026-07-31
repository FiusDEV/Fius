

import type { CommandDefinition } from '../command-parser.js';
import { overlayOnlyHandler } from '../command-parser.js';


export const pluginCommands: CommandDefinition = {
    name: 'plugin',
    description: 'Manage plugins (interactive)',
    usage: '/plugin',
    category: 'Plugin Management',
    handler: overlayOnlyHandler,
};
