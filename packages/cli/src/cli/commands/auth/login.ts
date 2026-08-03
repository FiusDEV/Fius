import chalk from 'chalk';
import * as p from '@clack/prompts';
import { execSync } from 'child_process';
import {
    getFiusApiClient,
    performDeviceCodeLogin,
    persistDeviceApiKeyLoginResult,
    persistOAuthLoginResult,
    storeAuth,
} from '../../auth/index.js';

export interface LoginCommandOptions {
    apiKey?: string;
    token?: string;
    platformUrl?: string | undefined;
    interactive?: boolean;
}

function isCancellationError(errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase();
    return (
        lower.includes('canceled') ||
        lower.includes('cancelled') ||
        lower.includes('user denied') ||
        lower.includes('user_denied') ||
        lower.includes('access_denied') ||
        lower.includes('access denied by user') ||
        lower.includes('device login was denied')
    );
}

export async function handleLoginCommand(options: LoginCommandOptions = {}): Promise<void> {
    try {
        if (options.apiKey && options.token) {
            throw new Error('Cannot use both --api-key and --token. Choose one.');
        }

        if (options.apiKey) {
            const client = getFiusApiClient();
            const isValid = await client.validateFiusApiKey(options.apiKey);
            if (!isValid) {
                throw new Error('Invalid API key provided - validation failed');
            }
            await storeAuth({
                fiusApiKey: options.apiKey,
                fiusApiKeySource: 'user-supplied',
                createdAt: Date.now(),
            });
            console.log(chalk.green('вњ… Fius API key saved'));
            return;
        }

        if (options.token) {
            const didLogin = await handleTokenLogin(options.token);
            if (!didLogin) {
                throw new Error('Login was cancelled.');
            }
            console.log(chalk.green('рџЋ‰ Login successful!'));
            return;
        }

        if (options.interactive === false) {
            await handleDeviceLogin(
                options.platformUrl ? { platformUrl: options.platformUrl } : {}
            );
            return;
        }

        const title = 'Login to Fius';
        const lineLen = 46;
        const pad = Math.max(0, Math.floor((lineLen - title.length) / 2));
        console.log(' '.repeat(pad) + chalk.bgWhite.black.bold(title));
        console.log();
        await handleDeviceLogin(options.platformUrl ? { platformUrl: options.platformUrl } : {});
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.outro(chalk.red(`вќЊ Login failed: ${errorMessage}`));
        throw error;
    }
}

export async function handleAutoLogin(): Promise<void> {
    await handleDeviceLogin();
}

export async function handleDeviceLogin(options: { platformUrl?: string } = {}): Promise<void> {
    const MAX_ATTEMPTS = 3;
    const TIMEOUT_SECONDS = 60;
    let firstAttempt = true;
    let countdownInterval: ReturnType<typeof setInterval> | null = null;
    let remaining = TIMEOUT_SECONDS;

    function updateCountdown() {
        if (remaining <= 0) {
            if (countdownInterval) clearInterval(countdownInterval);
            return;
        }
        remaining--;
        process.stdout.write(`\r${' '.repeat(60)}\r`);
        process.stdout.write(chalk.white(`  Attempt ${currentAttempt}/${MAX_ATTEMPTS} | Timeout: ${remaining}s`));
    }

    let currentAttempt = 1;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            currentAttempt = attempt;
            remaining = TIMEOUT_SECONDS;

            const result = await performDeviceCodeLogin({
                ...(options.platformUrl ? { apiUrl: options.platformUrl } : {}),
                timeoutSeconds: TIMEOUT_SECONDS,
                attempt,
                maxAttempts: MAX_ATTEMPTS,
                onPrompt: (prompt) => {
                    const url = prompt.verificationUrlComplete || prompt.verificationUrl;

                    if (firstAttempt) {
                        firstAttempt = false;
                        console.log(chalk.cyan('\nOpen the link below in your browser to log in:'));
                        console.log(chalk.white(`  ${url}`));

                        try {
                            if (process.platform === 'win32') {
                                execSync(`start "" "${url}"`, { stdio: 'ignore' });
                            } else if (process.platform === 'darwin') {
                                execSync(`open "${url}"`, { stdio: 'ignore' });
                            } else {
                                execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
                            }
                        } catch {

                        }
                    } else {

                        process.stdout.write(`\r${' '.repeat(60)}\r`);
                    }


                    if (countdownInterval) clearInterval(countdownInterval);
                    process.stdout.write(chalk.white(`  Attempt ${attempt}/${MAX_ATTEMPTS} | Timeout: ${remaining}s`));
                    countdownInterval = setInterval(updateCountdown, 1000);
                },
            });

            if (countdownInterval) clearInterval(countdownInterval);
            process.stdout.write(`\r${' '.repeat(60)}\r`);
            await persistDeviceApiKeyLoginResult(result);
            return;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            if (isCancellationError(errorMessage)) {
                throw new Error('Login was cancelled.');
            }

            if (attempt < MAX_ATTEMPTS) {
                continue;
            }
        }
    }

    console.log(chalk.red('\n\n  Login timed out. Restart Fius CLI to try again.'));
    process.exit(1);
}

async function handleTokenLogin(tokenInput?: string): Promise<boolean> {
    let token = tokenInput?.trim();
    if (!token) {
        const promptedToken = await p.password({
            message: 'Enter your API token:',
            validate: (value) => {
                if (!value) return 'Token is required';
                if (value.length < 10) return 'Token seems too short';
                return undefined;
            },
        });

        if (p.isCancel(promptedToken)) {
            return false;
        }

        token = promptedToken as string;
    }
    if (token.length < 10) {
        throw new Error('Token seems too short');
    }

    const spinner = p.spinner();
    spinner.start('Verifying token...');

    try {
        const apiClient = getFiusApiClient();
        const user = await apiClient.fetchSupabaseUser(token);
        if (!user) {
            spinner.stop('Invalid token');
            throw new Error('Token verification failed');
        }

        spinner.stop('Token verified!');

        await persistOAuthLoginResult({
            accessToken: token,
            user,
        });
        return true;
    } catch (error) {
        spinner.stop('Verification failed');
        throw error;
    }
}