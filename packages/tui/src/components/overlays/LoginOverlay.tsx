import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from 'react';
import { Box, Text } from 'ink';
import { execSync } from 'child_process';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import {
    type TuiDeviceApiKeyLoginResult,
    type TuiDeviceLoginPrompt as DeviceLoginPrompt,
    loadAuth,
    performDeviceCodeLogin,
    persistDeviceApiKeyLoginResult,
} from '../../host/index.js';

export type LoginOverlayOutcome =
    | {
          outcome: 'success';
          email?: string | undefined;
          keyId?: string | undefined;
          hasFiusApiKey: boolean;
      }
    | { outcome: 'cancelled' }
    | { outcome: 'closed' };

export interface LoginOverlayProps {
    isVisible: boolean;
    onDone: (outcome: LoginOverlayOutcome) => void;
}

export interface LoginOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

type LoginStep =
    | 'checking'
    | 'already-authenticated'
    | 'starting'
    | 'waiting'
    | 'finalizing'
    | 'error';

const LoginOverlay = forwardRef<LoginOverlayHandle, LoginOverlayProps>(function LoginOverlay(
    { isVisible, onDone },
    ref
) {
    const [step, setStep] = useState<LoginStep>('checking');
    const [existingUser, setExistingUser] = useState<string | null>(null);
    const [authUrl, setAuthUrl] = useState<string | null>(null);
    const [devicePrompt, setDevicePrompt] = useState<DeviceLoginPrompt | null>(null);
    const [status, setStatus] = useState<string>('Preparing login...');
    const [error, setError] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const isActiveRef = useRef(false);
    const onDoneRef = useRef(onDone);
    onDoneRef.current = onDone;

    const safeSetStatus = useCallback((message: string) => {
        if (!isActiveRef.current) return;
        setStatus(message);
    }, []);

    const cancelInFlight = useCallback(() => {
        abortControllerRef.current?.abort(new Error('Authentication cancelled'));
        abortControllerRef.current = null;
    }, []);

    const runDeviceLogin = useCallback(
        async (abortController: AbortController): Promise<TuiDeviceApiKeyLoginResult> => {
            setStep('starting');
            safeSetStatus('Starting device code login...');
            setAuthUrl(null);
            setDevicePrompt(null);

            return performDeviceCodeLogin({
                signal: abortController.signal,
                onPrompt: (prompt) => {
                    if (!isActiveRef.current || abortController.signal.aborted) {
                        return;
                    }
                    setDevicePrompt(prompt);
                    setAuthUrl(prompt.verificationUrlComplete ?? prompt.verificationUrl);
                    setStep('waiting');
                    safeSetStatus('Open the URL below and approve login.');

                    // Auto-open URL in browser
                    const url = prompt.verificationUrlComplete ?? prompt.verificationUrl;
                    try {
                        if (process.platform === 'win32') {
                            execSync(`start "" "${url}"`, { stdio: 'ignore' });
                        } else if (process.platform === 'darwin') {
                            execSync(`open "${url}"`, { stdio: 'ignore' });
                        } else {
                            execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
                        }
                    } catch {
                        // Ignore — user can open manually
                    }
                },
            });
        },
        [safeSetStatus]
    );

    const runDeviceLoginRef = useRef(runDeviceLogin);
    runDeviceLoginRef.current = runDeviceLogin;

    const doLogin = useCallback(async () => {
        cancelInFlight();
        setError(null);
        setAuthUrl(null);
        setDevicePrompt(null);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            const result = await runDeviceLoginRef.current(abortController);

            if (!result || !isActiveRef.current || abortController.signal.aborted) return;

            setStep('finalizing');
            safeSetStatus('Finalizing login...');

            const persisted = await persistDeviceApiKeyLoginResult(result);

            if (!isActiveRef.current || abortController.signal.aborted) return;
            onDoneRef.current({
                outcome: 'success',
                email: persisted.email,
                keyId: persisted.keyId,
                hasFiusApiKey: persisted.hasFiusApiKey,
            });
        } catch (err) {
            if (abortController.signal.aborted) {
                return;
            }

            setStep('error');
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage);
            safeSetStatus('Login failed');
        } finally {
            abortControllerRef.current = null;
        }
    }, [cancelInFlight, safeSetStatus]);

    const doLoginRef = useRef(doLogin);
    doLoginRef.current = doLogin;

    // Initialize when shown
    useEffect(() => {
        if (!isVisible) return;

        isActiveRef.current = true;
        setStep('checking');
        setExistingUser(null);
        setAuthUrl(null);
        setDevicePrompt(null);
        setStatus('Preparing login...');
        setError(null);

        void (async () => {
            try {
                const auth = await loadAuth();
                if (!isActiveRef.current) return;

                if (auth) {
                    setExistingUser(auth.email || auth.userId || 'user');
                    setStep('already-authenticated');
                    setStatus('You are already logged in');
                    return;
                }

                await doLoginRef.current();
            } catch (err) {
                if (!isActiveRef.current) return;
                setStep('error');
                setStatus('Error checking authentication state');
                setError(err instanceof Error ? err.message : String(err));
            }
        })();

        return () => {
            isActiveRef.current = false;
            cancelInFlight();
        };
    }, [cancelInFlight, isVisible]);

    useImperativeHandle(
        ref,
        () => ({
            handleInput: (_input: string, key: Key): boolean => {
                if (!isVisible) return false;

                if (key.escape) {
                    cancelInFlight();
                    onDone({ outcome: step === 'already-authenticated' ? 'closed' : 'cancelled' });
                    return true;
                }

                if (step === 'already-authenticated' && key.return) {
                    void doLoginRef.current();
                    return true;
                }

                if (step === 'error' && key.return) {
                    void doLoginRef.current();
                    return true;
                }

                return true;
            },
        }),
        [cancelInFlight, isVisible, onDone, step]
    );

    if (!isVisible) return null;

    const hint =
        step === 'already-authenticated'
            ? 'Enter to login again • Esc to close'
            : step === 'error'
              ? 'Enter to retry • Esc to close'
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
                    Login to Fius
                </Text>
            </Box>

            {existingUser && step === 'already-authenticated' && (
                <Box marginBottom={1}>
                    <Text color="green">✓ Already logged in as: {existingUser}</Text>
                </Box>
            )}

            <Box marginBottom={1}>
                <Text color="gray">Status: </Text>
                <Text>{status}</Text>
            </Box>

            {devicePrompt && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="gray">Open this URL on any device:</Text>
                    <Text color="yellowBright">
                        {devicePrompt.verificationUrlComplete ?? devicePrompt.verificationUrl}
                    </Text>
                    <Text color="gray">Code: {devicePrompt.userCode}</Text>
                </Box>
            )}

            {authUrl && !devicePrompt && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="gray">If your browser didn&apos;t open, use this URL:</Text>
                    <Text color="yellowBright">{authUrl}</Text>
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

export default LoginOverlay;
