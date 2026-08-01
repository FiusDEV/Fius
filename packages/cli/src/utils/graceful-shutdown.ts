import { logger } from '@fiusdev/core';

interface ShutdownTarget {
    stop?: (() => Promise<void>) | undefined;
}

export interface GracefulShutdownOptions {
    /**
     * When true, the first SIGINT is ignored to let the application handle it
     * (e.g., for Ink CLI which needs to handle Ctrl+C for cancellation/exit warning).
     * A second SIGINT within the timeout will force exit.
     */
    inkMode?: boolean;
    /**
     * Timeout in ms before force exit in ink mode (default: 3000ms)
     */
    forceExitTimeout?: number;
}

export function registerGracefulShutdown(
    getCurrentAgent: () => ShutdownTarget,
    options: GracefulShutdownOptions = {}
): void {
    const { inkMode = false, forceExitTimeout = 3000 } = options;
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGUSR2'];

    if (!inkMode) {
        signals.push('SIGINT');
    }

    let isShuttingDown = false;

    const performShutdown = async (signal: string) => {
        if (isShuttingDown) {
            process.exit(0);
        }
        isShuttingDown = true;

        try {
            const agent = getCurrentAgent();
            if (typeof agent.stop === 'function') {
                await Promise.race([
                    agent.stop(),
                    new Promise((resolve) => setTimeout(resolve, 1000)),
                ]);
            }
        } catch {}
        process.exit(0);
    };

    signals.forEach((signal) => {
        process.on(signal, () => performShutdown(signal));
    });

    if (inkMode) {
        let firstSigintTime: number | null = null;

        process.on('SIGINT', () => {
            const now = Date.now();

            if (isShuttingDown) return;

            if (firstSigintTime === null) {
                firstSigintTime = now;

                setTimeout(() => {
                    if (
                        firstSigintTime !== null &&
                        Date.now() - firstSigintTime >= forceExitTimeout
                    ) {
                        firstSigintTime = null;
                    }
                }, forceExitTimeout);

                return;
            }

            if (now - firstSigintTime < forceExitTimeout) {
                void performShutdown('SIGINT (force)');
                firstSigintTime = now;
            }
        });
    }

    process.on('uncaughtException', async (error) => {
        logger.error(
            `Uncaught exception: ${error instanceof Error ? error.message : String(error)}`,
            { error },
            'red'
        );
        if (!isShuttingDown) {
            isShuttingDown = true;
            try {
                const agent = getCurrentAgent();
                if (typeof agent.stop === 'function') {
                    await agent.stop();
                }
            } catch (innerError) {
                logger.error(
                    `Error during shutdown initiated by uncaughtException: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
                    { error: innerError }
                );
            }
        }
        process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
        if (reason instanceof Error && reason.name === 'ExitSignal') return;
        logger.error(`Unhandled rejection: ${reason}`, { reason }, 'red');
        if (!isShuttingDown) {
            isShuttingDown = true;
            try {
                const agent = getCurrentAgent();
                if (typeof agent.stop === 'function') {
                    await agent.stop();
                }
            } catch (innerError) {
                logger.error(
                    `Error during shutdown initiated by unhandledRejection: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
                    { error: innerError }
                );
            }
        }
        process.exit(1);
    });
}
