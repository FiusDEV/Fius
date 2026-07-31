import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    isAuthenticated,
    loadAuth,
    removeAuth,
    removeFiusApiKeyFromEnv,
} from '../../auth/index.js';
import { clearUserInfoCache } from '../../utils/user-info-cache.js';
import { logger } from '@fius/core';

export async function handleLogoutCommand(
    options: {
        force?: boolean;
        interactive?: boolean;
    } = {}
): Promise<void> {
    try {
        if (!(await isAuthenticated())) {
            console.log(chalk.yellow('в„№пёЏ  Not currently logged in'));
            return;
        }

        if (options.interactive !== false && !options.force) {
            p.intro(chalk.inverse(' Logout '));

            const shouldLogout = await p.confirm({
                message: 'Are you sure you want to logout?',
                initialValue: false,
            });

            if (p.isCancel(shouldLogout) || !shouldLogout) {
                p.cancel('Logout cancelled');
                return;
            }
        }

        let provisionedApiKey: string | null = null;
        const auth = await loadAuth();
        if (auth?.fiusApiKey && auth.fiusApiKeySource === 'provisioned') {
            provisionedApiKey = auth.fiusApiKey;
        }

        let removeAuthError: unknown;
        try {
            await removeAuth();
            await clearUserInfoCache();
        } catch (error) {
            removeAuthError = error;
        }

        if (provisionedApiKey) {
            try {
                await removeFiusApiKeyFromEnv({ expectedValue: provisionedApiKey });
            } catch (cleanupError) {
                if (!removeAuthError) {
                    throw cleanupError;
                }
            }
        }

        if (removeAuthError) {
            throw removeAuthError;
        }

        if (options.interactive !== false && !options.force) {
            p.outro(chalk.green('вњ“ Logged out successfully'));
            console.log(
                chalk.dim('   Run `fius login` to log back in, or `fius setup` to configure a provider.')
            );
        } else {
            console.log(chalk.green('вњ“ Logged out successfully'));
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Logout failed', { error: errorMessage });
        if (options.interactive !== false) {
            p.outro(chalk.red(`вќЊ Logout failed: ${errorMessage}`));
        } else {
            console.error(chalk.red(`вќЊ Logout failed: ${errorMessage}`));
        }
    }
}