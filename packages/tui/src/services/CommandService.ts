

import { parseInput } from '../utils/inputParsing.js';
import { executeCommand } from '../interactive-commands/commands.js';
import type { CommandResult } from '../interactive-commands/command-parser.js';
import type { StyledMessageType, StyledData } from '../state/types.js';
import type { TuiAgentBackend } from '../agent-backend.js';


export interface StyledOutput {
    styledType: StyledMessageType;
    styledData: StyledData;
    fallbackText: string; // Plain text fallback for logging/history
}


export interface CommandExecutionResult {
    type: 'handled' | 'output' | 'styled' | 'sendMessage';
    output?: string;
    styled?: StyledOutput;
    
    messageToSend?: string;
}


export function isStyledOutput(result: unknown): result is StyledOutput {
    return (
        typeof result === 'object' &&
        result !== null &&
        'styledType' in result &&
        'styledData' in result &&
        'fallbackText' in result
    );
}


export interface SendMessageMarker {
    __sendMessage: true;
    text: string;
}


export function createSendMessageMarker(text: string): SendMessageMarker {
    return { __sendMessage: true, text };
}


export function isSendMessageMarker(result: unknown): result is SendMessageMarker {
    return (
        typeof result === 'object' &&
        result !== null &&
        '__sendMessage' in result &&
        (result as SendMessageMarker).__sendMessage === true &&
        'text' in result &&
        typeof (result as SendMessageMarker).text === 'string'
    );
}


export class CommandService {
    
    parseInput(input: string): CommandResult {
        return parseInput(input);
    }

    
    async executeCommand(
        command: string,
        args: string[],
        agent: TuiAgentBackend,
        sessionId?: string,
        configFilePath?: string | null
    ): Promise<CommandExecutionResult> {
        const result = await executeCommand(command, args, agent, sessionId, configFilePath);

        // If result is a send message marker, return the text to send through normal flow
        if (isSendMessageMarker(result)) {
            return { type: 'sendMessage' as const, messageToSend: result.text };
        }

        // If result is a string, it's output for display
        if (typeof result === 'string') {
            return { type: 'output', output: result };
        }

        // If result is a styled output object
        if (isStyledOutput(result)) {
            return { type: 'styled', styled: result };
        }

        // If result is boolean, command was handled
        return { type: 'handled' };
    }
}
