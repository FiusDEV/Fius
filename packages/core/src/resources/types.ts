

import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';


export type ResourceSource = 'mcp' | 'internal';


export interface ResourceMetadata {
    
    uri: string;
    
    name?: string;
    
    description?: string;
    
    mimeType?: string;
    
    source: ResourceSource;
    
    serverName?: string;
    
    size?: number;
    
    lastModified?: string | Date;
    
    metadata?: Record<string, unknown>;
}


export interface ResourceProvider {
    
    listResources(): Promise<ResourceMetadata[]>;

    
    readResource(uri: string): Promise<ReadResourceResult>;

    
    hasResource(uri: string): Promise<boolean>;

    
    getSource(): ResourceSource;
}


export type ResourceSet = Record<string, ResourceMetadata>;
