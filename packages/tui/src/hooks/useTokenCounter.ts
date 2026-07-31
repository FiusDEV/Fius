

import { useState, useEffect, useRef } from 'react';
import type { TuiAgentBackend } from '../agent-backend.js';

export interface TokenCounterOptions {
    
    agent: TuiAgentBackend;
    
    isActive: boolean;
}

export interface TokenCounterResult {
    
    totalActualTokens: number;
    
    currentSegmentEstimate: number;
    
    displayCount: number;
    
    includesEstimate: boolean;
    
    formatted: string;
}


function estimateTokens(charCount: number): number {
    return Math.ceil(charCount / 4);
}


function formatTokenCount(count: number, includesEstimate: boolean): string {
    if (count < 1000) return '';
    const prefix = includesEstimate ? '~' : '';
    const kValue = (count / 1000).toFixed(1);
    return `${prefix}${kValue}K tokens`;
}


export function useTokenCounter({ agent, isActive }: TokenCounterOptions): TokenCounterResult {
    // Input tokens from the most recent LLM response (replaced, not summed)
    const [lastInputTokens, setLastInputTokens] = useState(0);
    // Cumulative output tokens across all LLM responses in this turn
    const [cumulativeOutputTokens, setCumulativeOutputTokens] = useState(0);
    // Estimated tokens for current streaming segment (resets after each response)
    const [currentSegmentEstimate, setCurrentSegmentEstimate] = useState(0);
    // Character count for current segment (ref to avoid re-renders on each chunk)
    const currentCharCountRef = useRef(0);

    useEffect(() => {
        if (!isActive) {
            // Reset when turn ends (isActive becomes false)
            setLastInputTokens(0);
            setCumulativeOutputTokens(0);
            setCurrentSegmentEstimate(0);
            currentCharCountRef.current = 0;
            return;
        }

        const controller = new AbortController();
        const { signal } = controller;

        // Reset on new turn (isActive just became true)
        currentCharCountRef.current = 0;
        setLastInputTokens(0);
        setCumulativeOutputTokens(0);
        setCurrentSegmentEstimate(0);

        // Track streaming chunks - accumulate estimate for current segment
        agent.on(
            'llm:chunk',
            (payload) => {
                if (payload.chunkType === 'text') {
                    currentCharCountRef.current += payload.content.length;
                    const estimate = estimateTokens(currentCharCountRef.current);
                    // Avoid frequent re-renders for short responses where we don't show tokens anyway.
                    if (estimate >= 1000) {
                        setCurrentSegmentEstimate(estimate);
                    }
                }
            },
            { signal }
        );

        // On response: update input (replace), accumulate output, reset estimate
        agent.on(
            'llm:response',
            (payload) => {
                const usage = payload.tokenUsage;
                // Replace input tokens (most recent call's context)
                // Subtract cacheWriteTokens to exclude system prompt on first call
                const rawInputTokens = usage.inputTokens ?? 0;
                const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
                const inputTokens = Math.max(0, rawInputTokens - cacheWriteTokens);
                if (inputTokens > 0) {
                    setLastInputTokens(inputTokens);
                }
                // Accumulate output tokens (additive across calls)
                const outputTokens = usage.outputTokens ?? 0;
                if (outputTokens > 0) {
                    setCumulativeOutputTokens((prev) => prev + outputTokens);
                }
                // Reset current segment for next streaming segment
                currentCharCountRef.current = 0;
                setCurrentSegmentEstimate(0);
            },
            { signal }
        );

        // Note: No reset on llm:thinking - queued messages continue the same turn
        // Reset only happens when isActive transitions (new user-initiated turn)

        return () => {
            controller.abort();
        };
    }, [agent, isActive]);

    // Total = lastInput + cumulativeOutput (avoids double-counting shared context)
    const totalActualTokens = lastInputTokens + cumulativeOutputTokens;
    // Display = actual + current streaming estimate
    const displayCount = totalActualTokens + currentSegmentEstimate;
    const includesEstimate = currentSegmentEstimate > 0;

    return {
        totalActualTokens,
        currentSegmentEstimate,
        displayCount,
        includesEstimate,
        formatted: formatTokenCount(displayCount, includesEstimate),
    };
}
