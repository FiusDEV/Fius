import { useCallback } from 'react';
import { useAnalyticsContext } from './provider.js';

export function useAnalytics() {
    const { capture } = useAnalyticsContext();

    const trackSessionCreated = useCallback(() => {}, []);
    const trackSessionSwitched = useCallback(() => {}, []);
    const trackSessionReset = useCallback(() => {}, []);
    const trackMessageSent = useCallback(() => {}, []);
    const trackToolCalled = useCallback(() => {}, []);
    const trackToolResult = useCallback(() => {}, []);
    const trackLLMSwitched = useCallback(() => {}, []);
    const trackFileAttached = useCallback(() => {}, []);
    const trackImageAttached = useCallback(() => {}, []);
    const trackFileRejected = useCallback(() => {}, []);
    const trackAgentSwitched = useCallback(() => {}, []);

    return {
        capture,
        enabled: false,
        isReady: true,
        trackSessionCreated,
        trackSessionSwitched,
        trackSessionReset,
        trackMessageSent,
        trackToolCalled,
        trackToolResult,
        trackLLMSwitched,
        trackFileAttached,
        trackImageAttached,
        trackFileRejected,
        trackAgentSwitched,
    };
}
