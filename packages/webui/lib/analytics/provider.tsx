import React, { createContext, useContext, type ReactNode } from 'react';

interface AnalyticsContextType {
    capture: (event: string, properties?: unknown) => void;
    enabled: boolean;
    isReady: boolean;
}

const AnalyticsContext = createContext<AnalyticsContextType | undefined>(undefined);

interface AnalyticsProviderProps {
    children: ReactNode;
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
    const value: AnalyticsContextType = {
        capture: () => {},
        enabled: false,
        isReady: true,
    };

    return (
        <AnalyticsContext.Provider value={value}>
            {children}
        </AnalyticsContext.Provider>
    );
}

export function useAnalyticsContext(): AnalyticsContextType {
    const context = useContext(AnalyticsContext);
    if (!context) {
        throw new Error('useAnalyticsContext must be used within an AnalyticsProvider');
    }
    return context;
}
