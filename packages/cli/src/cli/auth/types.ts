export interface AuthenticatedUser {
    id: string;
    email: string;
    name?: string | undefined;
}

export interface DeviceApiKeyLoginResult {
    fiusApiKey: string;
    fiusKeyId: string;
    fiusKeyDisplay: string;
    email?: string | undefined;
}