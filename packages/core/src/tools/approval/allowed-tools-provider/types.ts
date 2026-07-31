
export type AllowedToolsProvider = {
    
    allowTool(toolName: string, sessionId?: string): Promise<void>;

    
    disallowTool(toolName: string, sessionId?: string): Promise<void>;

    
    isToolAllowed(toolName: string, sessionId?: string): Promise<boolean>;

    
    getAllowedTools?(sessionId?: string): Promise<Set<string>>;
};
