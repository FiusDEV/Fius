import chalk from 'chalk';
import { loadAuth } from '../../auth/index.js';

export async function handleStatusCommand(): Promise<void> {
    const auth = await loadAuth();

    if (!auth) {
        console.log(chalk.yellow('вќЊ Not logged in'));
        console.log(chalk.dim('Run `fius login` to authenticate'));
        return;
    }

    console.log(chalk.green('вњ… Logged in'));

    if (auth.email) {
        console.log(chalk.dim(`Email: ${auth.email}`));
    }

    if (auth.userId) {
        console.log(chalk.dim(`User ID: ${auth.userId}`));
    }

    if (auth.expiresAt) {
        const expiresDate = new Date(auth.expiresAt);
        console.log(chalk.dim(`Expires: ${expiresDate.toLocaleDateString()}`));
    }
}