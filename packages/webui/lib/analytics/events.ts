export interface BaseEventContext {
    app?: string;
    app_version?: string;
}

export type WebUIAnalyticsEventName = string;
export type WebUIAnalyticsEventPayload<Name extends WebUIAnalyticsEventName> = unknown;
