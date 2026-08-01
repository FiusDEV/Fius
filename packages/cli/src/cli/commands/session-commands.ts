import chalk from 'chalk';
import { logger, FiusAgent, type SessionMetadata } from '@fiusdev/core';
import { formatSessionInfo, formatHistoryMessage } from './helpers/formatters.js';

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getMostRecentSessionInfo(
    agent: FiusAgent
): Promise<{ id: string; metadata: SessionMetadata | undefined } | null> {
    const sessionIds = await agent.listSessions();
    if (sessionIds.length === 0) {
        return null;
    }


    let mostRecentId: string | null = null;
    let mostRecentActivity = 0;

    for (const sessionId of sessionIds) {
        const metadata = await agent.getSessionMetadata(sessionId);
        if (metadata && metadata.lastActivity > mostRecentActivity) {
            mostRecentActivity = metadata.lastActivity;
            mostRecentId = sessionId;
        }
    }

    if (!mostRecentId) {
        return null;
    }

    const metadata = await agent.getSessionMetadata(mostRecentId);
    return { id: mostRecentId, metadata };
}

async function displaySessionHistory(sessionId: string, agent: FiusAgent): Promise<void> {
    console.log(chalk.blue(`\nрџ’¬ Session History for: ${chalk.bold(sessionId)}\n`));

    const history = await agent.getSessionHistory(sessionId);

    if (history.length === 0) {
        console.log(chalk.gray('  No messages in this session yet.\n'));
        return;
    }


    history.forEach((message, index) => {
        console.log(formatHistoryMessage(message, index));
    });

    console.log(chalk.gray(`\n  Total: ${history.length} messages`));
}

export async function handleSessionListCommand(agent: FiusAgent): Promise<void> {
    try {
        console.log(chalk.bold.blue('\nрџ“‹ Sessions:\n'));

        const sessionIds = await agent.listSessions();
        const mostRecent = await getMostRecentSessionInfo(agent);

        if (sessionIds.length === 0) {
            console.log(
                chalk.gray(
                    '  No sessions found. Run `fius` to start a new session, or use `fius -c`/`fius -r <id>`.\n'
                )
            );
            return;
        }


        const entries = await Promise.all(
            sessionIds.map(async (id) => {
                try {
                    const metadata = await agent.getSessionMetadata(id);
                    return { id, metadata };
                } catch (e) {
                    logger.error(
                        `Failed to fetch metadata for session ${id}: ${e instanceof Error ? e.message : String(e)}`,
                        null,
                        'red'
                    );
                    return { id, metadata: undefined as SessionMetadata | undefined };
                }
            })
        );

        let displayed = 0;
        for (const { id, metadata } of entries) {
            if (!metadata) continue;

            const isMostRecent = mostRecent ? id === mostRecent.id : false;
            console.log(`  ${formatSessionInfo(id, metadata, isMostRecent)}`);
            displayed++;
        }

        console.log(chalk.gray(`\n  Total: ${displayed} of ${sessionIds.length} sessions`));
        console.log(chalk.gray('  рџ’Ў Use `fius -r <id>` to resume a session\n'));
    } catch (error) {
        logger.error(
            `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
            null,
            'red'
        );
        throw error;
    }
}

export async function handleSessionHistoryCommand(
    agent: FiusAgent,
    sessionId?: string
): Promise<void> {
    try {

        let targetSessionId = sessionId;
        if (!targetSessionId) {
            const recentSession = await getMostRecentSessionInfo(agent);
            if (!recentSession) {
                console.log(chalk.red('вќЊ No sessions found'));
                console.log(chalk.gray('   Create a session first by running: fius'));
                throw new Error('No sessions found');
            }
            targetSessionId = recentSession.id;
            console.log(chalk.gray(`Using most recent session: ${targetSessionId}\n`));
        }

        await displaySessionHistory(targetSessionId, agent);
    } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
            console.log(chalk.red(`вќЊ Session not found: ${sessionId || 'current'}`));
            console.log(chalk.gray('   Use `fius session list` to see available sessions'));
        } else if (error instanceof Error && error.message !== 'No sessions found') {
            logger.error(`Failed to get session history: ${error.message}`, null, 'red');
        }
        throw error;
    }
}

export async function handleSessionDeleteCommand(
    agent: FiusAgent,
    sessionId: string
): Promise<void> {
    try {


        await agent.deleteSession(sessionId);
        console.log(chalk.green(`вњ… Deleted session: ${chalk.bold(sessionId)}`));
    } catch (error) {
        logger.error(
            `Failed to delete session: ${error instanceof Error ? error.message : String(error)}`,
            null,
            'red'
        );
        throw error;
    }
}

export async function handleSessionSearchCommand(
    agent: FiusAgent,
    query: string,
    options: {
        sessionId?: string;
        role?: 'user' | 'assistant' | 'system' | 'tool';
        limit?: number;
    } = {}
): Promise<void> {
    try {
        const searchOptions: {
            limit: number;
            sessionId?: string;
            role?: 'user' | 'assistant' | 'system' | 'tool';
        } = {
            limit: options.limit || 10,
        };

        if (options.sessionId) {
            searchOptions.sessionId = options.sessionId;
        }
        if (options.role) {
            const allowed = new Set(['user', 'assistant', 'system', 'tool']);
            if (!allowed.has(options.role)) {
                console.log(
                    chalk.red(
                        `вќЊ Invalid role: ${options.role}. Use one of: user, assistant, system, tool`
                    )
                );
                return;
            }
            searchOptions.role = options.role;
        }

        console.log(chalk.blue(`рџ”Ќ Searching for: "${query}"`));
        if (searchOptions.sessionId) {
            console.log(chalk.gray(`   Session: ${searchOptions.sessionId}`));
        }
        if (searchOptions.role) {
            console.log(chalk.gray(`   Role: ${searchOptions.role}`));
        }
        console.log(chalk.gray(`   Limit: ${searchOptions.limit}`));
        console.log();

        const results = await agent.searchMessages(query, searchOptions);

        if (results.results.length === 0) {
            console.log(chalk.rgb(255, 165, 0)('рџ“­ No messages found matching your search'));
            return;
        }

        console.log(
            chalk.green(`вњ… Found ${results.total} result${results.total === 1 ? '' : 's'}`)
        );
        if (results.hasMore) {
            console.log(chalk.gray(`   Showing first ${results.results.length} results`));
        }
        console.log();


        const highlightRegex = query.trim()
            ? new RegExp(`(${escapeRegExp(query.trim().slice(0, 256))})`, 'gi')
            : null;


        results.results.forEach((result, index) => {
            const roleColor =
                result.message.role === 'user'
                    ? chalk.blue
                    : result.message.role === 'assistant'
                      ? chalk.green
                      : chalk.rgb(255, 165, 0);

            console.log(
                `${chalk.gray(`${index + 1}.`)} ${chalk.cyan(result.sessionId)} ${roleColor(`[${result.message.role}]`)}`
            );


            const highlightedContext = highlightRegex
                ? result.context.replace(highlightRegex, chalk.inverse('$1'))
                : result.context;

            console.log(`   ${highlightedContext}`);
            console.log();
        });

        if (results.hasMore) {
            console.log(chalk.gray('рџ’Ў Use --limit to see more results'));
        }
    } catch (error) {
        logger.error(
            `Search failed: ${error instanceof Error ? error.message : String(error)}`,
            null,
            'red'
        );
        throw error;
    }
}