

import { useState, useEffect } from 'react';
import {
    isStreamingEnabledAsync,
    subscribeToStreaming,
    setStreamingEnabled,
    toggleStreaming,
} from '../state/streaming-state.js';

export interface UseStreamingResult {
    
    streaming: boolean;
    
    setStreaming: (enabled: boolean) => void;
    
    toggleStreaming: () => void;
}


export function useStreaming(): UseStreamingResult {
    const [streaming, setStreamingState] = useState(false);

    // Load persisted state on mount
    useEffect(() => {
        void isStreamingEnabledAsync().then(setStreamingState);
    }, []);

    useEffect(() => {
        // Subscribe to changes from command or other sources
        const unsubscribe = subscribeToStreaming((enabled) => {
            setStreamingState(enabled);
        });

        return unsubscribe;
    }, []);

    return {
        streaming,
        setStreaming: (enabled: boolean) => {
            void setStreamingEnabled(enabled);
        },
        toggleStreaming: () => {
            void toggleStreaming();
        },
    };
}
