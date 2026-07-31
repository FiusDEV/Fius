import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';


export interface PromptArgument {
    name: string;
    description?: string | undefined;
    required?: boolean | undefined;
}


export interface PromptDefinition {
    name: string;
    title?: string | undefined;
    description?: string | undefined;
    arguments?: PromptArgument[] | undefined;
    
    userInvocable?: boolean | undefined;
}


export interface PromptInfo extends PromptDefinition {
    source: 'mcp' | 'config' | 'custom';
    
    displayName?: string | undefined;
    
    commandName?: string | undefined;
    metadata?: Record<string, unknown>;
}


export type PromptSet = Record<string, PromptInfo>;


export interface PromptListResult {
    prompts: PromptInfo[];
    nextCursor?: string | undefined;
}


export interface ResolvedPromptResult {
    
    text: string;
    
    resources: string[];
}


export interface PromptProvider {
    
    getSource(): string;

    
    invalidateCache(): void;

    
    listPrompts(cursor?: string): Promise<PromptListResult>;

    
    getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;

    
    getPromptDefinition(name: string): Promise<PromptDefinition | null>;
}
