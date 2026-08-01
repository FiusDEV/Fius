import type { Command } from 'commander';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';

export interface McpCommandRegisterContext {
    program: Command;
}

export function registerMcpCommand({ program }: McpCommandRegisterContext): void {


    program
        .command('mcp')
        .description(
            'Start Fius as an MCP server. Use --group-servers to aggregate and re-expose tools from configured MCP servers. \
        In the future, this command will expose the agent as an MCP server by default.'
        )
        .option('-s, --strict', 'Require all MCP server connections to succeed')
        .option(
            '--group-servers',
            'Aggregate and re-expose tools from configured MCP servers (required for now)'
        )
        .option('--name <n>', 'Name for the MCP server', 'fius-tools')
        .option('--version <version>', 'Version for the MCP server', '1.0.0')
        .action(
            withAnalytics(
                'mcp',
                async (options: {
                    strict?: boolean;
                    groupServers?: boolean;
                    name: string;
                    version: string;
                }) => {
                    try {

                        if (!options.groupServers) {
                            console.error(
                                'вќЊ The --group-servers flag is required. This command currently only supports aggregating and re-exposing tools from configured MCP servers.'
                            );
                            console.error('Usage: fius mcp --group-servers');
                            safeExit('mcp', 1, 'missing-group-servers');
                            return;
                        }

                        const [
                            { logger, ServersConfigSchema },
                            { resolveAgentPath, loadAgentConfig },
                        ] = await Promise.all([
                            import('@fiusdev/core'),
                            import('@fiusdev/agent-management'),
                        ]);



                        const globalOpts = program.opts();
                        const configPath = await resolveAgentPath(
                            globalOpts.agent,
                            globalOpts.autoInstall !== false
                        );

                        logger.info(`Loading Fius config from: ${configPath}`);
                        const config = await loadAgentConfig(configPath);

                        logger.info('Validating MCP servers...');

                        if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
                            console.error(
                                'вќЊ No MCP servers configured. Please configure mcpServers in your config file.'
                            );
                            safeExit('mcp', 1, 'no-mcp-servers');
                            return;
                        }

                        const validatedServers = ServersConfigSchema.parse(config.mcpServers);
                        logger.info(
                            `Validated MCP servers. Configured servers: ${Object.keys(validatedServers).join(', ')}`
                        );

                        const [{ createMcpTransport }, { initializeMcpToolAggregationServer }] =
                            await Promise.all([
                                import('@fiusdev/server'),
                                import('../../../api/mcp/tool-aggregation-handler.js'),
                            ]);


                        const currentLogPath = logger.getLogFilePath();
                        logger.info(
                            `MCP mode using log file: ${currentLogPath || 'default .fius location'}`
                        );

                        logger.info(
                            `Starting MCP tool aggregation server: ${options.name} v${options.version}`
                        );


                        const mcpTransport = await createMcpTransport('stdio');
                        const strictMode = options.strict ?? false;

                        await initializeMcpToolAggregationServer(
                            validatedServers,
                            mcpTransport,
                            options.name,
                            options.version,
                            strictMode
                        );

                        logger.info('MCP tool aggregation server started successfully');
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;

                        process.stderr.write(
                            `MCP tool aggregation server startup failed: ${err}\n`
                        );
                        safeExit('mcp', 1, 'mcp-agg-failed');
                    }
                },
                { timeoutMs: 0 }
            )
        );
}