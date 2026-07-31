

import React, { createContext, useContext, type ReactNode } from 'react';
import type { SoundNotificationService } from '../utils/soundNotification.js';

const SoundContext = createContext<SoundNotificationService | null>(null);

interface SoundProviderProps {
    soundService: SoundNotificationService | null;
    children: ReactNode;
}


export function SoundProvider({ soundService, children }: SoundProviderProps) {
    return <SoundContext.Provider value={soundService}>{children}</SoundContext.Provider>;
}


export function useSoundService(): SoundNotificationService | null {
    return useContext(SoundContext);
}
