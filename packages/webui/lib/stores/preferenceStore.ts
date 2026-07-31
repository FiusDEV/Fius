import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getApiUrl } from '@/lib/api-url';

export interface PreferenceState {
    isStreaming: boolean;
    buildMode: 'build' | 'plan';
}

interface PreferenceStore extends PreferenceState {
    setStreaming: (enabled: boolean) => void;
    setBuildMode: (mode: 'build' | 'plan') => void;
}

const defaultState: PreferenceState = {
    isStreaming: false,
    buildMode: 'build',
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

            setBuildMode: (mode) => {
                set({ buildMode: mode });
                fetch(`${getApiUrl()}/api/llm/build-mode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ buildMode: mode }),
                }).catch(() => {});
            },
        }),
        {
            name: 'fius-preferences',
            version: 1,
        }
    )
);
