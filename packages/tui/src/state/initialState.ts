

import type { CLIState } from './types.js';


export function createInitialState(initialModelName: string = ''): CLIState {
    return {
        input: {
            value: '',
            history: [],
            historyIndex: -1,
            draftBeforeHistory: '',
            images: [],
            pastedBlocks: [],
            pasteCounter: 0,
            editingQueuedFollowUp: false,
        },
        ui: {
            isProcessing: false,
            isCancelling: false,
            isThinking: false,
            isCompacting: false,
            activeOverlay: 'none',
            showReasoning: true,
            exitWarningShown: false,
            exitWarningTimestamp: null,
            mcpWizardServerType: null,
            copyModeEnabled: false,
            pendingModelSwitch: null,
            selectedMcpServer: null,
            historySearch: {
                isActive: false,
                query: '',
                matchIndex: 0,
                originalInput: '',
                lastMatch: '',
            },
            promptAddWizard: null,
            autoApproveEdits: false,
            bypassPermissions: false,
            buildMode: 'build',
            todoExpanded: true,
            backgroundTasksRunning: 0,
            backgroundTasksExpanded: false,
            backgroundTasks: [],
            chatgptRateLimitStatus: null,
            insufficientCredits: null,
            commandOutput: null,
        },
        session: {
            id: null,
            hasActiveSession: false,
            modelName: initialModelName,
        },
        approval: null,
        approvalQueue: [],
    };
}
