

import { useState, useEffect, useRef } from 'react';

export interface ElapsedTimeOptions {
    
    isActive: boolean;
    
    intervalMs?: number;
}

export interface ElapsedTimeResult {
    
    elapsedMs: number;
    
    formatted: string;
}


function formatElapsedTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);

    if (seconds < 60) {
        return `${seconds}.${tenths}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
        return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}


export function useElapsedTime({
    isActive,
    intervalMs = 100,
}: ElapsedTimeOptions): ElapsedTimeResult {
    const [elapsedMs, setElapsedMs] = useState(0);
    const startTimeRef = useRef<number | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isActive) {
            // Start timing
            startTimeRef.current = Date.now();
            setElapsedMs(0);

            // Update elapsed time at regular intervals
            intervalRef.current = setInterval(() => {
                if (startTimeRef.current !== null) {
                    setElapsedMs(Date.now() - startTimeRef.current);
                }
            }, intervalMs);
        } else {
            // Stop timing
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            startTimeRef.current = null;
            setElapsedMs(0);
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [isActive, intervalMs]);

    return {
        elapsedMs,
        formatted: formatElapsedTime(elapsedMs),
    };
}
