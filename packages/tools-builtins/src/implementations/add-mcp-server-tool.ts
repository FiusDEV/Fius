import { z } from 'zod';
import { createLocalToolCallHeader, defineTool } from '@fiusdev/core/tools';
import type { Tool, ToolExecutionContext } from '@fiusdev/core/tools';

const AddMcpServerInputSchema = z
    .object({
        name: z.string().describe('Name for the MCP server'),
        type: z
            .enum(['stdio', 'sse', 'http'])
            .describe('Transport type: stdio for local processes, sse for Server-Sent Events, http for HTTP'),
        command: z
            .string()
            .optional()
            .describe('Command to run the server (required for stdio type, e.g. "npx")'),
        args: z
            .array(z.string())
            .optional()
            .describe('Arguments for the command (for stdio type, e.g. ["-y", "package-name"])'),
        url: z
            .string()
            .optional()
            .describe('URL for SSE or HTTP transport type'),
        env: z
            .record(z.string(), z.string())
            .optional()
            .describe('Environment variables for the server process'),
    })
    .strict();

/**
 * Tool for adding an MCP server to the agent.
 */
export function createAddMcpServerTool(): Tool<typeof AddMcpServerInputSchema> {
    return defineTool({
        id: 'add_mcp_server',
        description:
            'Add a new MCP (Model Context Protocol) server to the agent. ' +
            'For stdio servers, provide command and args (e.g. command="npx", args=["-y", "package-name"]). ' +
            'For SSE/HTTP servers, provide a url. ' +
            'The server will be connected automatically and its tools will become available.',
        inputSchema: AddMcpServerInputSchema,
        presentation: {
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Add MCP Server',
                    argsText: input.name,
                }),
        },
        async execute(input, context: ToolExecutionContext) {
            const agent = context.agent;
            if (!agent) {
                return { error: 'Agent not available in execution context' };
            }

            const { name, type, command, args, url, env } = input;

            try {
                // Build the discriminated union config based on type
                let serverConfig: Record<string, unknown>;
                if (type === 'stdio') {
                    serverConfig = {
                        type: 'stdio',
                        command: command || '',
                        ...(args ? { args } : {}),
                        ...(env ? { env } : {}),
                    };
                } else if (type === 'sse') {
                    serverConfig = {
                        type: 'sse',
                        url: url || '',
                        ...(env ? { env } : {}),
                    };
                } else {
                    serverConfig = {
                        type: 'http',
                        url: url || '',
                        ...(env ? { env } : {}),
                    };
                }

                await agent.addMcpServer(name, serverConfig as any);

                return {
                    success: true,
                    message: `MCP server "${name}" added successfully (${type} transport)`,
                };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    success: false,
                    error: `Failed to add MCP server "${name}": ${errorMessage}`,
                };
            }
        },
    });
}
