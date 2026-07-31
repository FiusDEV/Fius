

import type React from 'react';
import { useInput } from 'ink';
import type { CLIAction } from '../state/actions.js';
import type { InputState } from '../state/types.js';

interface UseInputHistoryProps {
    inputState: InputState;
    dispatch: React.Dispatch<CLIAction>;
    isActive: boolean;
}


export function useInputHistory({ inputState, dispatch, isActive }: UseInputHistoryProps): void {
    useInput(
        (inputChar, key) => {
            if (!isActive || inputState.history.length === 0) return;

            if (key.upArrow) {
                dispatch({
                    type: 'INPUT_HISTORY_NAVIGATE',
                    direction: 'up',
                });
            } else if (key.downArrow) {
                dispatch({
                    type: 'INPUT_HISTORY_NAVIGATE',
                    direction: 'down',
                });
            }
        },
        { isActive }
    );
}
