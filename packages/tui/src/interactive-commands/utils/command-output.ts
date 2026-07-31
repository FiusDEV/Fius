

import { formatForInkCli } from './format-output.js';
import type { StyledOutput } from '../../services/CommandService.js';
import type { StyledMessageType, StyledData } from '../../state/types.js';


export class CommandOutputHelper {
    
    static success(message: string): string {
        return formatForInkCli(message);
    }

    
    static info(message: string): string {
        return formatForInkCli(message);
    }

    
    static warning(message: string): string {
        return formatForInkCli(`⚠ ${message}`);
    }

    
    static error(error: unknown, context?: string): string {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const fullMessage = context ? `⚠ ${context}: ${errorMessage}` : `⚠ ${errorMessage}`;
        return formatForInkCli(fullMessage);
    }

    
    static output(lines: string[]): string {
        return formatForInkCli(lines.join('\n'));
    }

    
    static styled(
        styledType: StyledMessageType,
        styledData: StyledData,
        fallbackText: string
    ): StyledOutput {
        return {
            styledType,
            styledData,
            fallbackText: formatForInkCli(fallbackText),
        };
    }
}
