

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { StartupInfo } from '../../state/types.js';
import type { TuiAgentBackend } from '../../agent-backend.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';

const FIUS_ART = [
    '███████╗██╗██╗   ██╗███████╗     ██████╗██╗     ██╗',
    '██╔════╝██║██║   ██║██╔════╝    ██╔════╝██║     ██║',
    '█████╗  ██║██║   ██║███████╗    ██║     ██║     ██║',
    '██╔══╝  ██║██║   ██║╚════██║    ██║     ██║     ██║',
    '██║     ██║╚██████╔╝███████║    ╚██████╗███████╗██║',
    '╚═╝     ╚═╝ ╚═════╝ ╚══════╝     ╚═════╝╚══════╝╚═╝',
];

function ArtLine({ line }: { line: string }) {
    return (
        <Text>
            {line.split('').map((ch, i) => {
                const t = i / line.length;
                const r = Math.round(0 + (255 - 0) * t);
                const g = Math.round(190 + (0 - 190) * t);
                const b = 255;
                return (
                    <Text key={i} color={`rgb(${r},${g},${b})`}>
                        {ch}
                    </Text>
                );
            })}
        </Text>
    );
}

interface HeaderProps {
    modelName: string;
    sessionId?: string | undefined;
    hasActiveSession: boolean;
    startupInfo: StartupInfo;
    agent?: TuiAgentBackend;
    version?: string | null;
    email?: string | null;
    plan?: string | null;
    buildMode?: 'build' | 'plan';
}

export function Header({ modelName, sessionId, hasActiveSession, startupInfo, agent, version, email, plan, buildMode }: HeaderProps) {
    const { columns } = useTerminalSize();
    const [mcpCount, setMcpCount] = useState(startupInfo.connectedServers.count);
    const [toolCount, setToolCount] = useState(startupInfo.toolCount);
    const [skillCount, setSkillCount] = useState(0);
    const [pluginCount, setPluginCount] = useState(0);

    // Refresh MCP, tool, skill, and plugin counts periodically
    useEffect(() => {
        if (!agent) return;
        const interval = setInterval(async () => {
            try {
                const clients = agent.mcpManager.getClients();
                setMcpCount(clients.size);
                const tools = await agent.getAllTools();
                setToolCount(Object.keys(tools).length);
                if (agent.skillManager) {
                    const skills = await agent.skillManager.list();
                    setSkillCount(skills.length);
                }
                try {
                    const { listInstalledPlugins } = await import('@fius/agent-management');
                    const plugins = listInstalledPlugins();
                    setPluginCount(plugins.length);
                } catch {
                    // ignore
                }
            } catch {
                // ignore
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [agent]);

    if (!email) {
        return null;
    }

    return (
        <Box flexDirection="column" flexShrink={0} width={columns}>
            {FIUS_ART.map((line, i) => (
                <ArtLine key={i} line={line} />
            ))}

            <Box marginTop={1}>
                <Text color="gray">Logged in: </Text>
                <Text color="white">{email}</Text>
                {plan && (
                    <>
                        <Text color="gray"> (</Text>
                        <Text color={plan === 'free' ? 'gray' : 'cyan'} bold>
                            {plan.toUpperCase()}
                        </Text>
                        <Text color="gray">)</Text>
                    </>
                )}
            </Box>

            <Box flexDirection="row">
                <Text color="gray">Version: </Text>
                <Text color={version && version !== 'unknown' ? 'green' : 'gray'}>{version || '…'}</Text>
            </Box>

            <Box flexDirection="row">
                <Text color="gray">Model: </Text>
                <Text color={modelName ? 'white' : 'gray'}>{modelName || 'Not configured'}</Text>
                <Text color="gray"> • </Text>
                <Text color={buildMode === 'plan' ? 'yellow' : 'green'} bold>
                    {buildMode === 'plan' ? '◇ Plan' : '▶ Build'}
                </Text>
            </Box>

            {hasActiveSession && sessionId && (
                <Box flexDirection="row">
                    <Text color="gray">Session: </Text>
                    <Text color="white">{sessionId.slice(0, 8)}</Text>
                </Box>
            )}

            <Box flexDirection="row">
                <Text color="gray">MCP: </Text>
                <Text color="white">{mcpCount}</Text>
                <Text color="gray"> • Tools: </Text>
                <Text color="white">{toolCount}</Text>
                <Text color="gray"> • Skills: </Text>
                <Text color="white">{skillCount}</Text>
                <Text color="gray"> • Plugins: </Text>
                <Text color="white">{pluginCount}</Text>
            </Box>

            {startupInfo.failedConnections.length > 0 && (
                <Box flexDirection="row">
                    <Text color="yellowBright">
                        Warning: Failed: {startupInfo.failedConnections.join(', ')}
                    </Text>
                </Box>
            )}
        </Box>
    );
}
