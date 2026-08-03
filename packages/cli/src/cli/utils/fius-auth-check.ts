import { isAuthenticated } from '../auth/index.js';

export interface FiusAuthCheckResult {
    shouldContinue: boolean;
    action?: 'login' | 'cancel';
}

export async function checkFiusAuthState(
    interactive: boolean = true,
    _agentId: string = 'fius'
): Promise<FiusAuthCheckResult> {
    const authenticated = await isAuthenticated();
    if (authenticated) {
        return { shouldContinue: true };
    }

    if (interactive) {
        return { shouldContinue: false, action: 'login' };
    }

    return { shouldContinue: false, action: 'cancel' };
}
