

import type { CommandDefinition } from '../command-parser.js';
import { overlayOnlyHandler } from '../command-parser.js';


export const mcpCommands: CommandDefinition = {
    name: 'mcp',
    description: 'Manage MCP servers (interactive)',
    usage: '/mcp',
    category: 'MCP Management',
    handler: overlayOnlyHandler,
};
