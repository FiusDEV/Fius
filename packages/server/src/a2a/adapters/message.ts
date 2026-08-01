import type { InternalMessage } from '@fiusdev/core';
import type { Message, Part, MessageRole, ConvertedMessage } from '../types.js';
import { randomUUID } from 'crypto';

export function a2aToInternalMessage(a2aMsg: Message): ConvertedMessage {
    let text = '';
    let image: ConvertedMessage['image'] | undefined;
    let file: ConvertedMessage['file'] | undefined;

    for (const part of a2aMsg.parts) {
        switch (part.kind) {
            case 'text':
                text += (text ? ' ' : '') + part.text;
                break;

            case 'file': {
                const fileData = part.file;
                const mimeType = fileData.mimeType || '';
                const isImage = mimeType.startsWith('image/');

                if (isImage && !image) {
                    const data = 'bytes' in fileData ? fileData.bytes : fileData.uri;
                    image = {
                        image: data,
                        mimeType: mimeType,
                    };
                } else if (!file) {
                    const data = 'bytes' in fileData ? fileData.bytes : fileData.uri;
                    const fileObj: { data: string; mimeType: string; filename?: string } = {
                        data: data,
                        mimeType: mimeType,
                    };
                    if (fileData.name) {
                        fileObj.filename = fileData.name;
                    }
                    file = fileObj;
                }
                break;
            }

            case 'data':
                text += (text ? '\n' : '') + JSON.stringify(part.data, null, 2);
                break;
        }
    }

    return { text, image, file };
}

export function internalToA2AMessage(
    msg: InternalMessage,
    taskId?: string,
    contextId?: string
): Message | null {
    if (msg.role === 'system') {
        return null;
    }

    const role: MessageRole = msg.role === 'user' ? 'user' : 'agent';

    const parts: Part[] = [];

    if (typeof msg.content === 'string') {
        if (msg.content) {
            parts.push({ kind: 'text', text: msg.content });
        }
    } else if (msg.content === null) {
    } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
            switch (part.type) {
                case 'text':
                    parts.push({ kind: 'text', text: part.text });
                    break;

                case 'image': {
                    const imageData = part.image;
                    const mimeType = (part as any).mimeType || '';
                    let fileObj: any;
                    if (
                        imageData instanceof URL ||
                        (typeof imageData === 'string' && imageData.startsWith('http'))
                    ) {
                        fileObj = {
                            uri: imageData.toString(),
                            mimeType,
                        };
                    } else if (Buffer.isBuffer(imageData)) {
                        fileObj = {
                            bytes: imageData.toString('base64'),
                            mimeType,
                        };
                    } else if (imageData instanceof Uint8Array) {
                        fileObj = {
                            bytes: Buffer.from(imageData).toString('base64'),
                            mimeType,
                        };
                    } else if (imageData instanceof ArrayBuffer) {
                        fileObj = {
                            bytes: Buffer.from(imageData).toString('base64'),
                            mimeType,
                        };
                    } else if (typeof imageData === 'string') {
                        fileObj = {
                            bytes: imageData,
                            mimeType,
                        };
                    }

                    if (fileObj) {
                        parts.push({
                            kind: 'file',
                            file: fileObj,
                        });
                    }
                    break;
                }

                case 'file': {
                    const fileData = part.data;
                    const mimeType = (part as any).mimeType || '';

                    let fileObj: any;
                    if (
                        fileData instanceof URL ||
                        (typeof fileData === 'string' && fileData.startsWith('http'))
                    ) {
                        fileObj = {
                            uri: fileData.toString(),
                            mimeType,
                        };
                    } else if (Buffer.isBuffer(fileData)) {
                        fileObj = {
                            bytes: fileData.toString('base64'),
                            mimeType,
                        };
                    } else if (fileData instanceof Uint8Array) {
                        fileObj = {
                            bytes: Buffer.from(fileData).toString('base64'),
                            mimeType,
                        };
                    } else if (fileData instanceof ArrayBuffer) {
                        fileObj = {
                            bytes: Buffer.from(fileData).toString('base64'),
                            mimeType,
                        };
                    } else if (typeof fileData === 'string') {
                        fileObj = {
                            bytes: fileData,
                            mimeType,
                        };
                    }

                    if (fileObj) {
                        if (part.filename) {
                            fileObj.name = part.filename;
                        }

                        parts.push({
                            kind: 'file',
                            file: fileObj,
                        });
                    }
                    break;
                }
            }
        }
    }

    if (parts.length === 0) {
        return null;
    }

    const message: Message = {
        role,
        parts,
        messageId: randomUUID(),
        kind: 'message',
    };

    if (taskId) message.taskId = taskId;
    if (contextId) message.contextId = contextId;

    return message;
}

export function internalMessagesToA2A(
    messages: InternalMessage[],
    taskId?: string,
    contextId?: string
): Message[] {
    const a2aMessages: Message[] = [];

    for (const msg of messages) {
        const a2aMsg = internalToA2AMessage(msg, taskId, contextId);
        if (a2aMsg !== null) {
            a2aMessages.push(a2aMsg);
        }
    }

    return a2aMessages;
}
