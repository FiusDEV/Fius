

import type { CommandDefinition } from './command-parser.js';
import { overlayOnlyHandler } from './command-parser.js';


export const skillCommands: CommandDefinition[] = [
    {
        name: 'skills',
        description: 'Manage installed skills (interactive)',
        usage: '/skills',
        category: 'Skill Management',
        handler: overlayOnlyHandler,
    },
];
