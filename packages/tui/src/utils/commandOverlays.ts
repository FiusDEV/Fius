

import type { OverlayType } from '../state/types.js';
import { isCommandSupported, type TuiAgentBackend } from '../agent-backend.js';


const ALWAYS_OVERLAY: Record<string, OverlayType> = {
    search: 'search',
    find: 'search', // alias
    login: 'login',
    logout: 'logout',
    models: 'model-selector',
    providers: 'providers-selector',
    sessions: 'session-selector',
    switch: 'session-selector',
    stream: 'stream-selector',
    access: 'access-mode-selector',
    mode: 'build-mode-selector',
    tools: 'tool-browser',
    mcp: 'mcp-server-list',
    rename: 'session-rename',
    context: 'context-stats',
    ctx: 'context-stats', // alias
    export: 'export-wizard',
    plugin: 'plugin-manager',
    skills: 'skills-list',
};


const NO_ARGS_OVERLAY: Record<string, OverlayType> = {
    session: 'session-subcommand-selector',
    prompts: 'prompt-list',
};


export function getCommandOverlay(
    command: string,
    args: string[],
    agent: TuiAgentBackend
): OverlayType | null {
    if (!isCommandSupported(agent, command)) {
        return null;
    }

    // Commands that always show overlay
    const alwaysOverlay = ALWAYS_OVERLAY[command];
    if (alwaysOverlay) return alwaysOverlay;

    // Commands that show overlay only when no args
    if (args.length === 0) {
        const noArgsOverlay = NO_ARGS_OVERLAY[command];
        if (noArgsOverlay) return noArgsOverlay;
    }

    return null;
}


export function isInteractiveCommand(command: string): boolean {
    return command in ALWAYS_OVERLAY || command in NO_ARGS_OVERLAY;
}
