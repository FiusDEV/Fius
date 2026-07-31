

import { promises as fs } from 'fs';
import * as path from 'path';
import { getFiusGlobalPath } from '../utils/path.js';
import { ServersConfigSchema, type ValidatedServersConfig } from './schemas.js';

const MCP_DIR = 'mcp';
const SERVERS_FILE = 'servers.json';

function getMcpServersPath(): string {
    return getFiusGlobalPath(MCP_DIR, SERVERS_FILE);
}


export async function loadPersistedMcpServers(): Promise<ValidatedServersConfig> {
    const filePath = getMcpServersPath();
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        return ServersConfigSchema.parse(parsed);
    } catch {
        return ServersConfigSchema.parse({});
    }
}


export async function savePersistedMcpServers(servers: ValidatedServersConfig): Promise<void> {
    const filePath = getMcpServersPath();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(servers, null, 2), 'utf-8');
}


export async function addPersistedMcpServer(
    name: string,
    config: ValidatedServersConfig[string]
): Promise<void> {
    const servers = await loadPersistedMcpServers();
    servers[name] = config;
    await savePersistedMcpServers(servers);
}


export async function removePersistedMcpServer(name: string): Promise<void> {
    const servers = await loadPersistedMcpServers();
    delete servers[name];
    await savePersistedMcpServers(servers);
}
