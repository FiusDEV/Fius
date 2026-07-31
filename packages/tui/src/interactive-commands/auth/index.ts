

import type { CommandDefinition } from '../command-parser.js';
import { overlayOnlyHandler } from '../command-parser.js';


export const loginCommand: CommandDefinition = {
    name: 'login',
    description: 'Login to Fius',
    usage: '/login',
    category: 'General',
    handler: overlayOnlyHandler,
};

export const logoutCommand: CommandDefinition = {
    name: 'logout',
    description: 'Logout from Fius',
    usage: '/logout',
    category: 'General',
    handler: overlayOnlyHandler,
};

export const connectCommand: CommandDefinition = {
    name: 'connect',
    description: 'Connect or switch model provider auth',
    usage: '/connect',
    category: 'Model Management',
    handler: overlayOnlyHandler,
};
