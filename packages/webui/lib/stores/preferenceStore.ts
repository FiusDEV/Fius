import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getApiUrl } from '@/lib/api-url';

export interface PreferenceState {
    isStreaming: boolean;
}

interface PreferenceStore extends PreferenceState {
    setStreaming: (enabled: boolean) => void;
}

const defaultState: PreferenceState = {
    isStreaming: false,
};

export const usePreferenceStore = create<PreferenceStore>()(
    persist(
        (set) => ({
            ...defaultState,

            setStreaming: (enabled) => {
                set({ isStreaming: enabled });
                fetch(`${getApiUrl()}/api/llm/streaming`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled }),
                }).catch(() => {});
            },
        }),
        {
            name: 'fius-preferences',
            version: 1,
        }
    )
);
