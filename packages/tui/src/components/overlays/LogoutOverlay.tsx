import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import {
    loadAuth,
    removeAuth,
    removeFiusApiKeyFromEnv,
    isUsingFiusCredits,
} from '../../host/index.js';

export type LogoutOverlayOutcome =
    | { outcome: 'success'; wasUsingFiusCredits: boolean }
    | { outcome: 'cancelled' }
    | { outcome: 'closed' };

export interface LogoutOverlayProps {
    isVisible: boolean;
    onDone: (outcome: LogoutOverlayOutcome) => void;
}

export interface LogoutOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

type LogoutStep = 'checking' | 'not-authenticated' | 'confirm' | 'logging-out' | 'error';

const LogoutOverlay = forwardRef<LogoutOverlayHandle, LogoutOverlayProps>(function LogoutOverlay(
    { isVisible, onDone },
    ref
) {
    const [step, setStep] = useState<LogoutStep>('checking');
    const [userLabel, setUserLabel] = useState<string | null>(null);
    const [usingFiusCredits, setUsingFiusCredits] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const provisionedApiKeyRef = useRef<string | null>(null);

    const performLogout = useCallback(async () => {
        setError(null);
        setStep('logging-out');

        try {
            const auth = await loadAuth();
            if (auth?.fiusApiKey && auth.fiusApiKeySource === 'provisioned') {
                provisionedApiKeyRef.current = auth.fiusApiKey;
            }

            await removeAuth();

            if (provisionedApiKeyRef.current) {
                await removeFiusApiKeyFromEnv({ expectedValue: provisionedApiKeyRef.current });
            }

            onDone({ outcome: 'success', wasUsingFiusCredits: usingFiusCredits });
        } catch (err) {
            setStep('error');
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [onDone, usingFiusCredits]);

    useEffect(() => {
        if (!isVisible) return;
        let cancelled = false;
        provisionedApiKeyRef.current = null;

        setStep('checking');
        setUserLabel(null);
        setUsingFiusCredits(false);
        setError(null);

        void (async () => {
            try {
                const auth = await loadAuth();
                if (cancelled) return;
                if (!auth) {
                    setStep('not-authenticated');
                    return;
                }

                setUserLabel(auth.email || auth.userId || 'user');
            } catch {
                if (!cancelled) {
                    setStep('error');
                    setError('Failed to load authentication state');
                }
                return;
            }

            try {
                const isUsing = await isUsingFiusCredits();
                if (!cancelled) setUsingFiusCredits(isUsing);
            } catch {
                // Non-fatal: default to no warning
            }

            if (!cancelled) setStep('confirm');
        })();

        return () => {
            cancelled = true;
        };
    }, [isVisible]);

    useImperativeHandle(
        ref,
        () => ({
            handleInput: (_input: string, key: Key): boolean => {
                if (!isVisible) return false;

                if (key.escape) {
                    if (step === 'logging-out') return true;
                    onDone({ outcome: step === 'not-authenticated' ? 'closed' : 'cancelled' });
                    return true;
                }

                if (key.return) {
                    if (step === 'confirm' || step === 'error') {
                        void performLogout();
                        return true;
                    }
                }

                return true;
            },
        }),
        [isVisible, onDone, performLogout, step]
    );

    if (!isVisible) return null;

    const hint =
        step === 'confirm'
            ? 'Enter to logout • Esc to cancel'
            : step === 'not-authenticated'
              ? 'Esc to close'
              : step === 'error'
                ? 'Enter to retry • Esc to cancel'
                : 'Esc to cancel';

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
            marginTop={1}
        >
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Logout
                </Text>
            </Box>

            {step === 'not-authenticated' ? (
                <Box marginBottom={1}>
                    <Text color="yellow"> Not currently logged in</Text>
                </Box>
            ) : (
                <Box marginBottom={1}>
                    <Text color="gray">Account: </Text>
                    <Text>{userLabel ?? '...'}</Text>
                </Box>
            )}

            {usingFiusCredits && step !== 'not-authenticated' && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="yellow">
                        ⚠ You are configured to use Fius credits (provider: Fius).
                    </Text>
                    <Text color="gray" dimColor>
                        After logout, you will need to run `/login` to authenticate again, or `fius
                        setup` to configure a different provider.
                    </Text>
                </Box>
            )}

            {step === 'logging-out' && (
                <Box marginBottom={1}>
                    <Text color="gray">Logging out...</Text>
                </Box>
            )}

            {error && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="red">Error: {error}</Text>
                </Box>
            )}

            <Box>
                <Text color="gray" dimColor>
                    {hint}
                </Text>
            </Box>
        </Box>
    );
});

export default LogoutOverlay;
