

import type React from 'react';
import { useEffect, useRef } from 'react';
import { useInput, useApp } from 'ink';
import type { CLIAction } from '../state/actions.js';
import type { CLIState } from '../state/types.js';
import type { TuiAgentBackend } from '../agent-backend.js';

interface UseKeyboardShortcutsProps {
    state: CLIState;
    dispatch: React.Dispatch<CLIAction>;
    agent: TuiAgentBackend;
}


const EXIT_WARNING_TIMEOUT = 3000;


export function useKeyboardShortcuts({ state, dispatch, agent }: UseKeyboardShortcutsProps): void {
    const { exit } = useApp();

    // Use ref for session.id to avoid stale closures in async operations
    const sessionIdRef = useRef(state.session.id);
    useEffect(() => {
        sessionIdRef.current = state.session.id;
    }, [state.session.id]);

    // Auto-clear exit warning after timeout
    useEffect(() => {
        if (!state.ui.exitWarningShown || !state.ui.exitWarningTimestamp) return;

        const elapsed = Date.now() - state.ui.exitWarningTimestamp;
        const remaining = EXIT_WARNING_TIMEOUT - elapsed;

        if (remaining <= 0) {
            dispatch({ type: 'EXIT_WARNING_CLEAR' });
            return;
        }

        const timer = setTimeout(() => {
            dispatch({ type: 'EXIT_WARNING_CLEAR' });
        }, remaining);

        return () => clearTimeout(timer);
    }, [state.ui.exitWarningShown, state.ui.exitWarningTimestamp, dispatch]);

    useInput(
        (inputChar, key) => {
            // Don't intercept if approval prompt is active (it handles its own keys)
            if (state.approval) {
                return;
            }

            // Don't intercept if autocomplete/selector is active (they handle their own keys)
            if (state.ui.activeOverlay !== 'none' && state.ui.activeOverlay !== 'approval') {
                return;
            }

            // Ctrl+C: Exit only (with double-press safety)
            // Use Escape to cancel processing
            if (key.ctrl && inputChar === 'c') {
                if (state.ui.exitWarningShown) {
                    // Second Ctrl+C within timeout - actually exit
                    exit();
                } else {
                    // First Ctrl+C - show warning
                    dispatch({ type: 'EXIT_WARNING_SHOW' });
                }
                return;
            }

            // Escape: Cancel processing or close overlay
            if (key.escape) {
                // Clear exit warning if shown
                if (state.ui.exitWarningShown) {
                    dispatch({ type: 'EXIT_WARNING_CLEAR' });
                    return;
                }

                if (state.ui.isProcessing) {
                    const currentSessionId = sessionIdRef.current;
                    if (!currentSessionId) {
                        return;
                    }
                    void agent.cancel(currentSessionId).catch(() => {});
                    dispatch({ type: 'CANCEL_START' });
                } else if (state.ui.activeOverlay !== 'none') {
                    dispatch({ type: 'CLOSE_OVERLAY' });
                }
            }

            // Ctrl+B: Toggle Build/Plan mode
            if (key.ctrl && inputChar === 'b') {
                const newMode = state.ui.buildMode === 'build' ? 'plan' : 'build';
                dispatch({ type: 'SET_BUILD_MODE', payload: newMode });
            }
        },
        // Always active - we handle guards internally for more reliable behavior
        { isActive: true }
    );
}
