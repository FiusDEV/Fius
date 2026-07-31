

import React, { useCallback, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { Box } from 'ink';
import path from 'path';
import type { McpServerConfig, McpServerStatus, McpServerType } from '@fius/core';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import type { Key } from '../hooks/useInputOrchestrator.js';
import { ApprovalStatus, DenialReason, isUserMessage } from '@fius/core';
import type { Message, UIState, InputState, SessionState } from '../state/types.js';
import {
    ApprovalPrompt,
    type ApprovalPromptHandle,
    type ApprovalRequest,
} from '../components/ApprovalPrompt.js';
import {
    SlashCommandAutocomplete,
    type SlashCommandAutocompleteHandle,
} from '../components/SlashCommandAutocomplete.js';
import ResourceAutocomplete, {
    type ResourceAutocompleteHandle,
} from '../components/ResourceAutocomplete.js';
import ModelSelectorRefactored, {
    type ModelSelectorHandle,
} from '../components/overlays/ModelSelectorRefactored.js';
import {
    ReasoningOverlay,
    type ReasoningOverlayHandle,
} from '../components/overlays/ReasoningOverlay.js';
import SessionSelectorRefactored, {
    type SessionSelectorHandle,
} from '../components/overlays/SessionSelectorRefactored.js';
import StreamSelector, {
    type StreamSelectorHandle,
} from '../components/overlays/StreamSelector.js';
import AccessModeSelector, {
    type AccessModeSelectorHandle,
} from '../components/overlays/AccessModeSelector.js';
import BuildModeSelector, {
    type BuildModeSelectorHandle,
} from '../components/overlays/BuildModeSelector.js';
import SoundsSelector, {
    type SoundsSelectorHandle,
} from '../components/overlays/SoundsSelector.js';
import ToolBrowser, { type ToolBrowserHandle } from '../components/overlays/ToolBrowser.js';
import {
    CommandOutputOverlay,
    type CommandOutputOverlayHandle,
} from '../components/overlays/CommandOutputOverlay.js';
import McpServerList, {
    type McpServerListHandle,
    type McpServerListAction,
} from '../components/overlays/McpServerList.js';
import McpServerActions, {
    type McpServerActionsHandle,
    type McpServerAction,
} from '../components/overlays/McpServerActions.js';
import McpAddChoice, {
    type McpAddChoiceHandle,
    type McpAddChoiceType,
} from '../components/overlays/McpAddChoice.js';
import McpAddSelector, {
    type McpAddSelectorHandle,
    type McpAddResult,
} from '../components/overlays/McpAddSelector.js';
import McpGithubBrowser, {
    type McpGithubBrowserHandle,
    type McpGithubBrowserResult,
} from '../components/overlays/McpGithubBrowser.js';
import SessionSubcommandSelector, {
    type SessionSubcommandSelectorHandle,
    type SessionAction,
} from '../components/overlays/SessionSubcommandSelector.js';
import McpCustomTypeSelector, {
    type McpCustomTypeSelectorHandle,
} from '../components/overlays/McpCustomTypeSelector.js';
import McpCustomWizard, {
    type McpCustomWizardHandle,
    type McpCustomConfig,
} from '../components/overlays/McpCustomWizard.js';
import CustomModelWizard, {
    type CustomModelWizardHandle,
} from '../components/overlays/CustomModelWizard.js';
import ChatGPTUsageCapOverlay, {
    type ChatGPTUsageCapOverlayHandle,
} from '../components/overlays/ChatGPTUsageCapOverlay.js';
import InsufficientCreditsOverlay, {
    type InsufficientCreditsOverlayHandle,
} from '../components/overlays/InsufficientCreditsOverlay.js';
import { getLLMProviderDisplayName } from '../utils/llm-provider-display.js';
import { resolveChatGPTFallbackModel } from '../utils/chatgpt-rate-limit.js';
import {
    getProviderKeyStatus,
    loadGlobalPreferences,
    recordRecentModel,
    updateGlobalPreferences,
    type CustomModel,
    type ListedPlugin,
} from '@fius/agent-management';
import ApiKeyInput, { type ApiKeyInputHandle } from '../components/overlays/ApiKeyInput.js';
import SearchOverlay, { type SearchOverlayHandle } from '../components/overlays/SearchOverlay.js';
import PromptList, {
    type PromptListHandle,
    type PromptListAction,
} from '../components/overlays/PromptList.js';
import PromptAddChoice, {
    type PromptAddChoiceHandle,
    type PromptAddChoiceResult,
} from '../components/overlays/PromptAddChoice.js';
import PromptAddWizard, {
    type PromptAddWizardHandle,
    type NewPromptData,
} from '../components/overlays/PromptAddWizard.js';
import PromptDeleteSelector, {
    type PromptDeleteSelectorHandle,
    type DeletablePrompt,
} from '../components/overlays/PromptDeleteSelector.js';
import SessionRenameOverlay, {
    type SessionRenameOverlayHandle,
} from '../components/overlays/SessionRenameOverlay.js';
import type { TuiAgentBackend } from '../agent-backend.js';
import ContextStatsOverlay, {
    type ContextStatsOverlayHandle,
} from '../components/overlays/ContextStatsOverlay.js';
import ExportWizard, { type ExportWizardHandle } from '../components/overlays/ExportWizard.js';
import PluginManager, {
    type PluginManagerHandle,
    type PluginAction,
} from '../components/overlays/PluginManager.js';
import PluginList, { type PluginListHandle } from '../components/overlays/PluginList.js';
import PluginActions, {
    type PluginActionsHandle,
    type PluginActionResult,
} from '../components/overlays/PluginActions.js';
import PluginGithubBrowser, {
    type PluginGithubBrowserHandle,
    type PluginGithubBrowserResult,
} from '../components/overlays/PluginGithubBrowser.js';
import CustomPluginInstallPrompt, {
    type CustomPluginInstallPromptHandle,
} from '../components/overlays/CustomPluginInstallPrompt.js';
import MarketplaceBrowser, {
    type MarketplaceBrowserHandle,
    type MarketplaceBrowserAction,
} from '../components/overlays/MarketplaceBrowser.js';
import MarketplaceAddPrompt, {
    type MarketplaceAddPromptHandle,
} from '../components/overlays/MarketplaceAddPrompt.js';
import LoginOverlay, {
    type LoginOverlayHandle,
    type LoginOverlayOutcome,
} from '../components/overlays/LoginOverlay.js';
import LogoutOverlay, {
    type LogoutOverlayHandle,
    type LogoutOverlayOutcome,
} from '../components/overlays/LogoutOverlay.js';
import { ProvidersOverlay } from '../components/overlays/ProvidersOverlay.js';
import type { ProvidersOverlayHandle } from '../components/overlays/ProvidersOverlay.js';
import { ModelsDevBrowser } from '../components/overlays/ModelsDevBrowser.js';
import type { ModelsDevBrowserHandle } from '../components/overlays/ModelsDevBrowser.js';
import ConnectOverlay, {
    type ConnectOverlayHandle,
    type ConnectOverlayOutcome,
} from '../components/overlays/ConnectOverlay.js';
import SkillsSelector, {
    type SkillsSelectorHandle,
    type SkillSelectorAction,
} from '../components/overlays/SkillsSelector.js';
import SkillActions, {
    type SkillActionsHandle,
    type SkillActionResult,
} from '../components/overlays/SkillActions.js';
import type { PromptAddScope } from '../state/types.js';
import type { PromptInfo, ResourceMetadata, SearchResult } from '@fius/core';
import type { LLMProvider, ReasoningVariant } from '@fius/llm';
import { LLM_PROVIDERS, getModelDisplayName, getReasoningProfile } from '@fius/llm';
import { FiusValidationError, LLMErrorCode } from '@fius/core';
import { InputService } from '../services/InputService.js';
import { createUserMessage, convertHistoryToUIMessages } from '../utils/messageFormatting.js';
import { generateMessageId } from '../utils/idGenerator.js';
import { captureAnalytics, removeAuth } from '../host/index.js';
import { triggerLogoutExit } from '../interactive-commands/exit-handler.js';
import { FocusOverlayFrame } from '../components/shared/FocusOverlayFrame.js';
import { shouldHideCliChrome } from '../utils/overlayPresentation.js';
import { refreshFiusAuthAfterLogin } from '../utils/fius-auth-refresh.js';

function isLLMProvider(value: unknown): value is LLMProvider {
    if (typeof value !== 'string') return false;
    for (const provider of LLM_PROVIDERS) {
        if (provider === value) return true;
    }
    return false;
}

function getProviderFromIssueContext(context: unknown): LLMProvider | null {
    if (typeof context !== 'object' || context === null) return null;
    const provider = Reflect.get(context, 'provider');
    return isLLMProvider(provider) ? provider : null;
}

function buildReasoningSwitchUpdate(
    provider: LLMProvider,
    model: string,
    reasoningVariant: ReasoningVariant | undefined
): { reasoning?: { variant: ReasoningVariant } | null } {
    if (reasoningVariant === undefined) {
        return {};
    }

    const defaultVariant = getReasoningProfile(provider, model).defaultVariant;
    if (defaultVariant !== undefined && reasoningVariant === defaultVariant) {
        return { reasoning: null };
    }

    return { reasoning: { variant: reasoningVariant } };
}

export interface OverlayContainerHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface OverlayContainerProps {
    ui: UIState;
    input: InputState;
    session: SessionState;
    approval: ApprovalRequest | null;
    setInput: React.Dispatch<React.SetStateAction<InputState>>;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    setSession: React.Dispatch<React.SetStateAction<SessionState>>;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
    setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
    agent: TuiAgentBackend;
    inputService: InputService;
    buffer: TextBuffer;
    
    configFilePath: string | null;
    
    refreshStatic?: () => void;
    
    onSubmitPromptCommand?: (commandText: string) => Promise<void>;
}


export const OverlayContainer = forwardRef<OverlayContainerHandle, OverlayContainerProps>(
    function OverlayContainer(
        {
            ui,
            input,
            session,
            approval,
            setInput,
            setUi,
            setSession,
            setMessages,
            setApproval,
            setApprovalQueue,
            agent,
            inputService,
            buffer,
            configFilePath,
            refreshStatic,
            onSubmitPromptCommand,
        },
        ref
    ) {
        // Refs to overlay components for input handling
        const approvalRef = useRef<ApprovalPromptHandle>(null);
        const slashAutocompleteRef = useRef<SlashCommandAutocompleteHandle>(null);
        const resourceAutocompleteRef = useRef<ResourceAutocompleteHandle>(null);
        const modelSelectorRef = useRef<ModelSelectorHandle>(null);
        const reasoningOverlayRef = useRef<ReasoningOverlayHandle>(null);
        const sessionSelectorRef = useRef<SessionSelectorHandle>(null);
        const streamSelectorRef = useRef<StreamSelectorHandle>(null);
        const accessModeSelectorRef = useRef<AccessModeSelectorHandle>(null);
        const buildModeSelectorRef = useRef<BuildModeSelectorHandle>(null);
        const soundsSelectorRef = useRef<SoundsSelectorHandle>(null);
        const toolBrowserRef = useRef<ToolBrowserHandle>(null);
        const commandOutputRef = useRef<CommandOutputOverlayHandle>(null);
        const mcpServerListRef = useRef<McpServerListHandle>(null);
        const mcpServerActionsRef = useRef<McpServerActionsHandle>(null);
        const mcpAddChoiceRef = useRef<McpAddChoiceHandle>(null);
        const mcpAddSelectorRef = useRef<McpAddSelectorHandle>(null);
        const mcpGithubBrowserRef = useRef<McpGithubBrowserHandle>(null);
        const mcpCustomTypeSelectorRef = useRef<McpCustomTypeSelectorHandle>(null);
        const mcpCustomWizardRef = useRef<McpCustomWizardHandle>(null);
        const customModelWizardRef = useRef<CustomModelWizardHandle>(null);
        const sessionSubcommandSelectorRef = useRef<SessionSubcommandSelectorHandle>(null);
        const chatGPTUsageCapRef = useRef<ChatGPTUsageCapOverlayHandle>(null);
        const insufficientCreditsRef = useRef<InsufficientCreditsOverlayHandle>(null);
        const apiKeyInputRef = useRef<ApiKeyInputHandle>(null);
        const loginOverlayRef = useRef<LoginOverlayHandle>(null);
        const logoutOverlayRef = useRef<LogoutOverlayHandle>(null);
        const connectOverlayRef = useRef<ConnectOverlayHandle>(null);
        const skillsSelectorRef = useRef<SkillsSelectorHandle>(null);
        const skillActionsRef = useRef<SkillActionsHandle>(null);
        const providersOverlayRef = useRef<ProvidersOverlayHandle>(null);
        const modelsDevBrowserRef = useRef<ModelsDevBrowserHandle>(null);
        const searchOverlayRef = useRef<SearchOverlayHandle>(null);
        const promptListRef = useRef<PromptListHandle>(null);
        const promptAddChoiceRef = useRef<PromptAddChoiceHandle>(null);
        const promptAddWizardRef = useRef<PromptAddWizardHandle>(null);
        const promptDeleteSelectorRef = useRef<PromptDeleteSelectorHandle>(null);
        const sessionRenameRef = useRef<SessionRenameOverlayHandle>(null);
        const contextStatsRef = useRef<ContextStatsOverlayHandle>(null);
        const exportWizardRef = useRef<ExportWizardHandle>(null);
        const pluginManagerRef = useRef<PluginManagerHandle>(null);
        const pluginListRef = useRef<PluginListHandle>(null);
        const pluginActionsRef = useRef<PluginActionsHandle>(null);
        const pluginGithubBrowserRef = useRef<PluginGithubBrowserHandle>(null);
        const customPluginInstallRef = useRef<CustomPluginInstallPromptHandle>(null);
        const marketplaceBrowserRef = useRef<MarketplaceBrowserHandle>(null);

        // State for selected plugin (for plugin-actions overlay)
        const [selectedPlugin, setSelectedPlugin] = useState<ListedPlugin | null>(null);
        const marketplaceAddPromptRef = useRef<MarketplaceAddPromptHandle>(null);

        const getConfigFilePathOrWarn = useCallback(
            (action: string): string | null => {
                if (configFilePath) {
                    return configFilePath;
                }

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `⚠ Cannot ${action}: this agent is not file-backed (no config path).`,
                        timestamp: new Date(),
                    },
                ]);
                return null;
            },
            [configFilePath, setMessages]
        );

        // Expose handleInput method via ref - routes to appropriate overlay
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (inputStr: string, key: Key): boolean => {
                    // Route to approval first (highest priority)
                    if (approval && approvalRef.current) {
                        return approvalRef.current.handleInput(inputStr, key);
                    }

                    // Route to active overlay based on type
                    switch (ui.activeOverlay) {
                        case 'slash-autocomplete':
                            return (
                                slashAutocompleteRef.current?.handleInput(inputStr, key) ?? false
                            );
                        case 'resource-autocomplete':
                            return (
                                resourceAutocompleteRef.current?.handleInput(inputStr, key) ?? false
                            );
                        case 'model-selector':
                            return modelSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'providers-selector':
                            return providersOverlayRef.current?.handleInput(inputStr, key) ?? false;
                        case 'models-dev-browser':
                            return modelsDevBrowserRef.current?.handleInput(inputStr, key) ?? false;
                        case 'reasoning':
                            return reasoningOverlayRef.current?.handleInput(inputStr, key) ?? false;
                        case 'session-selector':
                            return sessionSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'stream-selector':
                            return streamSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'access-mode-selector':
                            return accessModeSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'build-mode-selector':
                            return buildModeSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'sounds-selector':
                            return soundsSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'tool-browser':
                            return toolBrowserRef.current?.handleInput(inputStr, key) ?? false;
                        case 'command-output':
                            return commandOutputRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-server-list':
                            return mcpServerListRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-server-actions':
                            return mcpServerActionsRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-add-choice':
                            return mcpAddChoiceRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-add-selector':
                            return mcpAddSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-github-browser':
                            return mcpGithubBrowserRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-custom-type-selector':
                            return (
                                mcpCustomTypeSelectorRef.current?.handleInput(inputStr, key) ??
                                false
                            );
                        case 'mcp-custom-wizard':
                            return mcpCustomWizardRef.current?.handleInput(inputStr, key) ?? false;
                        case 'custom-model-wizard':
                            return (
                                customModelWizardRef.current?.handleInput(inputStr, key) ?? false
                            );
                        case 'session-subcommand-selector':
                            return (
                                sessionSubcommandSelectorRef.current?.handleInput(inputStr, key) ??
                                false
                            );
                        case 'chatgpt-usage-cap':
                            return chatGPTUsageCapRef.current?.handleInput(inputStr, key) ?? false;
                        case 'insufficient-credits':
                            return (
                                insufficientCreditsRef.current?.handleInput(inputStr, key) ?? false
                            );
                        case 'api-key-input':
                            return apiKeyInputRef.current?.handleInput(inputStr, key) ?? false;
                        case 'login':
                            return loginOverlayRef.current?.handleInput(inputStr, key) ?? false;
                        case 'logout':
                            return logoutOverlayRef.current?.handleInput(inputStr, key) ?? false;
                        case 'connect':
                            return connectOverlayRef.current?.handleInput(inputStr, key) ?? false;
                        case 'skills-list':
                            return skillsSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'skill-actions':
                            return skillActionsRef.current?.handleInput(inputStr, key) ?? false;
                        case 'search':
                            return searchOverlayRef.current?.handleInput(inputStr, key) ?? false;
                        case 'prompt-list':
                            return promptListRef.current?.handleInput(inputStr, key) ?? false;
                        case 'prompt-add-choice':
                            return promptAddChoiceRef.current?.handleInput(inputStr, key) ?? false;
                        case 'prompt-add-wizard':
                            return promptAddWizardRef.current?.handleInput(inputStr, key) ?? false;
                        case 'prompt-delete-selector':
                            return (
                                promptDeleteSelectorRef.current?.handleInput(inputStr, key) ?? false
                            );
                        case 'session-rename':
                            return sessionRenameRef.current?.handleInput(inputStr, key) ?? false;
                        case 'context-stats':
                            return contextStatsRef.current?.handleInput(inputStr, key) ?? false;
                        case 'export-wizard':
                            return exportWizardRef.current?.handleInput(inputStr, key) ?? false;
                        case 'plugin-manager':
                            return pluginManagerRef.current?.handleInput(inputStr, key) ?? false;
                        case 'plugin-list':
                            return pluginListRef.current?.handleInput(inputStr, key) ?? false;
                        case 'plugin-actions':
                            return pluginActionsRef.current?.handleInput(inputStr, key) ?? false;
                        case 'plugin-github':
                            return pluginGithubBrowserRef.current?.handleInput(inputStr, key) ?? false;
                        case 'custom-plugin-install':
                            return customPluginInstallRef.current?.handleInput(inputStr, key) ?? false;
                        case 'marketplace-browser':
                            return (
                                marketplaceBrowserRef.current?.handleInput(inputStr, key) ?? false
                            );
                        case 'marketplace-add':
                            return (
                                marketplaceAddPromptRef.current?.handleInput(inputStr, key) ?? false
                            );
                        default:
                            return false;
                    }
                },
            }),
            [approval, ui.activeOverlay]
        );

        // NOTE: Automatic overlay detection removed to prevent infinite loop
        // Overlays are now shown explicitly via setUi from InputContainer
        // or from the main component's input detection logic

        // Helper: Complete approval and process queue
        const completeApproval = useCallback(() => {
            setApprovalQueue((queue) => {
                if (queue.length > 0) {
                    // Show next approval from queue
                    const [next, ...rest] = queue;
                    setApproval(next!);
                    setUi((prev) => ({ ...prev, activeOverlay: 'approval' }));
                    return rest;
                } else {
                    // No more approvals
                    setApproval(null);
                    setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                    return [];
                }
            });
        }, [setApproval, setApprovalQueue, setUi]);

        // Handle approval responses
        const handleApprove = useCallback(
            (options: {
                rememberChoice?: boolean;
                formData?: Record<string, unknown>;
                enableAcceptEditsMode?: boolean;
            }) => {
                if (!approval) return;

                // Enable "accept all edits" mode if requested
                if (options.enableAcceptEditsMode) {
                    setUi((prev) => ({ ...prev, autoApproveEdits: true }));
                }

                // Auto-disable plan mode when plan_create or plan_review is approved
                // This signals the transition from planning phase to execution phase
                const toolName = approval.metadata.toolName as string | undefined;
                if (toolName === 'plan_create' || toolName === 'plan_review') {
                    // Plan tools - no action needed
                }

                const responseData: { rememberChoice?: boolean; formData?: Record<string, unknown> } = {
                    ...(options.rememberChoice !== undefined ? { rememberChoice: options.rememberChoice } : {}),
                    ...(options.formData !== undefined ? { formData: options.formData } : {}),
                };

                agent.emit('approval:response', {
                    approvalId: approval.approvalId,
                    status: ApprovalStatus.APPROVED,
                    sessionId: approval.sessionId,
                    hostRuntime: approval.hostRuntime,
                    ...(Object.keys(responseData).length > 0 ? { data: responseData } : {}),
                });

                completeApproval();
            },
            [approval, agent, completeApproval, setUi]
        );

        const handleDeny = useCallback(
            (feedback?: string) => {
                if (!approval) return;

                // Include user feedback in the denial message if provided
                const message = feedback
                    ? `User requested changes: ${feedback}`
                    : 'User denied the tool execution';

                agent.emit('approval:response', {
                    approvalId: approval.approvalId,
                    status: ApprovalStatus.DENIED,
                    sessionId: approval.sessionId,
                    hostRuntime: approval.hostRuntime,
                    reason: DenialReason.USER_DENIED,
                    message,
                });

                completeApproval();
            },
            [approval, agent, completeApproval]
        );

        const handleCancelApproval = useCallback(() => {
            if (!approval) return;

            agent.emit('approval:response', {
                approvalId: approval.approvalId,
                status: ApprovalStatus.CANCELLED,
                sessionId: approval.sessionId,
                hostRuntime: approval.hostRuntime,
                reason: DenialReason.USER_CANCELLED,
                message: 'User cancelled the approval request',
            });

            completeApproval();
        }, [approval, agent, completeApproval]);

        // Helper: Check if error is due to missing API key
        const isApiKeyMissingError = (error: unknown): LLMProvider | null => {
            if (error instanceof FiusValidationError) {
                const apiKeyIssue = error.issues.find(
                    (issue) => issue.code === LLMErrorCode.API_KEY_MISSING
                );
                if (apiKeyIssue && apiKeyIssue.context) {
                    return getProviderFromIssueContext(apiKeyIssue.context);
                }
            }
            return null;
        };

        const persistRecentModel = useCallback(
            async (provider: LLMProvider, model: string, baseURL?: string) => {
                try {
                    await recordRecentModel({
                        provider,
                        model,
                        ...(baseURL ? { baseURL } : {}),
                    });
                } catch (error) {
                    const modelKey = baseURL
                        ? `${provider}/${model} (${baseURL})`
                        : `${provider}/${model}`;
                    agent.logger.debug(
                        `Failed to persist recent model (${modelKey}): ${
                            error instanceof Error ? error.message : String(error)
                        }`
                    );
                }
            },
            [agent]
        );

        // Handle model selection (session-only)
        const handleModelSelect = useCallback(
            async (
                provider: LLMProvider,
                model: string,
                displayName?: string,
                baseURL?: string,
                reasoningVariant?: ReasoningVariant,
                apiKey?: string
            ) => {
                const providerLabel = getLLMProviderDisplayName(provider, baseURL);

                // Session-only switch (default is set via explicit action)

                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                try {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `⟳ Switching to ${displayName || model} (${providerLabel})...`,
                            timestamp: new Date(),
                        },
                    ]);

                    await agent.switchLLM(
                        {
                            provider,
                            model,
                            baseURL,
                            ...(apiKey ? { apiKey } : {}),
                            ...buildReasoningSwitchUpdate(provider, model, reasoningVariant),
                        },
                        session.id ?? undefined
                    );
                    await persistRecentModel(provider as LLMProvider, model, baseURL);

                    // Update session state with display name (fallback to model ID)
                    setSession((prev) => ({ ...prev, modelName: displayName || model }));

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Successfully switched to ${displayName || model} (${providerLabel})`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    // Check if error is due to missing API key
                    const missingProvider = isApiKeyMissingError(error);
                    if (missingProvider) {
                        const missingProviderLabel = getLLMProviderDisplayName(
                            missingProvider,
                            missingProvider === provider ? baseURL : undefined
                        );
                        // Store pending model switch and show API key input
                        // Use missingProvider (from error) as the authoritative source
                        setUi((prev) => ({
                            ...prev,
                            activeOverlay: 'api-key-input',
                            pendingModelSwitch: {
                                provider: missingProvider,
                                model,
                                ...(displayName && { displayName }),
                                ...(baseURL && { baseURL }),
                                ...(reasoningVariant !== undefined && { reasoningVariant }),
                            },
                        }));
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `◈ API key required for ${missingProviderLabel}`,
                                timestamp: new Date(),
                            },
                        ]);
                        return;
                    }

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [
                setUi,
                setInput,
                setMessages,
                setSession,
                agent,
                session.id,
                buffer,
                persistRecentModel,
            ]
        );

        const handleSetDefaultModel = useCallback(
            async (
                provider: LLMProvider,
                model: string,
                displayName?: string,
                baseURL?: string,
                reasoningVariant?: ReasoningVariant,
                apiKey?: string
            ) => {
                const providerLabel = getLLMProviderDisplayName(provider, baseURL);

                try {
                    let providerEnvVar: string | undefined;
                    try {
                        const providerKeyStatus = await getProviderKeyStatus(provider);
                        providerEnvVar = providerKeyStatus?.envVar;
                    } catch (error) {
                        agent.logger.debug(
                            `Failed to resolve provider API key env var: ${
                                error instanceof Error ? error.message : String(error)
                            }`
                        );
                    }

                    let existing = null;
                    try {
                        existing = await loadGlobalPreferences();
                    } catch {
                        existing = null;
                    }

                    const existingReasoning = existing?.llm.reasoning;
                    const defaultReasoningVariant = getReasoningProfile(
                        provider,
                        model
                    ).defaultVariant;
                    const nextReasoning =
                        reasoningVariant === undefined
                            ? existingReasoning
                            : defaultReasoningVariant !== undefined &&
                                reasoningVariant === defaultReasoningVariant
                              ? undefined
                              : { variant: reasoningVariant };

                    type GlobalLLMPreferences = Awaited<
                        ReturnType<typeof loadGlobalPreferences>
                    >['llm'];

                    const preferencesUpdate: GlobalLLMPreferences = {
                        provider,
                        model,
                        ...(baseURL ? { baseURL } : {}),
                        ...(nextReasoning ? { reasoning: nextReasoning } : {}),
                    };

                    const switchReasoningUpdate = buildReasoningSwitchUpdate(
                        provider,
                        model,
                        reasoningVariant
                    );

                    // Only preserve the API key if the provider hasn't changed
                    // If provider changed, use the new provider's env var
                    if (apiKey) {
                        preferencesUpdate.apiKey = apiKey;
                    } else if (existing?.llm.provider === provider && existing?.llm.apiKey) {
                        preferencesUpdate.apiKey = existing.llm.apiKey;
                    } else if (providerEnvVar) {
                        preferencesUpdate.apiKey = '$' + providerEnvVar;
                    }

                    await updateGlobalPreferences({
                        llm: preferencesUpdate,
                    });

                    try {
                        await agent.switchLLM(
                            {
                                provider,
                                model,
                                ...(baseURL ? { baseURL } : {}),
                                ...(apiKey ? { apiKey } : {}),
                                ...switchReasoningUpdate,
                            },
                            session.id ?? undefined
                        );
                        await persistRecentModel(provider, model, baseURL);
                        setSession((prev) => ({ ...prev, modelName: displayName || model }));

                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `✓ Default model set to ${displayName || model} (${providerLabel})`,
                                timestamp: new Date(),
                            },
                        ]);
                    } catch (error) {
                        const missingProvider = isApiKeyMissingError(error);
                        if (missingProvider) {
                            const missingProviderLabel = getLLMProviderDisplayName(
                                missingProvider,
                                missingProvider === provider ? baseURL : undefined
                            );
                            setUi((prev) => ({
                                ...prev,
                                activeOverlay: 'api-key-input',
                                pendingModelSwitch: {
                                    provider: missingProvider,
                                    model,
                                    ...(displayName && { displayName }),
                                    ...(baseURL && { baseURL }),
                                    ...(reasoningVariant !== undefined && { reasoningVariant }),
                                },
                            }));
                            setMessages((prev) => [
                                ...prev,
                                {
                                    id: generateMessageId('system'),
                                    role: 'system',
                                    content: `◈ API key required for ${missingProviderLabel}`,
                                    timestamp: new Date(),
                                },
                            ]);
                            return;
                        }
                        throw error;
                    }
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to set default model: ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [agent, setMessages, setSession, setUi, session.id, persistRecentModel]
        );

        // State for editing custom model
        const [editingModel, setEditingModel] = useState<CustomModel | null>(null);

        // Handle "Add custom model" from model selector
        const handleAddCustomModel = useCallback(() => {
            setEditingModel(null);
            setUi((prev) => ({ ...prev, activeOverlay: 'custom-model-wizard' }));
        }, [setUi]);

        // Handle "Edit custom model" from model selector
        const handleEditCustomModel = useCallback(
            (model: CustomModel) => {
                setEditingModel(model);
                setUi((prev) => ({ ...prev, activeOverlay: 'custom-model-wizard' }));
            },
            [setUi]
        );

        // Handle custom model wizard completion
        const handleCustomModelComplete = useCallback(
            async (model: CustomModel) => {
                const wasEditing = editingModel !== null;
                setEditingModel(null);
                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                if (wasEditing) {
                    // For edits, just show confirmation message
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Custom model "${model.displayName || model.name}" updated`,
                            timestamp: new Date(),
                        },
                    ]);
                } else {
                    // For new models, auto-switch to the newly created model
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Custom model "${model.displayName || model.name}" saved`,
                            timestamp: new Date(),
                        },
                    ]);

                    // Switch to the new model
                    await handleModelSelect(
                        model.provider,
                        model.name,
                        model.displayName,
                        model.baseURL
                    );
                }
            },
            [setUi, setInput, setMessages, buffer, editingModel, handleModelSelect]
        );

        const handleChatGPTUsageCapClose = useCallback(() => {
            setUi((prev) => ({
                ...prev,
                activeOverlay: 'none',
            }));
        }, [setUi]);

        const handleInsufficientCreditsClose = useCallback(() => {
            setUi((prev) => ({
                ...prev,
                activeOverlay: 'none',
                insufficientCredits: null,
            }));
        }, [setUi]);

        const handleInsufficientCreditsResolved = useCallback(() => {
            setUi((prev) => ({
                ...prev,
                activeOverlay: 'none',
                insufficientCredits: null,
            }));

            setMessages((prev) => [
                ...prev,
                {
                    id: generateMessageId('system'),
                    role: 'system',
                    content: 'Billing opened in your browser. Retry your request when ready.',
                    timestamp: new Date(),
                },
            ]);
        }, [setMessages, setUi]);

        const handleChatGPTUsageCapConfirm = useCallback(async () => {
            const currentLLMConfig = agent.getCurrentLLMConfig();
            const fallbackTarget = resolveChatGPTFallbackModel(currentLLMConfig.model ?? '');
            const providerKeyStatus = getProviderKeyStatus(fallbackTarget.provider);
            const reasoningVariant = fallbackTarget.usedDefaultFallback
                ? undefined
                : currentLLMConfig.reasoning?.variant;

            if (providerKeyStatus.hasApiKey) {
                setUi((prev) => ({
                    ...prev,
                    activeOverlay: 'none',
                }));

                await handleModelSelect(
                    fallbackTarget.provider,
                    fallbackTarget.model,
                    fallbackTarget.displayName,
                    undefined,
                    reasoningVariant
                );
                return;
            }

            setUi((prev) => ({
                ...prev,
                activeOverlay: 'api-key-input',
                pendingModelSwitch: {
                    provider: fallbackTarget.provider,
                    model: fallbackTarget.model,
                    displayName: fallbackTarget.displayName,
                    ...(reasoningVariant !== undefined ? { reasoningVariant } : {}),
                },
            }));
            setMessages((prev) => [
                ...prev,
                {
                    id: generateMessageId('system'),
                    role: 'system',
                    content:
                        '⚠ ChatGPT Login hit its usage cap. Add an OpenAI API key to continue with the API provider.',
                    timestamp: new Date(),
                },
            ]);
        }, [agent, handleModelSelect, session.id, setMessages, setUi]);

        // Handle API key saved - retry the model switch
        const handleApiKeySaved = useCallback(
            async (meta: { provider: LLMProvider; envVar: string }) => {
                const pending = ui.pendingModelSwitch;
                if (!pending) {
                    // No pending switch, just close
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'none',
                        pendingModelSwitch: null,
                    }));
                    return;
                }

                setUi((prev) => ({
                    ...prev,
                    activeOverlay: 'none',
                    pendingModelSwitch: null,
                }));

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `✓ API key saved for ${meta.provider}`,
                        timestamp: new Date(),
                    },
                ]);

                // Retry the model switch
                try {
                    const pendingDisplayName = pending.displayName || pending.model;
                    const pendingProviderLabel = getLLMProviderDisplayName(
                        pending.provider,
                        pending.baseURL
                    );
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `⟳ Retrying switch to ${pendingDisplayName} (${pendingProviderLabel})...`,
                            timestamp: new Date(),
                        },
                    ]);

                    await agent.switchLLM(
                        {
                            provider: pending.provider,
                            model: pending.model,
                            ...(pending.baseURL && { baseURL: pending.baseURL }),
                            ...buildReasoningSwitchUpdate(
                                pending.provider,
                                pending.model,
                                pending.reasoningVariant
                            ),
                        },
                        session.id ?? undefined
                    );
                    await persistRecentModel(
                        pending.provider as LLMProvider,
                        pending.model,
                        pending.baseURL
                    );

                    // Update session state with display name (fallback to model ID)
                    setSession((prev) => ({ ...prev, modelName: pendingDisplayName }));

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Successfully switched to ${pendingDisplayName} (${pendingProviderLabel})`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [
                ui.pendingModelSwitch,
                setUi,
                setMessages,
                setSession,
                agent,
                session.id,
                persistRecentModel,
            ]
        );

        // Handle API key input close (without saving)
        const handleApiKeyClose = useCallback(() => {
            setUi((prev) => ({
                ...prev,
                activeOverlay: 'none',
                pendingModelSwitch: null,
            }));
        }, [setUi]);

        // Handle search result selection - display the result context
        const handleSearchResultSelect = useCallback(
            (result: SearchResult) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                // Display the selected search result as a system message
                const roleLabel =
                    result.message.role === 'user'
                        ? '◈ User'
                        : result.message.role === 'assistant'
                          ? '▤ Assistant'
                          : `☰ ${result.message.role}`;

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `◉ Search Result from session ${result.sessionId.slice(0, 8)}:\n\n${roleLabel}:\n${result.context}`,
                        timestamp: new Date(),
                    },
                ]);
            },
            [setUi, setInput, setMessages, buffer]
        );

        // Handle session selection
        const handleSessionSelect = useCallback(
            async (newSessionId: string) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                try {
                    // Check if already on this session
                    if (newSessionId === session.id) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `ⓘ  Already using session ${newSessionId.slice(0, 8)}`,
                                timestamp: new Date(),
                            },
                        ]);
                        return;
                    }

                    // Track session switch analytics
                    captureAnalytics('fius_session_switched', {
                        source: 'cli',
                        fromSessionId: session.id || null,
                        toSessionId: newSessionId,
                    });

                    // Clear messages and session state before switching
                    setMessages([]);
                    setApproval(null);
                    setApprovalQueue([]);

                    // Verify session exists first
                    const sessionData = await agent.getSession(newSessionId);
                    if (!sessionData) {
                        throw new Error(`Session ${newSessionId} not found`);
                    }

                    // Clear any corrupted LLM override from disk (from previous switchLLM calls with sessionId)
                    // This forces the session to use the global config (which has the API key)
                    await agent.clearSessionLLMOverride(newSessionId).catch(() => {});

                    // Don't call switchLLM — global config from CLI startup is used directly.
                    // Session override strips API keys (by design in toPersistedLLMConfig).

                    setSession({
                        id: newSessionId,
                        hasActiveSession: true,
                        modelName: session.modelName,
                    });

                    // Load session history
                    const history = await agent.getSessionHistory(newSessionId);
                    if (history && history.length > 0) {
                        const historyMessages = convertHistoryToUIMessages(history, newSessionId);
                        setMessages(historyMessages);

                        // Extract user messages for input history (arrow up navigation)
                        const userInputHistory = history
                            .filter(isUserMessage)
                            .map((msg) => {
                                // Extract text content from user message
                                if (typeof msg.content === 'string') {
                                    return msg.content;
                                }
                                // Handle array content (text parts)
                                if (Array.isArray(msg.content)) {
                                    return msg.content
                                        .filter(
                                            (part): part is { type: 'text'; text: string } =>
                                                typeof part === 'object' && part.type === 'text'
                                        )
                                        .map((part) => part.text)
                                        .join('\n');
                                }
                                return '';
                            })
                            .filter((text) => text.trim().length > 0);

                        setInput((prev) => ({
                            ...prev,
                            history: userInputHistory,
                            historyIndex: -1,
                        }));
                    }

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Switched to session ${newSessionId.slice(0, 8)}`,
                            timestamp: new Date(),
                        },
                    ]);

                    // Force Static component to re-render with the new history
                    refreshStatic?.();
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to switch session: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [
                setUi,
                setInput,
                setMessages,
                setApproval,
                setApprovalQueue,
                setSession,
                agent,
                session.id,
                session.modelName,
                buffer,
                refreshStatic,
            ]
        );

        // Handle session deletion
        const handleSessionDelete = useCallback(
            async (sessionId: string) => {
                try {
                    await agent.deleteSession(sessionId);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Deleted session ${sessionId.slice(0, 8)}`,
                            timestamp: new Date(),
                        },
                    ]);
                    // If we deleted the current session, create a new one
                    if (sessionId === session.id) {
                        const newSession = await agent.createSession();
                        setSession({
                            id: newSession.id,
                            hasActiveSession: true,
                            modelName: session.modelName,
                        });
                        setMessages([]);
                    }
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to delete session: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [agent, session.id, session.modelName, setMessages, setSession]
        );

        // Handle slash command/prompt selection
        const handlePromptSelect = useCallback(
            async (prompt: PromptInfo) => {
                // Use displayName for command text (user-friendly name without prefix)
                const commandName = prompt.displayName || prompt.name;
                const commandText = `/${commandName}`;
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                // Route prompts through InputContainer for streaming pipeline
                if (onSubmitPromptCommand) {
                    await onSubmitPromptCommand(commandText);
                    return;
                }

                // Fallback when callback not provided (shouldn't happen in normal usage)
                // Show user message for the executed command
                const userMessage = createUserMessage(commandText);
                setMessages((prev) => [...prev, userMessage]);

                setUi((prev) => ({ ...prev, isProcessing: true, isCancelling: false }));

                const { CommandService } = await import('../services/CommandService.js');
                const commandService = new CommandService();

                try {
                    // Use displayName to match the registered command name
                    const result = await commandService.executeCommand(
                        commandName,
                        [],
                        agent,
                        session.id || undefined
                    );

                    if (result.type === 'output' && result.output) {
                        const output = result.output;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('command'),
                                role: 'system',
                                content: output,
                                timestamp: new Date(),
                            },
                        ]);
                    }

                    if (result.type === 'styled' && result.styled) {
                        const { fallbackText, styledType, styledData } = result.styled;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('command'),
                                role: 'system',
                                content: fallbackText,
                                timestamp: new Date(),
                                styledType,
                                styledData,
                            },
                        ]);
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
                            content: `${error instanceof Error ? error.message : String(error)}`,
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
            },
            [setUi, setInput, setMessages, agent, session.id, buffer, onSubmitPromptCommand]
        );

        // Handle loading command/prompt into input for editing (Tab key)

        const handleSystemCommandSelect = useCallback(
            async (command: string) => {
                // Check if this command has an interactive overlay
                const { getCommandOverlay } = await import('../utils/commandOverlays.js');
                const overlay = getCommandOverlay(command, [], agent);
                if (overlay) {
                    buffer.setText('');
                    setInput((prev) => ({ ...prev, historyIndex: -1 }));
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: overlay,
                        mcpWizardServerType: null,
                    }));
                    return;
                }

                const commandText = `/${command}`;
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                // Show user message for the executed command
                const userMessage = createUserMessage(commandText);
                setMessages((prev) => [...prev, userMessage]);

                setUi((prev) => ({ ...prev, isProcessing: true, isCancelling: false }));

                const { CommandService } = await import('../services/CommandService.js');
                const commandService = new CommandService();

                try {
                    const result = await commandService.executeCommand(
                        command,
                        [],
                        agent,
                        session.id || undefined
                    );

                    if (result.type === 'output' && result.output) {
                        const output = result.output;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('command'),
                                role: 'system',
                                content: output,
                                timestamp: new Date(),
                            },
                        ]);
                    }

                    if (result.type === 'styled' && result.styled) {
                        const { fallbackText, styledType, styledData } = result.styled;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('command'),
                                role: 'system',
                                content: fallbackText,
                                timestamp: new Date(),
                                styledType,
                                styledData,
                            },
                        ]);
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
                            content: `${error instanceof Error ? error.message : String(error)}`,
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
            },
            [setInput, setUi, setMessages, agent, session.id, buffer]
        );

        const handleLoadIntoInput = useCallback(
            (text: string) => {
                // Update both buffer (source of truth) and state
                buffer.setText(text);
                setInput((prev) => ({ ...prev, value: text }));
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
            },
            [buffer, setInput, setUi]
        );

        // Handle resource selection
        const handleResourceSelect = useCallback(
            (resource: ResourceMetadata) => {
                // Insert resource reference into input
                const atIndex = input.value.lastIndexOf('@');
                if (atIndex >= 0) {
                    const before = input.value.slice(0, atIndex + 1);
                    const uriParts = resource.uri.split(/[\\/]/);
                    let reference = resource.name || uriParts[uriParts.length - 1] || resource.uri;

                    // If it's an absolute path, use relative path as reference to be more descriptive and less bulky
                    const rawUri = resource.uri.replace(/^(fs|file):\/\//, ''); // Stripped prefix
                    if (path.isAbsolute(rawUri)) {
                        try {
                            const relativePath = path.relative(process.cwd(), rawUri);
                            // Prioritize relative path for local files to avoid ambiguity
                            reference = relativePath;
                        } catch {
                            // Keep fallback if relative fails
                        }
                    }

                    const newValue = `${before}${reference} `;
                    buffer.setText(newValue);
                    setInput((prev) => ({ ...prev, value: newValue }));
                }
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
            },
            [input.value, buffer, setInput, setUi]
        );

        const handleClose = useCallback(() => {
            setUi((prev) => ({
                ...prev,
                activeOverlay: 'none',
                mcpWizardServerType: null,
                commandOutput: null,
                insufficientCredits: null,
            }));
        }, [setUi]);

        const handleLoginDone = useCallback(
            (outcome: LoginOverlayOutcome) => {
                void (async () => {
                    handleClose();

                    if (outcome.outcome === 'closed') {
                        return;
                    }

                    if (outcome.outcome === 'cancelled') {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: 'Login cancelled.',
                                timestamp: new Date(),
                            },
                        ]);
                        return;
                    }

                    let refreshWarning: string | null = null;
                    if (outcome.hasFiusApiKey) {
                        try {
                            await refreshFiusAuthAfterLogin(agent, session.id || undefined);
                        } catch (error) {
                            refreshWarning = `Logged in, but failed to refresh the active Fius session: ${
                                error instanceof Error ? error.message : String(error)
                            }`;
                        }
                    }

                    const userLabel = outcome.email ? ` as ${outcome.email}` : '';
                    const keyLine = outcome.hasFiusApiKey
                        ? `◈ FIUS_API_KEY ready${outcome.keyId ? ` (Key ID: ${outcome.keyId})` : ''}`
                        : '⚠ Failed to provision FIUS_API_KEY (you can still use your own API keys)';
                    const content = [
                        `✓ Logged in${userLabel}`,
                        keyLine,
                        ...(refreshWarning ? [`⚠ ${refreshWarning}`] : []),
                    ].join('\n');

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content,
                            timestamp: new Date(),
                        },
                    ]);
                })();
            },
            [agent, handleClose, session.id, setMessages]
        );

        const handleLogoutDone = useCallback(
            (outcome: LogoutOverlayOutcome) => {
                handleClose();

                if (outcome.outcome === 'closed') {
                    return;
                }

                if (outcome.outcome === 'cancelled') {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: 'Logout cancelled.',
                            timestamp: new Date(),
                        },
                    ]);
                    return;
                }

                // Auth already cleared by LogoutOverlay. Exit Ink so cli.ts shows login screen.
                triggerLogoutExit();
            },
            [handleClose]
        );

        const handleConnectDone = useCallback(
            async (outcome: ConnectOverlayOutcome) => {
                handleClose();

                if (outcome.outcome === 'closed') {
                    return;
                }

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content:
                            outcome.outcome === 'success'
                                ? `✓ ${outcome.message}`
                                : 'Model provider connection cancelled.',
                        timestamp: new Date(),
                    },
                ]);

                if (outcome.outcome !== 'success') {
                    return;
                }

                const currentConfig = agent.getCurrentLLMConfig();
                if (currentConfig.provider !== outcome.providerId) {
                    return;
                }

                try {
                    await agent.switchLLM(
                        {
                            provider: currentConfig.provider,
                            model: currentConfig.model,
                            ...(currentConfig.baseURL ? { baseURL: currentConfig.baseURL } : {}),
                            ...(currentConfig.reasoning
                                ? { reasoning: currentConfig.reasoning }
                                : {}),
                        }
                    );
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to apply model provider connection: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [agent, handleClose, session.id, setMessages]
        );

        // Handle stream mode selection
        const handleStreamSelect = useCallback(
            (enabled: boolean) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: enabled
                            ? 'Streaming enabled - responses will appear as they are generated'
                            : 'Streaming disabled - responses will appear when complete',
                        timestamp: new Date(),
                    },
                ]);
            },
            [setUi, setInput, setMessages, buffer]
        );

        // Handle access mode selection
        const handleAccessModeSelect = useCallback(
            (mode: 'full' | 'confirm') => {
                setUi((prev) => ({
                    ...prev,
                    activeOverlay: 'none',
                    mcpWizardServerType: null,
                    bypassPermissions: mode === 'full',
                    autoApproveEdits: mode === 'full',
                }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                // Update agent's approval manager so directory-access checks also respect the mode
                agent.setPermissionsMode(mode === 'full' ? 'auto-approve' : 'manual');

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content:
                            mode === 'full'
                                ? '▣ Full Access - all actions will be auto-approved'
                                : '◈ Confirm Actions - AI will ask permission before changes',
                        timestamp: new Date(),
                    },
                ]);
            },
            [setUi, setInput, setMessages, buffer, agent]
        );

        // Handle build mode selection
        const handleBuildModeSelect = useCallback(
            (mode: 'build') => {
                setUi((prev) => ({
                    ...prev,
                    activeOverlay: 'none',
                    mcpWizardServerType: null,
                }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: '▶ Build Mode - AI will implement immediately',
                        timestamp: new Date(),
                    },
                ]);
            },
            [setUi, setInput, setMessages, buffer]
        );

        const handleToggleShowReasoning = useCallback(() => {
            setUi((prev) => ({ ...prev, showReasoning: !prev.showReasoning }));
        }, [setUi]);

        const handleReasoningNotify = useCallback(
            (message: string) => {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `◈ ${message}`,
                        timestamp: new Date(),
                    },
                ]);
            },
            [setMessages]
        );

        const handleSetReasoningBudgetTokens = useCallback(
            async (budgetTokens: number | undefined) => {
                const sessionId = session.id || undefined;
                const current = agent.getCurrentLLMConfig();
                const profile = getReasoningProfile(current.provider, current.model ?? '');
                const defaultVariant = profile.defaultVariant;
                const variant =
                    current.reasoning?.variant ?? defaultVariant ?? profile.supportedVariants[0];
                if (variant === undefined) {
                    return;
                }

                const reasoningUpdate =
                    budgetTokens === undefined &&
                    defaultVariant !== undefined &&
                    variant === defaultVariant
                        ? ({ reasoning: null } as const)
                        : {
                              reasoning: {
                                  variant,
                                  ...(typeof budgetTokens === 'number' ? { budgetTokens } : {}),
                              },
                          };

                await agent.switchLLM(
                    {
                        provider: current.provider,
                        model: current.model,
                        ...reasoningUpdate,
                    }
                );
            },
            [agent, session.id]
        );

        // Handle MCP server list actions (select server or add new)
        const handleMcpServerListAction = useCallback(
            (action: McpServerListAction) => {
                if (action.type === 'select-server') {
                    // Show server actions overlay
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-server-actions',
                        selectedMcpServer: action.server,
                    }));
                } else if (action.type === 'add-new') {
                    // Show add choice overlay
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-add-choice',
                    }));
                }
            },
            [setUi]
        );

        // Handle MCP server actions (enable/disable/delete/back)
        const handleMcpServerAction = useCallback(
            async (action: McpServerAction) => {
                const { server } = action;

                if (action.type === 'back') {
                    // Go back to server list
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-server-list',
                        selectedMcpServer: null,
                    }));
                    return;
                }

                // Close overlay and reset input for actual actions
                setUi((prev) => ({
                    ...prev,
                    activeOverlay: 'none',
                    selectedMcpServer: null,
                    mcpWizardServerType: null,
                    isProcessing: true,
                    isCancelling: false,
                }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                if (action.type === 'enable' || action.type === 'disable') {
                    const newEnabled = action.type === 'enable';
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `${newEnabled ? 'Enabling' : 'Disabling'} ${server.name}...`,
                            timestamp: new Date(),
                        },
                    ]);

                    try {
                        // Enable or disable the server FIRST (before persisting)
                        // This ensures config only reflects successful state changes
                        if (newEnabled) {
                            try {
                                await agent.enableMcpServer(server.name);
                            } catch (connectError) {
                                // Connection failed - don't persist to config
                                setMessages((prev) => [
                                    ...prev,
                                    {
                                        id: generateMessageId('system'),
                                        role: 'system',
                                        content: `⚠ Failed to enable server: ${connectError instanceof Error ? connectError.message : String(connectError)}`,
                                        timestamp: new Date(),
                                    },
                                ]);
                                setUi((prev) => ({
                                    ...prev,
                                    isProcessing: false,
                                    isCancelling: false,
                                    isThinking: false,
                                }));
                                return;
                            }
                        } else {
                            await agent.disableMcpServer(server.name);
                        }

                        // Import persistence utilities
                        const { updateMcpServerField } = await import('@fius/agent-management');

                        // Persist to config file AFTER successful enable/disable
                        const agentPath = getConfigFilePathOrWarn('persist MCP server settings');
                        if (!agentPath) {
                            return;
                        }
                        await updateMcpServerField(agentPath, server.name, 'enabled', newEnabled);

                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `✓ ${server.name} ${newEnabled ? 'enabled' : 'disabled'}`,
                                timestamp: new Date(),
                            },
                        ]);
                    } catch (error) {
                        // Format error message with details if available
                        let errorMessage = error instanceof Error ? error.message : String(error);
                        if (error instanceof FiusValidationError && error.issues.length > 0) {
                            const issueDetails = error.issues
                                .map((i) => {
                                    const path = i.path?.length ? `[${i.path.join('.')}] ` : '';
                                    return `  - ${path}${i.message}`;
                                })
                                .join('\n');
                            errorMessage = `Validation failed:\n${issueDetails}`;
                        }
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('error'),
                                role: 'system',
                                content: `Failed to ${action.type} server: ${errorMessage}`,
                                timestamp: new Date(),
                            },
                        ]);
                    }
                } else if (action.type === 'authenticate') {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `◈ Authenticating ${server.name}...`,
                            timestamp: new Date(),
                        },
                    ]);

                    try {
                        await agent.restartMcpServer(server.name);
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `✓ Authenticated ${server.name}`,
                                timestamp: new Date(),
                            },
                        ]);
                    } catch (error) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('error'),
                                role: 'system',
                                content: `Failed to authenticate server: ${error instanceof Error ? error.message : String(error)}`,
                                timestamp: new Date(),
                            },
                        ]);
                    }
                } else if (action.type === 'delete') {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `◇ Deleting ${server.name}...`,
                            timestamp: new Date(),
                        },
                    ]);

                    try {
                        // Import persistence utilities
                        const { removeMcpServerFromConfig } = await import(
                            '@fius/agent-management'
                        );

                        // Persist to config file using surgical removal
                        const agentPath = getConfigFilePathOrWarn('persist MCP server deletion');
                        if (agentPath) {
                            await removeMcpServerFromConfig(agentPath, server.name);
                        }

                        // Also disconnect if connected
                        try {
                            await agent.removeMcpServer(server.name);
                        } catch {
                            // Ignore - server might not be connected
                        }

                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `✓ Deleted ${server.name}`,
                                timestamp: new Date(),
                            },
                        ]);
                    } catch (error) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('error'),
                                role: 'system',
                                content: `Failed to delete server: ${error instanceof Error ? error.message : String(error)}`,
                                timestamp: new Date(),
                            },
                        ]);
                    }
                }

                setUi((prev) => ({
                    ...prev,
                    isProcessing: false,
                    isCancelling: false,
                    isThinking: false,
                }));
            },
            [setUi, setInput, setMessages, agent, buffer]
        );

        // Handle skill selector actions (select skill)
        const handleSkillSelectorAction = useCallback(
            (action: SkillSelectorAction) => {
                if (action.type === 'select-skill') {
                    // Show skill actions overlay
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'skill-actions',
                        selectedSkill: {
                            id: action.skill.id,
                            displayName: action.skill.displayName || action.skill.id,
                            description: action.skill.description,
                            enabled: action.skill.enabled,
                        },
                    }));
                }
            },
            [setUi]
        );

        // Handle skill action results (toggled/removed/read/close)
        const handleSkillActionResult = useCallback(
            (result: SkillActionResult) => {
                if (result.type === 'toggled') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'skills-list',
                        selectedSkill: null,
                    }));
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Skill '${result.skillId}' ${result.enabled ? 'enabled' : 'disabled'}`,
                            timestamp: new Date(),
                        },
                    ]);
                } else if (result.type === 'removed') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'skills-list',
                        selectedSkill: null,
                    }));
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Skill '${result.skillId}' removed`,
                            timestamp: new Date(),
                        },
                    ]);
                } else if (result.type === 'read') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'skills-list',
                        selectedSkill: null,
                    }));
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `☰ ${result.displayName || result.skillId}:\n\n${result.instructions}`,
                            timestamp: new Date(),
                        },
                    ]);
                } else if (result.type === 'close') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'skills-list',
                        selectedSkill: null,
                    }));
                }
            },
            [setUi, setMessages]
        );

        // Handle MCP add choice (registry/custom/back)
        const handleMcpAddChoice = useCallback(
            (choice: McpAddChoiceType) => {
                if (choice === 'back') {
                    // Go back to server list
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-server-list',
                    }));
                } else if (choice === 'registry') {
                    // Show GitHub MCP browser
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-github-browser',
                    }));
                } else if (choice === 'custom') {
                    // Show custom type selector
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-custom-type-selector',
                    }));
                }
            },
            [setUi]
        );

        // Handle MCP add selection (presets only)
        const handleMcpAddSelect = useCallback(
            async (result: McpAddResult) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));
                setUi((prev) => ({ ...prev, isProcessing: true, isCancelling: false }));

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `⊡ Connecting to ${result.entry.name}...`,
                        timestamp: new Date(),
                    },
                ]);

                try {
                    const mcpConfig = result.entry.config as McpServerConfig;
                    await agent.addMcpServer(result.entry.id, mcpConfig);

                    // Track MCP server connected analytics
                    captureAnalytics('fius_mcp_server_connected', {
                        source: 'cli',
                        serverName: result.entry.name,
                        transportType: mcpConfig.type,
                    });

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Connected to ${result.entry.name}`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
                setUi((prev) => ({
                    ...prev,
                    isProcessing: false,
                    isCancelling: false,
                    isThinking: false,
                }));
            },
            [setUi, setInput, setMessages, agent, buffer]
        );

        // Handle GitHub MCP browser selection — ask AI to install the server
        const handleMcpGithubBrowserSelect = useCallback(
            async (result: McpGithubBrowserResult) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                // Fetch install hint from README
                let installHint = '';
                try {
                    const { fetchInstallHint } = await import('../utils/github-mcp-fetcher.js');
                    const hint = await fetchInstallHint({
                        repoUrl: result.repoUrl,
                    } as any);
                    if (hint) {
                        installHint = ` ${hint.args.join(' ')}`;
                    }
                } catch {
                    // Ignore — AI will figure it out
                }

                const promptText = `Install the MCP server "${result.displayName}" from ${result.repoUrl}. The install command is: npx${installHint}. Add it to MCP using the addMcpServer tool with type "stdio", command "npx", and args from the command above. Do NOT create or edit any config files manually.`;

                if (onSubmitPromptCommand) {
                    await onSubmitPromptCommand(promptText);
                }
            },
            [setUi, setInput, setMessages, buffer, onSubmitPromptCommand]
        );

        // Handle MCP custom type selection
        const handleMcpCustomTypeSelect = useCallback(
            (serverType: McpServerType) => {
                setUi((prev) => ({
                    ...prev,
                    mcpWizardServerType: serverType,
                    activeOverlay: 'mcp-custom-wizard',
                }));
            },
            [setUi]
        );

        // Handle MCP custom wizard completion
        const handleMcpCustomWizardComplete = useCallback(
            async (config: McpCustomConfig) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));
                setUi((prev) => ({ ...prev, isProcessing: true, isCancelling: false }));

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `⊡ Connecting to ${config.name}...`,
                        timestamp: new Date(),
                    },
                ]);

                try {
                    // Build the appropriate config based on server type
                    let serverConfig: McpServerConfig;
                    if (config.serverType === 'stdio') {
                        serverConfig = {
                            type: 'stdio',
                            command: config.command!,
                            args: config.args || [],
                        };
                    } else if (config.serverType === 'http') {
                        serverConfig = {
                            type: 'http',
                            url: config.url!,
                        };
                    } else {
                        // sse
                        serverConfig = {
                            type: 'sse',
                            url: config.url!,
                        };
                    }

                    await agent.addMcpServer(config.name, serverConfig);

                    // Track MCP server connected analytics
                    captureAnalytics('fius_mcp_server_connected', {
                        source: 'cli',
                        serverName: config.name,
                        transportType: serverConfig.type,
                    });

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Connected to ${config.name}`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
                setUi((prev) => ({
                    ...prev,
                    isProcessing: false,
                    isCancelling: false,
                    isThinking: false,
                }));
            },
            [setUi, setInput, setMessages, agent, buffer]
        );

        // Handle plugin manager actions
        const handlePluginManagerAction = useCallback(
            (action: PluginAction) => {
                if (action === 'list') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'plugin-list',
                    }));
                } else if (action === 'github') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'plugin-github',
                    }));
                } else if (action === 'add-custom') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'custom-plugin-install',
                    }));
                } else if (action === 'marketplace') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'marketplace-browser',
                    }));
                }
            },
            [setUi]
        );

        // Handle plugin selection from plugin list
        const handlePluginSelect = useCallback(
            (plugin: ListedPlugin) => {
                setSelectedPlugin(plugin);
                setUi((prev) => ({
                    ...prev,
                    activeOverlay: 'plugin-actions',
                }));
            },
            [setUi]
        );

        // Handle plugin actions (uninstall, back)
        const handlePluginAction = useCallback(
            async (action: PluginActionResult) => {
                if (action.type === 'back') {
                    setSelectedPlugin(null);
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'plugin-list',
                    }));
                    return;
                }

                if (action.type === 'uninstall') {
                    setUi((prev) => ({ ...prev, activeOverlay: 'none', isProcessing: true }));

                    try {
                        const { uninstallPlugin, reloadAgentConfigFromFile, enrichAgentConfig } =
                            await import('@fius/agent-management');
                        await uninstallPlugin(action.plugin.name);

                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `Plugin '${action.plugin.name}' has been uninstalled.`,
                                timestamp: new Date(),
                            },
                        ]);

                        // Refresh prompts to remove uninstalled plugin commands.
                        try {
                            const agentPath = getConfigFilePathOrWarn(
                                'refresh prompts after plugin uninstall'
                            );
                            if (!agentPath) {
                                return;
                            }
                            const newConfig = await reloadAgentConfigFromFile(agentPath);
                            const enrichedConfig = enrichAgentConfig(newConfig, agentPath);
                            await agent.refreshPrompts(enrichedConfig.prompts);
                        } catch {
                            // Non-critical: prompts will refresh on next agent restart
                        }
                    } catch (error) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('error'),
                                role: 'system',
                                content: `Failed to uninstall plugin: ${error instanceof Error ? error.message : String(error)}`,
                                timestamp: new Date(),
                            },
                        ]);
                    }

                    setSelectedPlugin(null);
                    setUi((prev) => ({ ...prev, isProcessing: false }));
                }
            },
            [setUi, setMessages, agent, getConfigFilePathOrWarn]
        );

        // Handle plugin GitHub browser selection
        const handlePluginGithubSelect = useCallback(
            async (result: PluginGithubBrowserResult) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none', isProcessing: true }));
                try {
                    const { installPluginFromMarketplace, addMarketplace, marketplaceExists } = await import('@fius/agent-management');
                    const marketplaceName = 'anthropics/claude-plugins-official';

                    // Register marketplace if not already registered
                    if (!marketplaceExists(marketplaceName)) {
                        await addMarketplace(marketplaceName, { name: marketplaceName });
                    }

                    const installName = `${result.id}@${marketplaceName}`;
                    const installResult = await installPluginFromMarketplace(installName, { scope: 'user' });

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Plugin '${installResult.pluginName}' installed from ${installResult.marketplace}`,
                            timestamp: new Date(),
                        },
                    ]);

                    try {
                        const { reloadAgentConfigFromFile, enrichAgentConfig } = await import('@fius/agent-management');
                        const agentPath = getConfigFilePathOrWarn('refresh prompts after plugin install');
                        if (agentPath) {
                            const newConfig = await reloadAgentConfigFromFile(agentPath);
                            const enrichedConfig = enrichAgentConfig(newConfig, agentPath);
                            await agent.refreshPrompts(enrichedConfig.prompts);
                        }
                    } catch {
                        // Non-critical
                    }
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to install plugin: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                } finally {
                    setUi((prev) => ({ ...prev, isProcessing: false }));
                }
            },
            [setUi, setMessages, agent, getConfigFilePathOrWarn]
        );

        // Handle custom plugin install completion
        const handleCustomPluginInstallComplete = useCallback(
            async (pluginName: string) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `✓ Plugin '${pluginName}' installed`,
                        timestamp: new Date(),
                    },
                ]);

                try {
                    const { reloadAgentConfigFromFile, enrichAgentConfig } = await import('@fius/agent-management');
                    const agentPath = getConfigFilePathOrWarn('refresh prompts after plugin install');
                    if (agentPath) {
                        const newConfig = await reloadAgentConfigFromFile(agentPath);
                        const enrichedConfig = enrichAgentConfig(newConfig, agentPath);
                        await agent.refreshPrompts(enrichedConfig.prompts);
                    }
                } catch {
                    // Non-critical
                }
            },
            [setUi, setMessages, agent, getConfigFilePathOrWarn]
        );

        // Handle marketplace browser actions
        const handleMarketplaceBrowserAction = useCallback(
            async (action: MarketplaceBrowserAction) => {
                if (action.type === 'add-marketplace') {
                    setUi((prev) => ({ ...prev, activeOverlay: 'marketplace-add' }));
                } else if (action.type === 'plugin-installed') {
                    setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Plugin '${action.pluginName}' installed from ${action.marketplace}`,
                            timestamp: new Date(),
                        },
                    ]);

                    // Refresh prompts to include new plugin commands.
                    try {
                        const { reloadAgentConfigFromFile, enrichAgentConfig } = await import(
                            '@fius/agent-management'
                        );
                        const agentPath = getConfigFilePathOrWarn(
                            'refresh prompts after plugin install'
                        );
                        if (!agentPath) {
                            return;
                        }
                        const newConfig = await reloadAgentConfigFromFile(agentPath);
                        const enrichedConfig = enrichAgentConfig(newConfig, agentPath);
                        await agent.refreshPrompts(enrichedConfig.prompts);
                    } catch (error) {
                        // Non-critical: prompts will refresh on next agent restart
                        // Log but don't show error to user
                    }
                }
            },
            [setUi, setMessages, agent, getConfigFilePathOrWarn]
        );

        // Handle marketplace add completion
        const handleMarketplaceAddComplete = useCallback(
            (name: string, pluginCount: number) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'marketplace-browser' }));
                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `✓ Marketplace '${name}' added (${pluginCount} plugins found)`,
                        timestamp: new Date(),
                    },
                ]);
            },
            [setUi, setMessages]
        );

        // Handle session subcommand selection
        const handleSessionSubcommandSelect = useCallback(
            async (action: SessionAction) => {
                if (action === 'switch') {
                    setInput((prev) => ({ ...prev, value: '/session switch' }));
                    setUi((prev) => ({ ...prev, activeOverlay: 'session-selector' }));
                    return;
                }

                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));
                setUi((prev) => ({ ...prev, isProcessing: true, isCancelling: false }));

                try {
                    const { CommandService } = await import('../services/CommandService.js');
                    const commandService = new CommandService();
                    const result = await commandService.executeCommand(
                        'session',
                        [action],
                        agent,
                        session.id || undefined
                    );

                    if (result.type === 'output' && result.output) {
                        const output = result.output;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('command'),
                                role: 'system',
                                content: output,
                                timestamp: new Date(),
                            },
                        ]);
                    }
                    if (result.type === 'styled' && result.styled) {
                        const { fallbackText, styledType, styledData } = result.styled;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('command'),
                                role: 'system',
                                content: fallbackText,
                                timestamp: new Date(),
                                styledType,
                                styledData,
                            },
                        ]);
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
                            content: `${error instanceof Error ? error.message : String(error)}`,
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
            },
            [setInput, setUi, setMessages, agent, session.id, buffer]
        );

        // Handle prompt list actions (select/add/delete)
        const handlePromptListAction = useCallback(
            async (action: PromptListAction) => {
                if (action.type === 'add-prompt') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'prompt-add-choice',
                    }));
                } else if (action.type === 'delete-prompt') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'prompt-delete-selector',
                    }));
                } else if (action.type === 'select-prompt') {
                    // Execute the prompt
                    const displayName = action.prompt.displayName || action.prompt.name;
                    const commandText = `/${displayName}`;
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'none',
                        promptAddWizard: null,
                    }));
                    buffer.setText('');
                    setInput((prev) => ({ ...prev, historyIndex: -1 }));

                    // Route through streaming pipeline
                    if (onSubmitPromptCommand) {
                        await onSubmitPromptCommand(commandText);
                    }
                }
            },
            [setUi, setInput, buffer, onSubmitPromptCommand]
        );

        // Handle prompt list load into input
        const handlePromptLoadIntoInput = useCallback(
            (text: string) => {
                buffer.setText(text);
                setInput((prev) => ({ ...prev, value: text }));
                setUi((prev) => ({
                    ...prev,
                    activeOverlay: 'none',
                    promptAddWizard: null,
                }));
            },
            [buffer, setInput, setUi]
        );

        // Handle prompt add choice (agent vs shared)
        const handlePromptAddChoice = useCallback(
            (choice: PromptAddChoiceResult) => {
                if (choice === 'back') {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'prompt-list',
                    }));
                } else {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'prompt-add-wizard',
                        promptAddWizard: {
                            scope: choice,
                            step: 'name',
                            name: '',
                            title: '',
                            description: '',
                            content: '',
                        },
                    }));
                }
            },
            [setUi]
        );

        // Handle prompt add wizard completion
        const handlePromptAddComplete = useCallback(
            async (data: NewPromptData) => {
                const scope = ui.promptAddWizard?.scope || 'agent';
                setUi((prev) => ({
                    ...prev,
                    activeOverlay: 'none',
                    promptAddWizard: null,
                }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `✎ Creating ${scope === 'shared' ? 'shared' : 'agent'} prompt "${data.name}"...`,
                        timestamp: new Date(),
                    },
                ]);

                try {
                    const { mkdir, writeFile } = await import('fs/promises');
                    const { dirname, join } = await import('path');

                    // Validate prompt name to prevent path traversal
                    const SAFE_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;
                    if (!SAFE_NAME_PATTERN.test(data.name)) {
                        throw new Error(
                            `Invalid prompt name "${data.name}". Names must start with a letter or number and contain only letters, numbers, hyphens, and underscores.`
                        );
                    }

                    // Build frontmatter
                    const frontmatterLines = [
                        '---',
                        `id: ${data.name}`,
                        data.title ? `title: "${data.title}"` : null,
                        data.description ? `description: "${data.description}"` : null,
                        data.argumentHint ? `argument-hint: ${data.argumentHint}` : null,
                        '---',
                    ].filter(Boolean);

                    const fileContent = `${frontmatterLines.join('\n')}\n\n${data.content}\n`;

                    let filePath: string;

                    if (scope === 'shared') {
                        // Create in commands directory based on execution context
                        // Matches discovery logic in discoverCommandPrompts()
                        const {
                            getExecutionContext,
                            findFiusSourceRoot,
                            findFiusProjectRoot,
                            getFiusGlobalPath,
                        } = await import('@fius/agent-management');

                        const context = getExecutionContext();
                        let commandsDir: string;

                        if (context === 'fius-source') {
                            const isDevMode = process.env.FIUS_DEV_MODE === 'true';
                            if (isDevMode) {
                                const sourceRoot = findFiusSourceRoot();
                                commandsDir = sourceRoot
                                    ? join(sourceRoot, 'commands')
                                    : getFiusGlobalPath('commands');
                            } else {
                                commandsDir = getFiusGlobalPath('commands');
                            }
                        } else if (context === 'fius-project') {
                            const projectRoot = findFiusProjectRoot();
                            commandsDir = projectRoot
                                ? join(projectRoot, 'commands')
                                : getFiusGlobalPath('commands');
                        } else {
                            // global-cli
                            commandsDir = getFiusGlobalPath('commands');
                        }

                        filePath = join(commandsDir, `${data.name}.md`);
                        await mkdir(commandsDir, { recursive: true });
                        await writeFile(filePath, fileContent, 'utf-8');

                        // Re-discover commands and refresh with enriched prompts
                        const { reloadAgentConfigFromFile, enrichAgentConfig } = await import(
                            '@fius/agent-management'
                        );
                        const agentPath = getConfigFilePathOrWarn(
                            'refresh prompts after creating shared prompt'
                        );
                        if (!agentPath) {
                            return;
                        }
                        const newConfig = await reloadAgentConfigFromFile(agentPath);
                        const enrichedConfig = enrichAgentConfig(newConfig, agentPath);
                        await agent.refreshPrompts(enrichedConfig.prompts);
                    } else {
                        // Create in agent's prompts directory
                        const agentPath = getConfigFilePathOrWarn(
                            'create prompt in agent prompts directory'
                        );
                        if (!agentPath) {
                            return;
                        }
                        const agentDir = dirname(agentPath);
                        const promptsDir = join(agentDir, 'prompts');
                        filePath = join(promptsDir, `${data.name}.md`);
                        await mkdir(promptsDir, { recursive: true });
                        await writeFile(filePath, fileContent, 'utf-8');

                        // Add file reference to agent config using surgical helper
                        const {
                            addPromptToAgentConfig,
                            reloadAgentConfigFromFile,
                            enrichAgentConfig,
                        } = await import('@fius/agent-management');
                        await addPromptToAgentConfig(agentPath, {
                            type: 'file',
                            file: `\${{fius.agent_dir}}/prompts/${data.name}.md`,
                        });

                        // Reload config from disk, enrich to include discovered commands, then refresh
                        const newConfig = await reloadAgentConfigFromFile(agentPath);
                        const enrichedConfig = enrichAgentConfig(newConfig, agentPath);
                        await agent.refreshPrompts(enrichedConfig.prompts);
                    }

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Created prompt "${data.name}"\n▤ File: ${filePath}\n\nUse /${data.name} to run it.`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to create prompt: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [
                ui.promptAddWizard?.scope,
                setUi,
                setInput,
                setMessages,
                buffer,
                agent,
                getConfigFilePathOrWarn,
            ]
        );

        // Handle prompt delete
        const handlePromptDelete = useCallback(
            async (deletable: DeletablePrompt) => {
                const displayName = deletable.prompt.displayName || deletable.prompt.name;

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `◇ Deleting prompt "${displayName}"...`,
                        timestamp: new Date(),
                    },
                ]);

                try {
                    const { deletePromptByMetadata, reloadAgentConfigFromFile, enrichAgentConfig } =
                        await import('@fius/agent-management');

                    const agentPath = getConfigFilePathOrWarn('delete prompt');
                    if (!agentPath) {
                        return;
                    }

                    // Use the higher-level delete function that handles file + config
                    // Pass full metadata including originalId for inline prompt deletion
                    const promptMetadata = deletable.prompt.metadata as
                        | { filePath?: string; originalId?: string }
                        | undefined;
                    const result = await deletePromptByMetadata(
                        agentPath,
                        {
                            name: deletable.prompt.name,
                            metadata: {
                                filePath: deletable.filePath,
                                originalId: promptMetadata?.originalId,
                            },
                        },
                        { deleteFile: true }
                    );

                    if (!result.success) {
                        throw new Error(result.error || 'Failed to delete prompt');
                    }

                    // Reload config from disk, enrich to include discovered commands, then refresh
                    const newConfig = await reloadAgentConfigFromFile(agentPath);
                    const enrichedConfig = enrichAgentConfig(newConfig, agentPath);
                    await agent.refreshPrompts(enrichedConfig.prompts);

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Deleted prompt "${displayName}"`,
                            timestamp: new Date(),
                        },
                    ]);

                    // Return to prompt list and refresh
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'prompt-list',
                    }));
                    promptListRef.current?.refresh();
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to delete prompt: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);

                    // Return to prompt list even on error
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'prompt-list',
                    }));
                }
            },
            [setUi, setMessages, agent, getConfigFilePathOrWarn]
        );

        // Handle prompt add wizard close
        const handlePromptAddWizardClose = useCallback(() => {
            setUi((prev) => ({
                ...prev,
                activeOverlay: 'prompt-add-choice',
                promptAddWizard: null,
            }));
        }, [setUi]);

        // Handle prompt delete selector close
        const handlePromptDeleteClose = useCallback(() => {
            setUi((prev) => ({
                ...prev,
                activeOverlay: 'prompt-list',
            }));
            // Refresh prompt list to show updated list
            promptListRef.current?.refresh();
        }, [setUi]);

        // Handle prompt add choice close
        const handlePromptAddChoiceClose = useCallback(() => {
            setUi((prev) => ({
                ...prev,
                activeOverlay: 'prompt-list',
            }));
        }, [setUi]);

        // State for current session title (for rename overlay)
        const [currentSessionTitle, setCurrentSessionTitle] = useState<string | undefined>(
            undefined
        );

        // Fetch current session title when rename overlay opens
        React.useEffect(() => {
            if (ui.activeOverlay === 'session-rename' && session.id) {
                void agent.getSessionTitle(session.id).then(setCurrentSessionTitle);
            }
        }, [ui.activeOverlay, session.id, agent]);

        // Handle session rename
        const handleSessionRename = useCallback(
            async (newTitle: string) => {
                if (!session.id) return;

                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                buffer.setText('');
                setInput((prev) => ({ ...prev, historyIndex: -1 }));

                try {
                    await agent.setSessionTitle(session.id, newTitle);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✓ Session renamed to: ${newTitle}`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to rename session: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [session.id, setUi, setInput, setMessages, agent, buffer]
        );

        // Handle session rename close
        const handleSessionRenameClose = useCallback(() => {
            setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
        }, [setUi]);

        const currentLLMConfig = agent.getCurrentLLMConfig();
        const chatGPTFallbackTarget = resolveChatGPTFallbackModel(currentLLMConfig.model ?? '');
        const chatGPTFallbackKeyStatus = getProviderKeyStatus(chatGPTFallbackTarget.provider);

        const hideCliChrome = shouldHideCliChrome(ui.activeOverlay, approval);

        const overlayContent = (
            <>
                {/* Approval prompt */}
                {approval && (
                    <ApprovalPrompt
                        ref={approvalRef}
                        approval={approval}
                        onApprove={handleApprove}
                        onDeny={handleDeny}
                        onCancel={handleCancelApproval}
                    />
                )}

                {/* Slash command autocomplete */}
                {ui.activeOverlay === 'slash-autocomplete' && (
                    <Box marginTop={1}>
                        <SlashCommandAutocomplete
                            ref={slashAutocompleteRef}
                            isVisible={true}
                            searchQuery={input.value}
                            onSelectPrompt={handlePromptSelect}
                            onSelectSystemCommand={handleSystemCommandSelect}
                            onLoadIntoInput={handleLoadIntoInput}
                            onSubmitRaw={onSubmitPromptCommand}
                            onClose={handleClose}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* Resource autocomplete */}
                {ui.activeOverlay === 'resource-autocomplete' && (
                    <Box marginTop={1}>
                        <ResourceAutocomplete
                            ref={resourceAutocompleteRef}
                            isVisible={true}
                            searchQuery={input.value}
                            onSelectResource={handleResourceSelect}
                            onLoadIntoInput={handleLoadIntoInput}
                            onClose={handleClose}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* Model selector */}
                {ui.activeOverlay === 'model-selector' && (
                    <Box marginTop={1}>
                        <ModelSelectorRefactored
                            ref={modelSelectorRef}
                            isVisible={true}
                            onSelectModel={handleModelSelect}
                            onSetDefaultModel={handleSetDefaultModel}
                            onClose={handleClose}
                            onAddCustomModel={handleAddCustomModel}
                            onEditCustomModel={handleEditCustomModel}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* Providers selector */}
                {ui.activeOverlay === 'providers-selector' && (
                    <Box marginTop={1}>
                        <ProvidersOverlay
                            ref={providersOverlayRef}
                            isVisible={true}
                            onClose={handleClose}
                            onAddCustomProvider={() => {
                                setUi((prev) => ({ ...prev, activeOverlay: 'models-dev-browser' }));
                            }}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* Models.dev browser */}
                {ui.activeOverlay === 'models-dev-browser' && (
                    <Box marginTop={1}>
                        <ModelsDevBrowser
                            ref={modelsDevBrowserRef}
                            isVisible={true}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Reasoning configuration */}
                {ui.activeOverlay === 'reasoning' && (
                    <Box marginTop={1}>
                        <ReasoningOverlay
                            ref={reasoningOverlayRef}
                            isVisible={true}
                            agent={agent}
                            sessionId={session.id}
                            showReasoning={ui.showReasoning}
                            onToggleShowReasoning={handleToggleShowReasoning}
                            onSetBudgetTokens={handleSetReasoningBudgetTokens}
                            onNotify={handleReasoningNotify}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Session selector */}
                {ui.activeOverlay === 'session-selector' && (
                    <Box marginTop={1}>
                        <SessionSelectorRefactored
                            ref={sessionSelectorRef}
                            isVisible={true}
                            onSelectSession={handleSessionSelect}
                            onDeleteSession={handleSessionDelete}
                            onClose={handleClose}
                            agent={agent}
                            currentSessionId={session.id || undefined}
                        />
                    </Box>
                )}

                {/* Stream mode selector */}
                {ui.activeOverlay === 'stream-selector' && (
                    <Box marginTop={1}>
                        <StreamSelector
                            ref={streamSelectorRef}
                            isVisible={true}
                            onSelect={handleStreamSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Access mode selector */}
                {ui.activeOverlay === 'access-mode-selector' && (
                    <Box marginTop={1}>
                        <AccessModeSelector
                            ref={accessModeSelectorRef}
                            isVisible={true}
                            bypassPermissions={ui.bypassPermissions}
                            onSelect={handleAccessModeSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Build mode selector */}
                {ui.activeOverlay === 'build-mode-selector' && (
                    <Box marginTop={1}>
                        <BuildModeSelector
                            ref={buildModeSelectorRef}
                            isVisible={true}
                            onSelect={handleBuildModeSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Sounds selector */}
                {ui.activeOverlay === 'sounds-selector' && (
                    <Box marginTop={1}>
                        <SoundsSelector
                            ref={soundsSelectorRef}
                            isVisible={true}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Tool browser */}
                {ui.activeOverlay === 'tool-browser' && (
                    <Box marginTop={1}>
                        <ToolBrowser
                            ref={toolBrowserRef}
                            isVisible={true}
                            onClose={handleClose}
                            agent={agent}
                            sessionId={session.id}
                        />
                    </Box>
                )}

                {/* Command output modal */}
                {ui.activeOverlay === 'command-output' && ui.commandOutput && (
                    <Box marginTop={1}>
                        <CommandOutputOverlay
                            ref={commandOutputRef}
                            isVisible={true}
                            title={ui.commandOutput.title}
                            content={ui.commandOutput.content}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP server list (first screen) */}
                {ui.activeOverlay === 'mcp-server-list' && (
                    <Box marginTop={1}>
                        <McpServerList
                            ref={mcpServerListRef}
                            isVisible={true}
                            onAction={handleMcpServerListAction}
                            onClose={handleClose}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* MCP server actions (enable/disable/delete) */}
                {ui.activeOverlay === 'mcp-server-actions' && ui.selectedMcpServer && (
                    <Box marginTop={1}>
                        <McpServerActions
                            ref={mcpServerActionsRef}
                            isVisible={true}
                            server={ui.selectedMcpServer}
                            onAction={handleMcpServerAction}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Skills list */}
                {ui.activeOverlay === 'skills-list' && (
                    <Box marginTop={1}>
                        <SkillsSelector
                            ref={skillsSelectorRef}
                            isVisible={true}
                            onAction={handleSkillSelectorAction}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Skill actions (enable/disable/remove) */}
                {ui.activeOverlay === 'skill-actions' && ui.selectedSkill && (
                    <Box marginTop={1}>
                        <SkillActions
                            ref={skillActionsRef}
                            isVisible={true}
                            skill={ui.selectedSkill}
                            onResult={handleSkillActionResult}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP add choice (registry vs custom) */}
                {ui.activeOverlay === 'mcp-add-choice' && (
                    <Box marginTop={1}>
                        <McpAddChoice
                            ref={mcpAddChoiceRef}
                            isVisible={true}
                            onSelect={handleMcpAddChoice}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP add selector (registry presets) */}
                {ui.activeOverlay === 'mcp-add-selector' && (
                    <Box marginTop={1}>
                        <McpAddSelector
                            ref={mcpAddSelectorRef}
                            isVisible={true}
                            onSelect={handleMcpAddSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* GitHub MCP servers browser */}
                {ui.activeOverlay === 'mcp-github-browser' && (
                    <Box marginTop={1}>
                        <McpGithubBrowser
                            ref={mcpGithubBrowserRef}
                            isVisible={true}
                            onSelect={handleMcpGithubBrowserSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP custom type selector */}
                {ui.activeOverlay === 'mcp-custom-type-selector' && (
                    <Box marginTop={1}>
                        <McpCustomTypeSelector
                            ref={mcpCustomTypeSelectorRef}
                            isVisible={true}
                            onSelect={handleMcpCustomTypeSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP custom wizard */}
                {ui.activeOverlay === 'mcp-custom-wizard' && ui.mcpWizardServerType && (
                    <McpCustomWizard
                        ref={mcpCustomWizardRef}
                        isVisible={true}
                        serverType={ui.mcpWizardServerType}
                        onComplete={handleMcpCustomWizardComplete}
                        onClose={handleClose}
                    />
                )}

                {/* Custom model wizard */}
                {ui.activeOverlay === 'custom-model-wizard' && (
                    <CustomModelWizard
                        ref={customModelWizardRef}
                        isVisible={true}
                        onComplete={handleCustomModelComplete}
                        onClose={() => {
                            setEditingModel(null);
                            handleClose();
                        }}
                        initialModel={editingModel}
                    />
                )}

                {/* Plugin manager */}
                {ui.activeOverlay === 'plugin-manager' && (
                    <Box marginTop={1}>
                        <PluginManager
                            ref={pluginManagerRef}
                            isVisible={true}
                            onAction={handlePluginManagerAction}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Plugin list */}
                {ui.activeOverlay === 'plugin-list' && (
                    <Box marginTop={1}>
                        <PluginList
                            ref={pluginListRef}
                            isVisible={true}
                            onPluginSelect={handlePluginSelect}
                            onBack={() => {
                                setUi((prev) => ({
                                    ...prev,
                                    activeOverlay: 'plugin-manager',
                                }));
                            }}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Plugin actions */}
                {ui.activeOverlay === 'plugin-actions' && (
                    <Box marginTop={1}>
                        <PluginActions
                            ref={pluginActionsRef}
                            isVisible={true}
                            plugin={selectedPlugin}
                            onAction={handlePluginAction}
                            onClose={() => {
                                setSelectedPlugin(null);
                                setUi((prev) => ({
                                    ...prev,
                                    activeOverlay: 'plugin-list',
                                }));
                            }}
                        />
                    </Box>
                )}

                {/* Plugin GitHub browser */}
                {ui.activeOverlay === 'plugin-github' && (
                    <Box marginTop={1}>
                        <PluginGithubBrowser
                            ref={pluginGithubBrowserRef}
                            isVisible={true}
                            onSelect={handlePluginGithubSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Custom plugin install */}
                {ui.activeOverlay === 'custom-plugin-install' && (
                    <Box marginTop={1}>
                        <CustomPluginInstallPrompt
                            ref={customPluginInstallRef}
                            isVisible={true}
                            onComplete={handleCustomPluginInstallComplete}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Marketplace browser */}
                {ui.activeOverlay === 'marketplace-browser' && (
                    <Box marginTop={1}>
                        <MarketplaceBrowser
                            ref={marketplaceBrowserRef}
                            isVisible={true}
                            onAction={handleMarketplaceBrowserAction}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* Marketplace add prompt */}
                {ui.activeOverlay === 'marketplace-add' && (
                    <Box marginTop={1}>
                        <MarketplaceAddPrompt
                            ref={marketplaceAddPromptRef}
                            isVisible={true}
                            onComplete={handleMarketplaceAddComplete}
                            onClose={() =>
                                setUi((prev) => ({ ...prev, activeOverlay: 'marketplace-browser' }))
                            }
                        />
                    </Box>
                )}

                {/* Session subcommand selector */}
                {ui.activeOverlay === 'session-subcommand-selector' && (
                    <Box marginTop={1}>
                        <SessionSubcommandSelector
                            ref={sessionSubcommandSelectorRef}
                            isVisible={true}
                            onSelect={handleSessionSubcommandSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* ChatGPT usage-cap recovery */}
                {ui.activeOverlay === 'chatgpt-usage-cap' && (
                    <Box marginTop={1}>
                        <ChatGPTUsageCapOverlay
                            ref={chatGPTUsageCapRef}
                            isVisible={true}
                            currentModelDisplayName={session.modelName}
                            fallbackModelDisplayName={chatGPTFallbackTarget.displayName}
                            usedDefaultFallback={chatGPTFallbackTarget.usedDefaultFallback}
                            apiKeyConfigured={chatGPTFallbackKeyStatus.hasApiKey}
                            status={ui.chatgptRateLimitStatus}
                            onConfirm={handleChatGPTUsageCapConfirm}
                            onClose={handleChatGPTUsageCapClose}
                        />
                    </Box>
                )}

                {ui.activeOverlay === 'insufficient-credits' && ui.insufficientCredits && (
                    <Box marginTop={1}>
                        <InsufficientCreditsOverlay
                            ref={insufficientCreditsRef}
                            isVisible={true}
                            initialBalanceUsd={ui.insufficientCredits.balanceUsd}
                            onResolved={handleInsufficientCreditsResolved}
                            onClose={handleInsufficientCreditsClose}
                        />
                    </Box>
                )}

                {/* Login */}
                {ui.activeOverlay === 'login' && (
                    <Box marginTop={1}>
                        <LoginOverlay
                            ref={loginOverlayRef}
                            isVisible={true}
                            onDone={handleLoginDone}
                        />
                    </Box>
                )}

                {/* Logout */}
                {ui.activeOverlay === 'logout' && (
                    <Box marginTop={1}>
                        <LogoutOverlay
                            ref={logoutOverlayRef}
                            isVisible={true}
                            onDone={handleLogoutDone}
                        />
                    </Box>
                )}

                {/* Connect model provider */}
                {ui.activeOverlay === 'connect' && (
                    <Box marginTop={1}>
                        <ConnectOverlay
                            ref={connectOverlayRef}
                            isVisible={true}
                            onDone={handleConnectDone}
                        />
                    </Box>
                )}

                {/* API key input */}
                {ui.activeOverlay === 'api-key-input' && ui.pendingModelSwitch && (
                    <ApiKeyInput
                        ref={apiKeyInputRef}
                        isVisible={true}
                        provider={ui.pendingModelSwitch.provider}
                        onSaved={handleApiKeySaved}
                        onClose={handleApiKeyClose}
                    />
                )}

                {/* Search overlay */}
                {ui.activeOverlay === 'search' && (
                    <SearchOverlay
                        ref={searchOverlayRef}
                        isVisible={true}
                        agent={agent}
                        onClose={handleClose}
                        onSelectResult={handleSearchResultSelect}
                    />
                )}

                {/* Prompt list */}
                {ui.activeOverlay === 'prompt-list' && (
                    <Box marginTop={1}>
                        <PromptList
                            ref={promptListRef}
                            isVisible={true}
                            onAction={handlePromptListAction}
                            onLoadIntoInput={handlePromptLoadIntoInput}
                            onClose={handleClose}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* Prompt add choice */}
                {ui.activeOverlay === 'prompt-add-choice' && (
                    <Box marginTop={1}>
                        <PromptAddChoice
                            ref={promptAddChoiceRef}
                            isVisible={true}
                            onSelect={handlePromptAddChoice}
                            onClose={handlePromptAddChoiceClose}
                        />
                    </Box>
                )}

                {/* Prompt add wizard */}
                {ui.activeOverlay === 'prompt-add-wizard' && ui.promptAddWizard && (
                    <PromptAddWizard
                        ref={promptAddWizardRef}
                        isVisible={true}
                        scope={ui.promptAddWizard.scope}
                        onComplete={handlePromptAddComplete}
                        onClose={handlePromptAddWizardClose}
                    />
                )}

                {/* Prompt delete selector */}
                {ui.activeOverlay === 'prompt-delete-selector' && (
                    <Box marginTop={1}>
                        <PromptDeleteSelector
                            ref={promptDeleteSelectorRef}
                            isVisible={true}
                            onDelete={handlePromptDelete}
                            onClose={handlePromptDeleteClose}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* Session rename overlay */}
                {ui.activeOverlay === 'session-rename' && (
                    <SessionRenameOverlay
                        ref={sessionRenameRef}
                        isVisible={true}
                        currentTitle={currentSessionTitle}
                        onRename={handleSessionRename}
                        onClose={handleSessionRenameClose}
                    />
                )}

                {/* Context stats overlay */}
                {ui.activeOverlay === 'context-stats' && session.id && (
                    <Box marginTop={1}>
                        <ContextStatsOverlay
                            ref={contextStatsRef}
                            isVisible={true}
                            onClose={handleClose}
                            agent={agent}
                            sessionId={session.id ?? ''}
                        />
                    </Box>
                )}

                {/* Export wizard overlay */}
                {ui.activeOverlay === 'export-wizard' && (
                    <ExportWizard
                        ref={exportWizardRef}
                        isVisible={true}
                        agent={agent}
                        sessionId={session.id}
                        onClose={handleClose}
                    />
                )}
            </>
        );

        return hideCliChrome ? (
            <FocusOverlayFrame>{overlayContent}</FocusOverlayFrame>
        ) : (
            overlayContent
        );
    }
);
