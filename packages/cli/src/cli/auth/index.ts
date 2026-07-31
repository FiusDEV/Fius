export {
    type AuthConfig,
    storeAuth,
    loadAuth,
    removeAuth,
    isAuthenticated,
    getAuthToken,
    getAuthTokenQuietly,
    getFiusApiKey,
    getAuthFilePath,
} from './service.js';

export { type OAuthResult } from './oauth.js';

export { type DeviceApiKeyLoginResult } from './types.js';
export { type DeviceLoginPrompt, performDeviceCodeLogin } from './device.js';

export {
    type PersistOAuthLoginOptions,
    type PersistedLoginResult,
    persistDeviceApiKeyLoginResult,
    persistOAuthLoginResult,
} from './login-persistence.js';

export { type UsageSummaryResponse, FiusApiClient, getFiusApiClient } from './api-client.js';

export { SUPABASE_URL, SUPABASE_ANON_KEY, FIUS_API_URL, FIUS_PLATFORM_URL } from './constants.js';

export {
    buildFiusBillingUrl,
    getBillingBalanceForCurrentLogin,
    createBillingCheckoutForCurrentLogin,
    openFiusBillingPage,
} from './billing.js';

export {
    type FiusApiKeyProvisionStatus,
    type FiusApiKeyProvisionStatusLevel,
    type EnsureFiusApiKeyOptions,
    ensureFiusApiKeyForAuthToken,
    saveFiusApiKeyToEnv,
    removeFiusApiKeyFromEnv,
} from './fius-api-key.js';