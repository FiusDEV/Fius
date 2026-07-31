import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';

export function registerAuthCommand({ program }: RuntimeCommandRegisterContext): void {
    const authCommand = program.command('auth').description('Manage authentication');

    authCommand
        .command('logout')
        .description('Logout from Fius')
        .option('--force', 'Skip confirmation prompt')
        .option('--no-interactive', 'Disable interactive prompts')
        .action(
            withAnalytics(
                'auth logout',
                async (options: { force?: boolean; interactive?: boolean }) => {
                    try {
                        const { handleLogoutCommand } = await import('./logout.js');
                        await handleLogoutCommand(options);
                        safeExit('auth logout', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`вќЊ auth logout command failed: ${err}`);
                        safeExit('auth logout', 1, 'error');
                    }
                }
            )
        );

    authCommand
        .command('status')
        .description('Show authentication status')
        .action(
            withAnalytics('auth status', async () => {
                try {
                    const { handleStatusCommand } = await import('./status.js');
                    await handleStatusCommand();
                    safeExit('auth status', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`вќЊ auth status command failed: ${err}`);
                    safeExit('auth status', 1, 'error');
                }
            })
        );

    program
        .command('logout')
        .description('Logout from Fius (alias for `fius auth logout`)')
        .option('--force', 'Skip confirmation prompt')
        .option('--no-interactive', 'Disable interactive prompts')
        .action(
            withAnalytics('logout', async (options: { force?: boolean; interactive?: boolean }) => {
                try {
                    const { handleLogoutCommand } = await import('./logout.js');
                    await handleLogoutCommand(options);
                    safeExit('logout', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`вќЊ logout command failed: ${err}`);
                    safeExit('logout', 1, 'error');
                }
            })
        );
}