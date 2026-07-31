import type { InternalMessage } from '../context/types.js';


export interface SearchOptions {
    
    sessionId?: string;
    
    role?: 'user' | 'assistant' | 'system' | 'tool';
    
    limit?: number;
    
    offset?: number;
}


export interface SearchResult {
    
    sessionId: string;
    
    message: InternalMessage;
    
    matchedText: string;
    
    context: string;
    
    messageIndex: number;
}


export interface SessionSearchResult {
    
    sessionId: string;
    
    matchCount: number;
    
    firstMatch: SearchResult;
    
    metadata: {
        createdAt: number;
        lastActivity: number;
        messageCount: number;
    };
}


export interface SearchResponse {
    
    results: SearchResult[];
    
    total: number;
    
    hasMore: boolean;
    
    query: string;
    
    options: SearchOptions;
}


export interface SessionSearchResponse {
    
    results: SessionSearchResult[];
    
    total: number;
    
    hasMore: boolean;
    
    query: string;
}
