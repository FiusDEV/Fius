

import React, { useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import type { ContentPart, ImagePart, TextPart, QueuedMessage } from '@fius/core';
import { InputArea, type OverlayTrigger } from '../components/input/InputArea.js';
import { InputService, processStream } from '../services/index.js';
import { useSoundService } from '../contexts/index.js';
import type {
    Message,
    UIState,
    InputState,
    SessionState,
    PendingImage,
    PastedBlock,
    TodoItem,
} from '../state/types.js';
import { createUserMessage } from '../utils/messageFormatting.js';
import { generateMessageId } from '../utils/idGenerator.js';
import { restoreQueuedContentForComposer } from '../utils/queuedComposerContent.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import { captureAnalytics } from '../host/index.js';
import { getOverlayPresentation } from '../utils/overlayPresentation.js';
import {
    supportsAttachments,
    supportsResources,
    type TuiAgentBackend,
} from '../agent-backend.js';


type SessionCreationResult = { id: string };


export interface InputContainerHandle {
    
    submit: (text: string) => Promise<void>;
}

interface InputContainerProps {
    
    buffer: TextBuffer;
    input: InputState;
    ui: UIState;
    session: SessionState;
    
    initialPrompt?: string | undefined;
    approval: ApprovalRequest | null;
    
    steerMessages: QueuedMessage[];
    
    queuedMessages: QueuedMessage[];
    setInput: React.Dispatch<React.SetStateAction<InputState>>;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    setSession: React.Dispatch<React.SetStateAction<SessionState>>;
    
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    
    setPendingMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    
    setDequeuedBuffer: React.Dispatch<React.SetStateAction<Message[]>>;
    
    setSteerMessages: React.Dispatch<React.SetStateAction<QueuedMessage[]>>;
    
    setQueuedMessages: React.Dispatch<React.SetStateAction<QueuedMessage[]>>;
    
    setApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
    
    setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
    
    setTodos: React.Dispatch<React.SetStateAction<TodoItem[]>>;
    agent: TuiAgentBackend;
    inputService: InputService;
    
    configFilePath: string | null;
    
    onKeyboardScroll?: (direction: 'up' | 'down') => void;
    
    useStreaming?: boolean;
}


export const InputContainer = forwardRef<InputContainerHandle, InputContainerProps>(
    function InputContainer(
        {
            buffer,
            input,
            ui,
            session,
            initialPrompt,
            approval,
            steerMessages,
            queuedMessages,
            setInput,
            setUi,
            setSession,
            setMessages,
            setPendingMessages,
            setDequeuedBuffer,
            setSteerMessages,
            setQueuedMessages,
            setApproval,
            setApprovalQueue,
            setTodos,
            agent,
            inputService,
            configFilePath,
            onKeyboardScroll,
            useStreaming = true,
        },
        ref
    ) {
        // Track pending session creation to prevent race conditions
        const sessionCreationPromiseRef = useRef<Promise<SessionCreationResult> | null>(null);
        const queuedEditPendingRef = useRef(false);
        const [isQueuedEditPending, setIsQueuedEditPending] = React.useState(false);

        const didAutoSubmitInitialPromptRef = useRef(false);

        // Sound notification service from context
        const soundService = useSoundService();

        // Ref to track autoApproveEdits so processStream can read latest value mid-stream
        const autoApproveEditsRef = useRef(ui.autoApproveEdits);
        useEffect(() => {
            autoApproveEditsRef.current = ui.autoApproveEdits;
        }, [ui.autoApproveEdits]);

        // Ref to track bypassPermissions so processStream can read latest value mid-stream
        const bypassPermissionsRef = useRef(ui.bypassPermissions);
        useEffect(() => {
            bypassPermissionsRef.current = ui.bypassPermissions;
        }, [ui.bypassPermissions]);

        // Clear the session creation ref when session is cleared
        useEffect(() => {
            if (session.id === null) {
                sessionCreationPromiseRef.current = null;
            }
        }, [session.id]);

        const popQueuedMessageForEdit = useCallback(
            async (
                message: QueuedMessage,
                editingQueuedFollowUp: boolean,
                removeMessage: () => Promise<boolean>
            ): Promise<void> => {
                if (queuedEditPendingRef.current) {
                    return;
                }

                const result = restoreQueuedContentForComposer(message);
                if (!result.ok) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: result.reason,
                            timestamp: new Date(),
                        },
                    ]);
                    return;
                }

                queuedEditPendingRef.current = true;
                setIsQueuedEditPending(true);
                let removed = false;
                try {
                    removed = await removeMessage();

                    if (!removed) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content:
                                    'Queued input could not be edited because it is no longer pending.',
                                timestamp: new Date(),
                            },
                        ]);
                        return;
                    }

                    buffer.setText(result.composer.text);
                    setInput((prev) => ({
                        ...prev,
                        value: result.composer.text,
                        images: result.composer.images,
                        pastedBlocks: [],
                        historyIndex: -1,
                        draftBeforeHistory: '',
                        editingQueuedFollowUp,
                    }));
                } catch {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: 'Queued input could not be edited. Try again.',
                            timestamp: new Date(),
                        },
                    ]);
                } finally {
                    queuedEditPendingRef.current = false;
                    setIsQueuedEditPending(false);
                }
            },
            [buffer, setInput, setMessages]
        );

        // Handle history navigation - set text directly on buffer
        // Up arrow first edits queued follow-ups (removes from follow-up queue), then navigates history
        const handleHistoryNavigate = useCallback(
            (direction: 'up' | 'down') => {
                const { history, historyIndex, draftBeforeHistory } = input;

                if (direction === 'up') {
                    // First check if there are queued follow-ups to edit
                    if (queuedMessages.length > 0 && session.id) {
                        const sessionId = session.id;
                        // Get the last queued message
                        const lastQueued = queuedMessages[queuedMessages.length - 1];
                        if (lastQueued) {
                            void popQueuedMessageForEdit(lastQueued, true, () =>
                                agent.removeFollowUpMessage(sessionId, lastQueued.id)
                            );
                            return;
                        }
                    }

                    // Don't navigate history when processing (only queue editing is allowed)
                    if (ui.isProcessing) return;

                    // No queued messages, navigate history
                    if (history.length === 0) return;

                    let newIndex = historyIndex;
                    if (newIndex < 0) {
                        // First time pressing up - save current input as draft
                        const currentText = buffer.text;
                        setInput((prev) => ({
                            ...prev,
                            draftBeforeHistory: currentText,
                            historyIndex: history.length - 1,
                            value: history[history.length - 1] || '',
                            editingQueuedFollowUp: false,
                        }));
                        buffer.setText(history[history.length - 1] || '');
                        return;
                    } else if (newIndex > 0) {
                        newIndex = newIndex - 1;
                    } else {
                        return; // Already at oldest
                    }

                    const historyItem = history[newIndex] || '';
                    buffer.setText(historyItem);
                    setInput((prev) => ({
                        ...prev,
                        value: historyItem,
                        historyIndex: newIndex,
                        editingQueuedFollowUp: false,
                    }));
                } else {
                    // Down - navigate history (queued messages don't affect down navigation)
                    // Don't navigate history when processing
                    if (ui.isProcessing) return;
                    if (historyIndex < 0) return; // Not navigating history
                    if (historyIndex < history.length - 1) {
                        const newIndex = historyIndex + 1;
                        const historyItem = history[newIndex] || '';
                        buffer.setText(historyItem);
                        setInput((prev) => ({
                            ...prev,
                            value: historyItem,
                            historyIndex: newIndex,
                            editingQueuedFollowUp: false,
                        }));
                    } else {
                        // At newest history item, restore draft
                        buffer.setText(draftBeforeHistory);
                        setInput((prev) => ({
                            ...prev,
                            value: draftBeforeHistory,
                            historyIndex: -1,
                            draftBeforeHistory: '',
                            editingQueuedFollowUp: false,
                        }));
                    }
                }
            },
            [
                buffer,
                input,
                setInput,
                queuedMessages,
                session.id,
                agent,
                popQueuedMessageForEdit,
                ui.isProcessing,
            ]
        );

        const handleCurrentTurnEdit = useCallback((): boolean => {
            if (steerMessages.length === 0 || !session.id) {
                return false;
            }

            const lastSteer = steerMessages[steerMessages.length - 1];
            if (!lastSteer) {
                return false;
            }

            const sessionId = session.id;
            void popQueuedMessageForEdit(lastSteer, false, () =>
                agent.removeSteerMessage(sessionId, lastSteer.id)
            );
            return true;
        }, [agent, popQueuedMessageForEdit, session.id, steerMessages]);

        // Handle overlay triggers
        // Allow triggers while processing (for queuing), but not during approval
        // IMPORTANT: Use functional updates to check prev.activeOverlay, not the closure value.
        // This avoids race conditions when open/close happen in quick succession (React batching).
        const handleTriggerOverlay = useCallback(
            (trigger: OverlayTrigger) => {
                if (approval) return;

                if (trigger === 'close') {
                    // Use functional update to check the ACTUAL current state, not stale closure
                    setUi((prev) => {
                        if (
                            prev.activeOverlay === 'slash-autocomplete' ||
                            prev.activeOverlay === 'resource-autocomplete'
                        ) {
                            return {
                                ...prev,
                                activeOverlay: 'none',
                                mcpWizardServerType: null,
                            };
                        }
                        return prev;
                    });
                } else if (trigger === 'slash-autocomplete') {
                    setUi((prev) => ({ ...prev, activeOverlay: 'slash-autocomplete' }));
                } else if (trigger === 'resource-autocomplete') {
                    if (!supportsResources(agent)) {
                        return;
                    }
                    setUi((prev) => ({ ...prev, activeOverlay: 'resource-autocomplete' }));
                }
            },
            [setUi, approval, agent]
        );

        const handleCycleReasoningVariant = useCallback(() => {
            if (ui.isProcessing) return;

            const sessionId = session.id || undefined;
            // Use global config (no session override) — session overrides strip API keys
            const current = agent.getCurrentLLMConfig(undefined);
            const currentProvider = current.provider;
            const currentModel = current.model;
            const currentBaseURL = current.baseURL;

            void (async () => {
                try {
                    // Get platform-supported models for this provider
                    const supportedModels = agent.getSupportedModels();
                    const platformModels = (supportedModels[currentProvider] || []).map((m) => ({
                        name: m.name,
                        displayName: m.displayName || m.name,
                    }));

                    // Get custom models for this provider
                    // For openai-compatible/litellm: match by baseURL (since provider is always "openai-compatible")
                    // For named providers: match by displayProvider
                    const { loadCustomModels } = await import('@fius/agent-management');
                    const allCustomModels = await loadCustomModels().catch(() => []);
                    const isGenericProvider = currentProvider === 'openai-compatible' || currentProvider === 'litellm';
                    const customModels = allCustomModels
                        .filter((cm) => {
                            if (isGenericProvider && currentBaseURL) {
                                return cm.baseURL === currentBaseURL;
                            }
                            return cm.displayProvider === currentProvider;
                        })
                        .map((cm) => ({
                            name: cm.name,
                            displayName: cm.displayName || cm.name,
                        }));

                    // Merge, deduplicate by name
                    const modelMap = new Map<string, { name: string; displayName: string }>();
                    for (const m of [...platformModels, ...customModels]) {
                        if (!modelMap.has(m.name)) {
                            modelMap.set(m.name, m);
                        }
                    }
                    const allModels = Array.from(modelMap.values());

                    if (allModels.length <= 1) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `ⓘ Only one model available for ${isGenericProvider ? (currentBaseURL || currentProvider) : currentProvider}.`,
                                timestamp: new Date(),
                            },
                        ]);
                        return;
                    }

                    // Find current model index and cycle to next
                    const currentIdx = allModels.findIndex((m) => m.name === currentModel);
                    const nextIdx = (currentIdx + 1) % allModels.length;
                    const nextModel = allModels[nextIdx];

                    if (!nextModel) return;

                    // Check if next model has a custom apiKey/baseURL
                    const customMatch = allCustomModels.find(
                        (cm) => {
                            if (cm.name !== nextModel.name) return false;
                            if (isGenericProvider && currentBaseURL) {
                                return cm.baseURL === currentBaseURL;
                            }
                            return cm.displayProvider === currentProvider;
                        }
                    );

                    await agent.switchLLM(
                        {
                            provider: currentProvider,
                            model: nextModel.name,
                            ...(customMatch?.baseURL ? { baseURL: customMatch.baseURL } : {}),
                            ...(customMatch?.apiKey ? { apiKey: customMatch.apiKey } : {}),
                        }
                    );

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Switched to ${nextModel.displayName}`,
                            timestamp: new Date(),
                        },
                    ]);

                    setSession((prev) => ({
                        ...prev,
                        modelName: nextModel.displayName,
                    }));
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `✗ Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            })();
        }, [agent, session.id, setMessages, setSession, ui.isProcessing]);

        // Handle image paste from clipboard
        const handleImagePaste = useCallback(
            (image: PendingImage) => {
                // Track image attachment analytics (only if session exists)
                if (session.id) {
                    captureAnalytics('fius_image_attached', {
                        source: 'cli',
                        sessionId: session.id,
                        imageType: image.mimeType,
                        imageSizeBytes: Math.floor(image.data.length * 0.75), // Approx base64 decode
                    });
                }

                setInput((prev) => ({
                    ...prev,
                    images: [...prev.images, image],
                }));
            },
            [setInput, session.id]
        );

        // Handle image removal (when placeholder is deleted from text)
        const handleImageRemove = useCallback(
            (imageId: string) => {
                setInput((prev) => ({
                    ...prev,
                    images: prev.images.filter((img) => img.id !== imageId),
                }));
            },
            [setInput]
        );

        // Handle new paste block creation (when large text is pasted)
        const handlePasteBlock = useCallback(
            (block: PastedBlock) => {
                setInput((prev) => ({
                    ...prev,
                    pastedBlocks: [...prev.pastedBlocks, block],
                    pasteCounter: Math.max(prev.pasteCounter, block.number),
                }));
            },
            [setInput]
        );

        // Handle paste block update (e.g., toggle collapse)
        const handlePasteBlockUpdate = useCallback(
            (blockId: string, updates: Partial<PastedBlock>) => {
                setInput((prev) => ({
                    ...prev,
                    pastedBlocks: prev.pastedBlocks.map((block) =>
                        block.id === blockId ? { ...block, ...updates } : block
                    ),
                }));
            },
            [setInput]
        );

        // Handle paste block removal (when placeholder is deleted from text)
        const handlePasteBlockRemove = useCallback(
            (blockId: string) => {
                setInput((prev) => ({
                    ...prev,
                    pastedBlocks: prev.pastedBlocks.filter((block) => block.id !== blockId),
                }));
            },
            [setInput]
        );

        // Expand all collapsed paste blocks in a text string
        const expandPasteBlocks = useCallback((text: string, blocks: PastedBlock[]): string => {
            let result = text;
            // Sort blocks by placeholder position descending to avoid offset issues
            const sortedBlocks = [...blocks].sort((a, b) => {
                const posA = result.indexOf(a.placeholder);
                const posB = result.indexOf(b.placeholder);
                return posB - posA;
            });

            for (const block of sortedBlocks) {
                if (block.isCollapsed) {
                    // Replace placeholder with full text
                    result = result.replace(block.placeholder, block.fullText);
                }
            }
            return result;
        }, []);

        // Handle submission
        // bypassOverlayCheck: skip the overlay check when called programmatically (e.g., from OverlayContainer)
        // queueAsFollowUp: while processing, queue this as the next turn instead of steering this turn.
        const handleSubmit = useCallback(
            async (value: string, bypassOverlayCheck = false, queueAsFollowUp = false) => {
                // Expand all collapsed paste blocks before processing
                const expandedValue = expandPasteBlocks(value, input.pastedBlocks);
                const trimmed = expandedValue.trim();
                if (!trimmed) return;

                // Active run input: Enter steers the current turn, Ctrl+Enter queues a follow-up.
                if (ui.isProcessing && session.id) {
                    const content: ContentPart[] = [{ type: 'text', text: trimmed } as TextPart];
                    // Add images if any
                    for (const img of input.images) {
                        content.push({
                            type: 'image',
                            image: img.data,
                            mimeType: img.mimeType,
                        } as ImagePart);
                    }

                    const submitAsFollowUp = queueAsFollowUp || input.editingQueuedFollowUp;

                    try {
                        if (submitAsFollowUp) {
                            await agent.followUp(session.id, { content });
                        } else {
                            await agent.steer(session.id, { content });
                        }

                        // Clear input, update history, and clear images
                        buffer.setText('');
                        setInput((prev) => {
                            const newHistory =
                                prev.history.length > 0 &&
                                prev.history[prev.history.length - 1] === trimmed
                                    ? prev.history
                                    : [...prev.history, trimmed].slice(-100);
                            return {
                                ...prev,
                                value: '',
                                history: newHistory,
                                historyIndex: -1,
                                draftBeforeHistory: '',
                                editingQueuedFollowUp: false,
                                images: [],
                                pastedBlocks: [],
                            };
                        });
                    } catch (error) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('error'),
                                role: 'system',
                                content: `Failed to submit ${submitAsFollowUp ? 'follow-up' : 'steer'} message: ${error instanceof Error ? error.message : String(error)}`,
                                timestamp: new Date(),
                            },
                        ]);
                    }
                    return;
                }

                // Prevent double submission when autocomplete/selector is active
                // Skip this check when called programmatically (e.g., from OverlayContainer prompt selection)
                if (
                    !bypassOverlayCheck &&
                    ui.activeOverlay !== 'none' &&
                    ui.activeOverlay !== 'approval'
                ) {
                    return;
                }

                // Capture images before clearing - we need them for the API call
                const pendingImages = [...input.images];

                // Create user message and add it to messages
                const userMessage = createUserMessage(trimmed);
                setMessages((prev) => [...prev, userMessage]);

                // Clear input directly on buffer and update history
                buffer.setText('');
                setInput((prev) => {
                    const newHistory =
                        prev.history.length > 0 && prev.history[prev.history.length - 1] === trimmed
                            ? prev.history
                            : [...prev.history, trimmed].slice(-100);
                    return {
                        value: '',
                        history: newHistory,
                        historyIndex: -1,
                        draftBeforeHistory: '',
                        editingQueuedFollowUp: false,
                        images: [], // Clear images on submit
                        pastedBlocks: [], // Clear paste blocks on submit
                        pasteCounter: prev.pasteCounter, // Keep counter for next session
                    };
                });

                // Start processing
                setUi((prev) => ({
                    ...prev,
                    isProcessing: true,
                    isCancelling: false,
                    activeOverlay: 'none',
                    commandOutput: null,
                    exitWarningShown: false,
                    exitWarningTimestamp: null,
                }));

                // Handle ! shell prefix directly (bypass command system)
                if (trimmed.startsWith('!')) {
                    const shellCmd = trimmed.slice(1).trim();
                    if (shellCmd) {
                        const { spawn } = await import('child_process');
                        const output = await new Promise<string>((resolve) => {
                            const isWin = process.platform === 'win32';
                            let cmd: string;
                            let args: string[];
                            if (isWin) {
                                const psScript = `$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${shellCmd}`;
                                cmd = 'powershell.exe';
                                args = ['-NoProfile', '-NonInteractive', '-Command', psScript];
                            } else {
                                cmd = 'bash';
                                args = ['-c', shellCmd];
                            }
                            const child = spawn(cmd, args, {
                                cwd: process.cwd(),
                                stdio: ['ignore', 'pipe', 'pipe'],
                                timeout: 30000,
                            });
                            let stdout = '';
                            let stderr = '';
                            child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });
                            child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });
                            child.on('close', () => resolve(stdout + (stderr ? '\n' + stderr : '')));
                            child.on('error', (e: Error) => resolve(e.message));
                        });
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: output.trim() || '(no output)',
                                timestamp: new Date(),
                            },
                        ]);
                        buffer.setText('');
                        setInput((prev) => ({ ...prev, historyIndex: -1 }));
                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            isCancelling: false,
                            isThinking: false,
                        }));
                        return;
                    }
                }

                // Parse and handle command or prompt
                const parsed = inputService.parseInput(trimmed);

                // Check if this command should show an interactive overlay
                if (parsed.type === 'command' && parsed.command) {
                    const { getCommandOverlay } = await import('../utils/commandOverlays.js');
                    const overlay = getCommandOverlay(parsed.command, parsed.args || [], agent);
                    if (overlay) {
                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            activeOverlay: overlay,
                        }));
                        return;
                    }
                }

                if (parsed.type === 'command' && parsed.command) {
                    const { CommandService } = await import('../services/CommandService.js');
                    const commandService = new CommandService();

                    try {
                        const result = await commandService.executeCommand(
                            parsed.command,
                            parsed.args || [],
                            agent,
                            session.id || undefined,
                            configFilePath
                        );

                        if (result.type === 'output' && result.output) {
                            const output = result.output;
                            setUi((prev) => ({
                                ...prev,
                                activeOverlay: 'command-output',
                                commandOutput: {
                                    title: `/${parsed.command}`,
                                    content: output,
                                },
                            }));
                        }

                        if (result.type === 'styled' && result.styled) {
                            const { fallbackText } = result.styled;
                            setUi((prev) => ({
                                ...prev,
                                activeOverlay: 'command-output',
                                commandOutput: {
                                    title: `/${parsed.command}`,
                                    content: fallbackText,
                                },
                            }));
                        }

                        // Handle sendMessage - send through normal streaming flow
                        if (result.type === 'sendMessage' && result.messageToSend) {
                            let currentSessionId = session.id;

                            if (!currentSessionId) {
                                if (sessionCreationPromiseRef.current) {
                                    try {
                                        const existingSession =
                                            await sessionCreationPromiseRef.current;
                                        currentSessionId = existingSession.id;
                                    } catch {
                                        sessionCreationPromiseRef.current = null;
                                    }
                                }

                                if (!currentSessionId) {
                                    const sessionPromise = agent.createSession();
                                    sessionCreationPromiseRef.current = sessionPromise;

                                    const newSession = await sessionPromise;
                                    currentSessionId = newSession.id;
                                    setSession((prev) => ({
                                        ...prev,
                                        id: currentSessionId,
                                        hasActiveSession: true,
                                    }));
                                }
                            }

                            if (!currentSessionId) {
                                throw new Error('Failed to create or retrieve session');
                            }

                            // Send through normal streaming flow (matches WebUI pattern)
                            const iterator = await agent.stream(
                                result.messageToSend,
                                currentSessionId
                            );
                            await processStream(
                                iterator,
                                {
                                    setMessages,
                                    setPendingMessages,
                                    setDequeuedBuffer,
                                    setUi,
                                    setSession,
                                    setSteerMessages,
                                    setQueuedMessages,
                                    setApproval,
                                    setApprovalQueue,
                                },
                                {
                                    useStreaming,
                                    autoApproveEditsRef,
                                    bypassPermissionsRef,
                                    eventBus: agent,
                                    setTodos,
                                    ...(soundService && { soundService }),
                                }
                            );
                            return; // processStream handles UI state
                        }

                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            isCancelling: false,
                            isThinking: false,
                        }));
                    } catch (error) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('error'),
                                role: 'system',
                                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                                timestamp: new Date(),
                            },
                        ]);
                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            isCancelling: false,
                            isThinking: false,
                        }));
                    }
                } else {
                    try {
                        let currentSessionId = session.id;

                        if (!currentSessionId) {
                            if (sessionCreationPromiseRef.current) {
                                try {
                                    const existingSession = await sessionCreationPromiseRef.current;
                                    currentSessionId = existingSession.id;
                                } catch {
                                    sessionCreationPromiseRef.current = null;
                                }
                            }

                            if (!currentSessionId) {
                                const sessionPromise = agent.createSession();
                                sessionCreationPromiseRef.current = sessionPromise;

                                const newSession = await sessionPromise;
                                currentSessionId = newSession.id;
                                setSession((prev) => ({
                                    ...prev,
                                    id: currentSessionId,
                                    hasActiveSession: true,
                                }));
                            }
                        }

                        if (!currentSessionId) {
                            throw new Error('Failed to create or retrieve session');
                        }

                        const metadata = await agent.getSessionMetadata(currentSessionId);
                        const isFirstMessage = !metadata || metadata.messageCount <= 0;

                        // Build content with images if any
                        let content: string | ContentPart[];

                        let messageText = trimmed;

                        // Auto-detect file paths in message text
                        let autoImages: Array<{ data: string; mimeType: string }> = [];
                        if (pendingImages.length === 0) {
                            let checkText = messageText.trim();
                            // Remove surrounding quotes
                            if ((checkText.startsWith('"') && checkText.endsWith('"')) ||
                                (checkText.startsWith("'") && checkText.endsWith("'"))) {
                                checkText = checkText.slice(1, -1).trim();
                            }
                            try {
                                const { isSupportedFilePath, getFileMimeType, readFileAsBase64 } = await import('../utils/clipboardUtils.js');
                                if (isSupportedFilePath(checkText)) {
                                    const base64 = readFileAsBase64(checkText);
                                    const mimeType = getFileMimeType(checkText);
                                    autoImages.push({ data: `data:${mimeType};base64,${base64}`, mimeType });
                                    messageText = '';
                                }
                            } catch {}
                        }

                        if (pendingImages.length > 0 || autoImages.length > 0) {
                            // Build multimodal content parts
                            const parts: ContentPart[] = [];

                            // Add text part first (with potential plan-mode injection)
                            if (messageText) {
                                parts.push({ type: 'text', text: messageText } as TextPart);
                            }

                            // Add image parts from paste
                            for (const img of pendingImages) {
                                parts.push({
                                    type: 'image',
                                    image: img.data,
                                    mimeType: img.mimeType,
                                } as ImagePart);
                            }

                            // Add image parts from file path detection
                            for (const img of autoImages) {
                                parts.push({
                                    type: 'image',
                                    image: img.data,
                                    mimeType: img.mimeType,
                                } as ImagePart);
                            }

                            content = parts;
                        } else {
                            content = messageText;
                        }

                        // Get current LLM config for analytics
                        const llmConfig = agent.getCurrentLLMConfig(currentSessionId);

                        // Track message sent analytics
                        captureAnalytics('fius_message_sent', {
                            source: 'cli',
                            sessionId: currentSessionId,
                            provider: llmConfig.provider,
                            model: llmConfig.model,
                            hasImage: pendingImages.length > 0,
                            hasFile: false,
                            messageLength: trimmed.length,
                        });

                        // Use streaming API and process events directly
                        const iterator = await agent.stream(content, currentSessionId);
                        await processStream(
                            iterator,
                            {
                                setMessages,
                                setPendingMessages,
                                setDequeuedBuffer,
                                setUi,
                                setSession,
                                setSteerMessages,
                                setQueuedMessages,
                                setApproval,
                                setApprovalQueue,
                            },
                            {
                                useStreaming,
                                autoApproveEditsRef,
                                bypassPermissionsRef,
                                eventBus: agent,
                                setTodos,
                                ...(soundService && { soundService }),
                            }
                        );

                        if (isFirstMessage) {
                            agent.generateSessionTitle(currentSessionId).catch(() => {
                                // Title generation is non-critical - silently ignore failures
                            });
                        }
                    } catch (error) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('error'),
                                role: 'system',
                                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                                timestamp: new Date(),
                            },
                        ]);
                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            isCancelling: false,
                            isThinking: false,
                        }));
                    }
                }
            },
            [
                buffer,
                input.images,
                input.pastedBlocks,
                expandPasteBlocks,
                setInput,
                setUi,
                setMessages,
                setPendingMessages,
                setDequeuedBuffer,
                setSteerMessages,
                setQueuedMessages,
                setSession,
                agent,
                inputService,
                ui.isProcessing,
                ui.activeOverlay,
                session.id,
                useStreaming,
                soundService,
            ]
        );

        useEffect(() => {
            if (!initialPrompt || didAutoSubmitInitialPromptRef.current) {
                return;
            }

            didAutoSubmitInitialPromptRef.current = true;

            handleSubmit(initialPrompt, true).catch((error) => {
                agent.logger.error('InputContainer initial prompt submission failed', {
                    error,
                    initialPrompt,
                });
                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('error'),
                        role: 'system',
                        content: `Failed to submit initial prompt: ${error instanceof Error ? error.message : String(error)}`,
                        timestamp: new Date(),
                    },
                ]);
            });
        }, [agent.logger, handleSubmit, initialPrompt, setMessages]);

        // Determine if main input should be active.
        // Important: The main input subscribes to keypress events directly (not via orchestrator),
        // so we must disable it for ALL overlays except the two autocompletes that intentionally
        // use the main input as their filter field.
        const mainInputAllowedOverlays = ['none', 'slash-autocomplete', 'resource-autocomplete'];
        const mainInputAllowed = mainInputAllowedOverlays.includes(ui.activeOverlay);
        const isHistorySearchActive = ui.historySearch.isActive;
        const isInputActive = !approval && mainInputAllowed && !isHistorySearchActive;
        const isInputDisabled =
            approval !== null || !mainInputAllowed || isHistorySearchActive || isQueuedEditPending;
        // Allow submit when:
        // - no overlay active
        // - approval active
        // Note: slash-autocomplete handles its own Enter key (either executes command or submits raw text)
        const shouldHandleSubmit = ui.activeOverlay === 'none' || ui.activeOverlay === 'approval';
        // Allow history navigation when not blocked by approval/overlay
        // Allow during processing so users can browse previous prompts while agent runs
        const canNavigateHistory = !approval && ui.activeOverlay === 'none';

        // Hide the input area when a focused overlay/approval is active.
        // This matches "full-screen overlay" UX (Claude-style) and prevents extra UI chrome/flicker.
        const shouldHideInputArea = getOverlayPresentation(ui.activeOverlay, approval) === 'focus';

        const placeholder = approval
            ? 'Approval required above...'
            : 'Type your message or /help for commands';

        // Expose submit method for external use (e.g., from OverlayContainer)
        // Pass bypassOverlayCheck=true since programmatic calls should skip the overlay check
        useImperativeHandle(ref, () => ({
            submit: (text: string) => handleSubmit(text, true),
        }));

        if (shouldHideInputArea) {
            return null;
        }

        return (
            <InputArea
                buffer={buffer}
                onSubmit={shouldHandleSubmit ? handleSubmit : () => {}}
                onQueueSubmit={
                    shouldHandleSubmit
                        ? (value) => void handleSubmit(value, false, true)
                        : undefined
                }
                isDisabled={isInputDisabled}
                isActive={isInputActive}
                placeholder={placeholder}
                onHistoryNavigate={canNavigateHistory ? handleHistoryNavigate : undefined}
                onCurrentTurnEdit={handleCurrentTurnEdit}
                onTriggerOverlay={handleTriggerOverlay}
                onKeyboardScroll={onKeyboardScroll}
                imageCount={input.images.length}
                onImagePaste={supportsAttachments(agent) ? handleImagePaste : undefined}
                images={input.images}
                onImageRemove={handleImageRemove}
                pastedBlocks={input.pastedBlocks}
                onPasteBlock={handlePasteBlock}
                onPasteBlockUpdate={handlePasteBlockUpdate}
                onPasteBlockRemove={handlePasteBlockRemove}
                highlightQuery={ui.historySearch.isActive ? ui.historySearch.query : undefined}
                onCycleReasoningVariant={
                    ui.activeOverlay === 'none'
                        ? handleCycleReasoningVariant
                        : undefined
                }
            />
        );
    }
);
