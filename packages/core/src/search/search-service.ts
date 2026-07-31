import type { Logger } from '../logger/v2/types.js';
import { FiusLogComponent } from '../logger/v2/types.js';
import type { ConversationStore } from '../storage/conversation/types.js';
import type { SessionStore } from '../storage/sessions/types.js';
import type { InternalMessage } from '../context/types.js';
import type {
    SearchOptions,
    SearchResult,
    SessionSearchResult,
    SearchResponse,
    SessionSearchResponse,
} from './types.js';


export class SearchService {
    private logger: Logger;

    constructor(
        private conversationStore: ConversationStore,
        private sessionStore: SessionStore,
        logger: Logger
    ) {
        this.logger = logger.createChild(FiusLogComponent.SESSION);
    }

    
    async searchMessages(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
        const { sessionId, role, limit = 20, offset = 0 } = options;

        if (!query.trim()) {
            return {
                results: [],
                total: 0,
                hasMore: false,
                query,
                options,
            };
        }

        try {
            this.logger.debug(`Searching messages for query: "${query}"`, {
                sessionId,
                role,
                limit,
                offset,
            });

            const allResults: SearchResult[] = [];
            const sessionIds = sessionId ? [sessionId] : await this.getSessionIds();

            for (const sId of sessionIds) {
                const sessionResults = await this.searchInSession(query, sId, role);
                allResults.push(...sessionResults);
            }

            const sortedResults = this.sortResults(allResults, query);

            const total = sortedResults.length;
            const paginatedResults = sortedResults.slice(offset, offset + limit);
            const hasMore = offset + limit < total;

            return {
                results: paginatedResults,
                total,
                hasMore,
                query,
                options,
            };
        } catch (error) {
            this.logger.error(
                `Error searching messages: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
                results: [],
                total: 0,
                hasMore: false,
                query,
                options,
            };
        }
    }

    
    async searchSessions(query: string): Promise<SessionSearchResponse> {
        if (!query.trim()) {
            return {
                results: [],
                total: 0,
                hasMore: false,
                query,
            };
        }

        try {
            this.logger.debug(`Searching sessions for query: "${query}"`);

            const sessionResults: SessionSearchResult[] = [];
            const sessionIds = await this.getSessionIds();

            for (const sessionId of sessionIds) {
                const messageResults = await this.searchInSession(query, sessionId);

                if (messageResults.length > 0) {
                    const sessionMetadata = await this.getSessionMetadata(sessionId);
                    if (sessionMetadata) {
                        const firstMatch = messageResults[0];
                        if (firstMatch) {
                            sessionResults.push({
                                sessionId,
                                matchCount: messageResults.length,
                                firstMatch,
                                metadata: sessionMetadata,
                            });
                        }
                    }
                }
            }

            const sortedResults = sessionResults.sort((a, b) => {
                if (a.matchCount !== b.matchCount) {
                    return b.matchCount - a.matchCount;
                }
                return b.metadata.lastActivity - a.metadata.lastActivity;
            });

            return {
                results: sortedResults,
                total: sortedResults.length,
                hasMore: false,
                query,
            };
        } catch (error) {
            this.logger.error(
                `Error searching sessions: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
                results: [],
                total: 0,
                hasMore: false,
                query,
            };
        }
    }

    
    private async searchInSession(
        query: string,
        sessionId: string,
        role?: string
    ): Promise<SearchResult[]> {
        const messages = await this.conversationStore.listMessages({ sessionId });

        const results: SearchResult[] = [];
        const lowerQuery = query.toLowerCase();

        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (!message) {
                continue;
            }

            if (role && message.role !== role) {
                continue;
            }

            const searchableText = this.extractSearchableText(message);
            if (!searchableText) {
                continue;
            }

            const lowerText = searchableText.toLowerCase();
            const matchIndex = lowerText.indexOf(lowerQuery);

            if (matchIndex !== -1) {
                const matchedText = searchableText.substring(matchIndex, matchIndex + query.length);
                const context = this.getContext(searchableText, matchIndex, query.length);

                results.push({
                    sessionId,
                    message,
                    matchedText,
                    context,
                    messageIndex: i,
                });
            }
        }

        return results;
    }

    
    private extractSearchableText(message: InternalMessage): string | null {
        if (!message.content) {
            return null;
        }

        if (typeof message.content === 'string') {
            return message.content;
        }

        if (Array.isArray(message.content)) {
            return message.content
                .filter((part) => part.type === 'text')
                .map((part) => ('text' in part ? part.text : ''))
                .join(' ');
        }

        return null;
    }

    
    private getContext(
        text: string,
        matchIndex: number,
        matchLength: number,
        contextLength = 50
    ): string {
        const start = Math.max(0, matchIndex - contextLength);
        const end = Math.min(text.length, matchIndex + matchLength + contextLength);

        let context = text.substring(start, end);

        if (start > 0) {
            context = '...' + context;
        }
        if (end < text.length) {
            context = context + '...';
        }

        return context;
    }

    
    private sortResults(results: SearchResult[], query: string): SearchResult[] {
        const lowerQuery = query.toLowerCase();

        return results.sort((a, b) => {
            const aText = this.extractSearchableText(a.message)?.toLowerCase() || '';
            const bText = this.extractSearchableText(b.message)?.toLowerCase() || '';

            const aExactMatch =
                aText.includes(` ${lowerQuery} `) ||
                aText.startsWith(lowerQuery) ||
                aText.endsWith(lowerQuery);
            const bExactMatch =
                bText.includes(` ${lowerQuery} `) ||
                bText.startsWith(lowerQuery) ||
                bText.endsWith(lowerQuery);

            if (aExactMatch && !bExactMatch) return -1;
            if (!aExactMatch && bExactMatch) return 1;

            return b.messageIndex - a.messageIndex;
        });
    }

    
    private async getSessionIds(): Promise<string[]> {
        return await this.sessionStore.listSessionIds();
    }

    
    private async getSessionMetadata(sessionId: string): Promise<{
        createdAt: number;
        lastActivity: number;
        messageCount: number;
    }> {
        const sessionData = await this.sessionStore.getSession({ sessionId });

        if (!sessionData) {
            throw new Error(`Session metadata not found: ${sessionId}`);
        }
        return sessionData;
    }
}
