import type { ValidatedMcpServerConfig } from './schemas.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { ToolProvider } from '../tools/types.js';
import type {
    GetPromptResult,
    ReadResourceResult,
    Prompt,
} from '@modelcontextprotocol/sdk/types.js';
import type { EventEmitter } from 'events';

export interface McpAuthProvider extends OAuthClientProvider {
    waitForAuthorizationCode?: () => Promise<string>;
}

export type McpAuthProviderFactory = (
    serverName: string,
    config: ValidatedMcpServerConfig
) => McpAuthProvider | null | undefined;

export interface MCPResourceSummary {
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
}

export interface MCPResolvedResource {
    key: string;
    serverName: string;
    summary: MCPResourceSummary;
}


export type McpClient = ToolProvider &
    EventEmitter & {
        connect(config: ValidatedMcpServerConfig, serverName: string): Promise<Client>;
        disconnect(): Promise<void>;

        listPrompts(): Promise<Prompt[]>;
        getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;

        listResources(): Promise<MCPResourceSummary[]>;
        readResource(uri: string): Promise<ReadResourceResult>;

        getConnectedClient(): Promise<Client>;
    };
