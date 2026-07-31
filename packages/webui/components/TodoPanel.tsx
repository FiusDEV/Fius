'use client';

/**
 * TodoPanel Component (WebUI)
 * Displays agent's todo list with progress tracking
 * Supports collapsing to a compact progress bar
 */

import React, { useState } from 'react';
import { CheckCircle2, Circle, ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from './ui/card';
import { cn } from '@/lib/utils';
import { useTodoStore, type Todo } from '@/lib/stores/todoStore';

interface TodoPanelProps {
    sessionId: string;
}

const EMPTY_TODOS: Todo[] = [];

/**
 * Todo panel with collapsible view
 * Expanded: full task list. Collapsed: compact progress bar with count
 */
export function TodoPanel({ sessionId }: TodoPanelProps) {
    const [collapsed, setCollapsed] = useState(false);
    const todos = useTodoStore((state) => state.sessions.get(sessionId)?.todos) ?? EMPTY_TODOS;

    if (todos.length === 0) {
        return null;
    }

    const completedCount = todos.filter((t) => t.status === 'completed').length;
    const totalCount = todos.length;
    const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;

    if (collapsed) {
        return (
            <Card
                className="border-l-4 border-l-amber-500 dark:border-l-amber-600 border-t border-r border-b border-border bg-card/50 backdrop-blur-sm shadow-sm cursor-pointer hover:bg-card/80 transition-colors"
                onClick={() => setCollapsed(false)}
            >
                <div className="p-2.5 flex items-center gap-2.5">
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-semibold text-foreground tracking-tight shrink-0">
                        Todo
                    </span>
                    <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-amber-500 to-orange-500 dark:from-amber-600 dark:to-orange-600 transition-all duration-300"
                            style={{
                                width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
                            }}
                        />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0">
                        {completedCount}/{totalCount}
                        {inProgressCount > 0 && (
                            <span className="text-amber-500 dark:text-amber-400 ml-1">
                                ({inProgressCount} active)
                            </span>
                        )}
                    </span>
                </div>
            </Card>
        );
    }

    const visibleTodos = todos.slice(0, 10);
    const hasMore = todos.length > 10;

    return (
        <Card className="border-l-4 border-l-amber-500 dark:border-l-amber-600 border-t border-r border-b border-border bg-card/50 backdrop-blur-sm shadow-sm">
            <div className="p-3 space-y-2.5">
                {/* Header with progress + collapse toggle */}
                <div className="flex items-center justify-between border-b border-amber-200 dark:border-amber-900/50 pb-2">
                    <span className="text-sm font-semibold text-foreground tracking-tight">
                        Todo
                    </span>
                    <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 dark:from-amber-600 dark:to-orange-600 transition-all duration-300"
                                style={{
                                    width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
                                }}
                            />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground tabular-nums">
                            {completedCount}/{totalCount}
                        </span>
                        <button
                            onClick={() => setCollapsed(true)}
                            className="ml-1 p-1 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors cursor-pointer"
                            title="Collapse todo"
                        >
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </button>
                    </div>
                </div>

                {/* All tasks */}
                <div className="space-y-1.5">
                    {visibleTodos.map((todo) => {
                        const isInProgress = todo.status === 'in_progress';
                        const isCompleted = todo.status === 'completed';
                        return (
                            <div key={todo.id} className="flex items-start gap-2.5 group">
                                <div className="mt-0.5">
                                    {isCompleted ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
                                    ) : isInProgress ? (
                                        <div className="h-3.5 w-3.5 rounded-full border-2 border-amber-500 dark:border-amber-600 bg-amber-500/20 dark:bg-amber-600/20 flex items-center justify-center">
                                            <div className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-600" />
                                        </div>
                                    ) : (
                                        <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
                                    )}
                                </div>
                                <span
                                    className={cn(
                                        'text-sm leading-relaxed flex-1',
                                        isCompleted && 'line-through text-muted-foreground/60',
                                        isInProgress && 'text-foreground font-medium',
                                        !isCompleted && !isInProgress && 'text-muted-foreground'
                                    )}
                                >
                                    {isInProgress ? todo.activeForm : todo.content}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* More tasks indicator */}
                {hasMore && (
                    <div className="pt-1 border-t border-border/50">
                        <span className="text-xs text-muted-foreground/70 italic">
                            +{todos.length - 10} more todos...
                        </span>
                    </div>
                )}
            </div>
        </Card>
    );
}
