

import type { Message } from '../state/types.js';
import {
    createUserMessage,
    createSystemMessage,
    createErrorMessage,
    createToolMessage,
    createStreamingMessage,
} from '../utils/messageFormatting.js';


export class MessageService {
    
    createUserMessage(content: string): Message {
        return createUserMessage(content);
    }

    
    createSystemMessage(content: string): Message {
        return createSystemMessage(content);
    }

    
    createErrorMessage(error: Error | string): Message {
        return createErrorMessage(error);
    }

    
    createToolMessage(toolName: string): Message {
        return createToolMessage(toolName);
    }

    
    createStreamingMessage(): Message {
        return createStreamingMessage();
    }

    
    getVisibleMessages(messages: Message[], limit: number = 50): Message[] {
        if (limit <= 0) {
            return [];
        }
        return messages.slice(-limit);
    }
}
