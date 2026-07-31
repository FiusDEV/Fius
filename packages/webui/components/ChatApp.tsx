import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useNavigate } from '@tanstack/react-router';
import { useChatContext } from './hooks/ChatContext';
import { useTheme } from './hooks/useTheme';
import { usePrompts, type Prompt } from './hooks/usePrompts';
import { useDeleteSession } from './hooks/useSessions';
import { client } from '@/lib/client';
import { useResolvePrompt } from './hooks/usePrompts';
import {
    useChatStore,
    useCurrentSessionId,
    useIsWelcomeState,
    useAllMessages,
    useSessionProcessing,
    useSessionError,
    useCurrentToolName,
} from '@/lib/stores';
import { useGreeting } from './hooks/useGreeting';
import MessageList from './MessageList';
import InputArea from './InputArea';
import ConnectServerModal from './ConnectServerModal';

import ServersPanel from './ServersPanel';
import SessionPanel from './SessionPanel';
import MemoryPanel from './MemoryPanel';
import { ApprovalRequestHandler, type ApprovalHandlers } from './ApprovalRequestHandler';
import GlobalSearchModal from './GlobalSearchModal';
import { Button } from './ui/button';
import {
    Server,
    Download,
    Wrench,
    Keyboard,
    AlertTriangle,
    MoreHorizontal,
    Menu,
    Trash2,
    Settings,
    ChevronDown,
    FlaskConical,
    Check,
    FileEditIcon,
    Brain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
} from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { SettingsPanel } from './settings/SettingsPanel';
import { usePreferenceStore } from '@/lib/stores/preferenceStore';
import { getApiUrl } from '@/lib/api-url';

import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { serverRegistry } from '@/lib/serverRegistry';
import type { McpServerConfig } from '@fius/core';
import type { Attachment } from '../lib/attachment-types.js';

interface ChatAppProps {
    sessionId?: string;
}

function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

const WELCOME_GREETINGS = [
    'Ready to code! What are we building today?',
    'Hey there! What shall we create?',
    'Welcome back! Ready to build something great?',
    'What are we working on today?',
    'Let\'s create something awesome!',
    'Your workspace is ready. What\'s next?',
    'What can I help you build?',
    'Time to create! What\'s on your mind?',
    'Let\'s get building!',
    'What project are we tackling?',
];

const WELCOME_SUBTITLES = [
    'Your AI assistant with powerful tools. Ask anything or connect new capabilities.',
    'Ask me anything — I can code, search, connect tools, and more.',
    'I\'m here to help you build, debug, and create. Just ask!',
    'Type your idea and I\'ll bring it to life with code.',
    'Your coding companion — powered by AI, fueled by curiosity.',
    'From quick questions to complex projects — I\'m ready.',
    'Need a hand? I can write code, run commands, and manage files.',
    'Let\'s turn your ideas into reality. What shall we start with?',
    'I can help with code, debugging, architecture, and more. What do you need?',
    'Your AI pair programmer — always ready to help.',
];

interface QuickAction {
    title: string;
    description: string;
    action: string;
    icon: string;
}

const WELCOME_ACTIONS: QuickAction[] = [
    { title: 'Help me get started', description: 'Show me what you can do', action: "I'm new to Fius. Can you show me your capabilities and help me understand how to work with you effectively?", icon: '🚀' },
    { title: 'Create Snake Game', description: 'Build a game and open it', action: 'Create a snake game in a new directory with HTML, CSS, and JavaScript, then open it in the browser for me to play.', icon: '🐍' },
    { title: 'Connect new tools', description: 'Browse and add MCP servers', action: '__OPEN_SERVERS_PANEL__', icon: '🔧' },
    { title: 'Demonstrate tools', description: 'Show me your capabilities', action: 'Pick one of your most interesting tools and demonstrate it with a practical example. Show me what it can do.', icon: '⚡' },
    { title: 'Build a calculator', description: 'Create a web calculator app', action: 'Create a beautiful, responsive calculator app with HTML, CSS, and JavaScript. Make it look modern and professional.', icon: '🧮' },
    { title: 'Write a Python script', description: 'Automate something for me', action: 'Write a Python script that organizes files in a directory by their extension — move images to an images folder, documents to docs, etc.', icon: '🐍' },
    { title: 'Explain a concept', description: 'Teach me something new', action: 'Explain how React hooks work under the hood, with practical examples of custom hooks and when to use them.', icon: '📚' },
    { title: 'Debug my code', description: 'Help fix an issue', action: 'I have a bug in my project. Can you help me find and fix it? Let me describe what\'s happening...', icon: '🐛' },
    { title: 'Design a REST API', description: 'Plan a backend architecture', action: 'Help me design a REST API for a task management app with users, projects, and tasks. Include authentication and proper HTTP methods.', icon: '🏗️' },
    { title: 'Create a landing page', description: 'Build a beautiful homepage', action: 'Create a modern, responsive landing page for a SaaS product with a hero section, features grid, pricing, and a CTA. Use clean HTML and CSS.', icon: '🎨' },
];

export default function ChatApp({ sessionId }: ChatAppProps = {}) {
    const navigate = useNavigate();

    const currentSessionId = useCurrentSessionId();
    const isWelcomeState = useIsWelcomeState();
    const messages = useAllMessages(currentSessionId);
    const processing = useSessionProcessing(currentSessionId);
    const activeError = useSessionError(currentSessionId);
    const currentToolName = useCurrentToolName();

    const { sendMessage, switchSession, returnToWelcome, cancel } = useChatContext();

    const sendMessageRef = useRef(sendMessage);
    sendMessageRef.current = sendMessage;

    const { greeting } = useGreeting(currentSessionId);

    const welcomeData = useMemo(() => ({
        title: pickRandom(WELCOME_GREETINGS),
        subtitle: pickRandom(WELCOME_SUBTITLES),
        actions: pickRandom(WELCOME_ACTIONS),
    }), []);

    useEffect(() => {
        function checkUrlParams() {
            const params = new URLSearchParams(window.location.search);

            const installMsg = params.get('installMcp');
            if (installMsg) {
                window.history.replaceState({}, '', window.location.pathname);
                sendMessageRef.current(installMsg);
                return;
            }
        }

        checkUrlParams();

        const origPushState = history.pushState;
        const origReplaceState = history.replaceState;

        history.pushState = function (...args) {
            origPushState.apply(this, args);
            setTimeout(checkUrlParams, 0);
        };
        history.replaceState = function (...args) {
            origReplaceState.apply(this, args);
            setTimeout(checkUrlParams, 0);
        };

        window.addEventListener('popstate', checkUrlParams);

        return () => {
            history.pushState = origPushState;
            history.replaceState = origReplaceState;
            window.removeEventListener('popstate', checkUrlParams);
        };
    }, []);

    const clearError = useCallback(() => {
        if (currentSessionId) {
            useChatStore.getState().setError(currentSessionId, null);
        }
    }, [currentSessionId]);

    const { theme, toggleTheme } = useTheme();

    const { mutateAsync: resolvePrompt } = useResolvePrompt();

    const [isModalOpen, setModalOpen] = useState(false);
    const [isServersPanelOpen, setServersPanelOpen] = useState(false);
    const [isSessionsPanelOpen, setSessionsPanelOpen] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);
    const isFirstRenderRef = React.useRef(true);
    const [isSearchOpen, setSearchOpen] = useState(false);
    const [isExportOpen, setExportOpen] = useState(false);
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const [isMemoryPanelOpen, setMemoryPanelOpen] = useState(false);
    const [exportName, setExportName] = useState('fius-config');
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportContent, setExportContent] = useState<string>('');
    const [copySuccess, setCopySuccess] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
    const buildMode = usePreferenceStore((s) => s.buildMode);
    const setBuildMode = usePreferenceStore((s) => s.setBuildMode);

    useEffect(() => {
        fetch(`${getApiUrl()}/api/llm/build-mode`)
            .then((r) => r.json())
            .then((data: { buildMode?: string }) => {
                if (data.buildMode === 'build' || data.buildMode === 'plan') {
                    if (data.buildMode !== usePreferenceStore.getState().buildMode) {
                        setBuildMode(data.buildMode);
                    }
                }
            })
            .catch(() => {});

        const interval = setInterval(() => {
            fetch(`${getApiUrl()}/api/llm/build-mode`)
                .then((r) => r.json())
                .then((data: { buildMode?: string }) => {
                    if (data.buildMode === 'build' || data.buildMode === 'plan') {
                        if (data.buildMode !== usePreferenceStore.getState().buildMode) {
                            setBuildMode(data.buildMode);
                        }
                    }
                })
                .catch(() => {});
        }, 2000);

        return () => clearInterval(interval);
    }, []);

    const [isSendingMessage, setIsSendingMessage] = useState(false);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const [approvalHandlers, setApprovalHandlers] = useState<ApprovalHandlers | null>(null);

    const deleteSessionMutation = useDeleteSession();

    const { data: promptsData = [], isLoading: promptsLoading } = usePrompts({
        enabled: isWelcomeState,
    });

    const starterPrompts = promptsData.filter(
        (prompt: Prompt) => prompt.metadata?.showInStarters === true
    );
    const starterPromptsLoaded = !promptsLoading;

    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const listContentRef = React.useRef<HTMLDivElement | null>(null);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [isScrollingToBottom, setIsScrollingToBottom] = useState(false);
    const [followStreaming, setFollowStreaming] = useState(false);
    const lastScrollTopRef = React.useRef(0);
    const [showScrollHint, setShowScrollHint] = useState(false);
    const scrollIdleTimerRef = React.useRef<number | null>(null);

    const [serversRefreshTrigger, setServersRefreshTrigger] = useState(0);
    const [connectPrefill, setConnectPrefill] = useState<{
        name: string;
        config: Partial<McpServerConfig> & { type?: 'stdio' | 'sse' | 'http' };
        lockName?: boolean;
        registryEntryId?: string;
    } | null>(null);

    useEffect(() => {
        const updateViewportHeight = () => {
            if (typeof document === 'undefined') return;
            const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
            document.documentElement.style.setProperty(
                '--app-viewport-height',
                `${viewportHeight}px`
            );
        };

        updateViewportHeight();
        window.addEventListener('resize', updateViewportHeight);
        window.addEventListener('orientationchange', updateViewportHeight);
        window.visualViewport?.addEventListener('resize', updateViewportHeight);

        return () => {
            window.removeEventListener('resize', updateViewportHeight);
            window.removeEventListener('orientationchange', updateViewportHeight);
            window.visualViewport?.removeEventListener('resize', updateViewportHeight);
        };
    }, []);

    const recomputeIsAtBottom = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 1;
        setIsAtBottom(nearBottom);
    }, []);

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
        const el = scrollContainerRef.current;
        if (!el) return;
        setIsScrollingToBottom(true);
        el.scrollTo({ top: el.scrollHeight, behavior });
        requestAnimationFrame(() => setIsScrollingToBottom(false));
    }, []);

    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const onScroll = () => {
            const prev = lastScrollTopRef.current;
            const curr = el.scrollTop;
            if (!isScrollingToBottom && followStreaming && curr < prev) {
                setFollowStreaming(false);
            }
            lastScrollTopRef.current = curr;
            recomputeIsAtBottom();

            const nearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 1;
            if (nearBottom) {
                setShowScrollHint(false);
                if (scrollIdleTimerRef.current) {
                    window.clearTimeout(scrollIdleTimerRef.current);
                    scrollIdleTimerRef.current = null;
                }
            } else {
                setShowScrollHint(false);
                if (scrollIdleTimerRef.current) window.clearTimeout(scrollIdleTimerRef.current);
                scrollIdleTimerRef.current = window.setTimeout(() => {
                    setShowScrollHint(true);
                }, 180);
            }
        };
        el.addEventListener('scroll', onScroll);
        recomputeIsAtBottom();
        return () => el.removeEventListener('scroll', onScroll);
    }, [recomputeIsAtBottom, followStreaming, isScrollingToBottom, isWelcomeState]);

    useEffect(() => {
        const content = listContentRef.current;
        if (!content) return;
        const ro = new ResizeObserver(() => {
            if (isScrollingToBottom) return;
            if (followStreaming || isAtBottom) scrollToBottom('auto');
        });
        ro.observe(content);
        return () => ro.disconnect();
    }, [isAtBottom, isScrollingToBottom, followStreaming, scrollToBottom, isWelcomeState]);

    useEffect(() => {
        if (followStreaming) scrollToBottom('auto');
    }, [followStreaming, messages, scrollToBottom]);

    const positionLastUserNearTop = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const nodes = container.querySelectorAll('[data-role="user"]');
        const el = nodes[nodes.length - 1] as HTMLElement | undefined;
        if (!el) {
            scrollToBottom('auto');
            return;
        }
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const offsetTop = eRect.top - cRect.top + container.scrollTop;
        const target = Math.max(offsetTop - 16, 0);
        setIsScrollingToBottom(true);
        container.scrollTo({ top: target, behavior: 'auto' });
        requestAnimationFrame(() => setIsScrollingToBottom(false));
    }, [scrollToBottom]);

    useEffect(() => {
        if (isExportOpen) {
            const fetchConfig = async () => {
                try {
                    const response = await client.api.agent.config.export.$get({
                        query: currentSessionId ? { sessionId: currentSessionId } : {},
                    });
                    if (!response.ok) {
                        throw new Error('Failed to fetch configuration');
                    }
                    const text = await response.text();
                    setExportContent(text);
                    setExportError(null);
                } catch (err) {
                    console.error('Preview fetch failed:', err);
                    setExportError(err instanceof Error ? err.message : 'Preview fetch failed');
                }
            };
            void fetchConfig();
        } else {
            setExportContent('');
            setExportError(null);
            setCopySuccess(false);
        }
    }, [isExportOpen, currentSessionId]);

    const handleDownload = useCallback(async () => {
        try {
            const response = await client.api.agent.config.export.$get({
                query: currentSessionId ? { sessionId: currentSessionId } : {},
            });
            if (!response.ok) {
                throw new Error('Failed to fetch configuration');
            }
            const yamlText = await response.text();
            const blob = new Blob([yamlText], { type: 'application/x-yaml' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;

            const fileName = currentSessionId
                ? `${exportName}-${currentSessionId}.yml`
                : `${exportName}.yml`;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed:', error);
            setExportError(error instanceof Error ? error.message : 'Download failed');
        }
    }, [exportName, currentSessionId]);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(exportContent);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (error) {
            console.error('Copy failed:', error);
            setExportError('Failed to copy to clipboard');
        }
    }, [exportContent]);

    const handleSend = useCallback(
        async (content: string, attachments?: Attachment[]) => {
            setIsSendingMessage(true);
            setErrorMessage(null);

            try {
                await sendMessage(content, attachments);
                setTimeout(() => {
                    positionLastUserNearTop();
                    setFollowStreaming(true);
                }, 0);
            } catch (error) {
                console.error('Failed to send message:', error);
                setErrorMessage(error instanceof Error ? error.message : 'Failed to send message');
                setTimeout(() => setErrorMessage(null), 5000);
            } finally {
                setIsSendingMessage(false);
            }
        },
        [sendMessage, positionLastUserNearTop]
    );

    useEffect(() => {
        setFollowStreaming(processing);
    }, [processing]);

    const handleSessionChange = useCallback(
        (sessionId: string) => {
            setFollowStreaming(false);
            setShowScrollHint(false);
            navigate({ to: `/chat/${sessionId}` });
        },
        [navigate]
    );

    const handleReturnToWelcome = useCallback(() => {
        setFollowStreaming(false);
        setShowScrollHint(false);
        returnToWelcome();
        navigate({ to: '/' });
    }, [navigate, returnToWelcome]);

    useEffect(() => {
        setIsHydrated(true);
        const savedPanelState = localStorage.getItem('sessionsPanelOpen');
        if (savedPanelState === 'true') {
            setSessionsPanelOpen(true);
        }
        setTimeout(() => {
            isFirstRenderRef.current = false;
        }, 0);
    }, []);

    useEffect(() => {
        if (isHydrated && typeof window !== 'undefined') {
            localStorage.setItem('sessionsPanelOpen', isSessionsPanelOpen.toString());
        }
    }, [isSessionsPanelOpen, isHydrated]);

    useEffect(() => {
        if (sessionId && sessionId !== currentSessionId) {
            setFollowStreaming(false);
            setShowScrollHint(false);
            switchSession(sessionId);
        }
    }, [sessionId, currentSessionId, switchSession]);

    useEffect(() => {
        if (!sessionId && !isWelcomeState) {
            returnToWelcome();
        }
    }, [sessionId, isWelcomeState, returnToWelcome]);

    const isNarrowViewport = () => {
        return typeof window !== 'undefined' && window.innerWidth < 768;
    };

    const handleOpenSessionsPanel = useCallback(() => {
        if (isNarrowViewport() && isServersPanelOpen) {
            setServersPanelOpen(false);
        }
        setSessionsPanelOpen(!isSessionsPanelOpen);
    }, [isSessionsPanelOpen, isServersPanelOpen]);

    const handleOpenServersPanel = useCallback(() => {
        if (isNarrowViewport() && isSessionsPanelOpen) {
            setSessionsPanelOpen(false);
        }
        setServersPanelOpen(!isServersPanelOpen);
    }, [isServersPanelOpen, isSessionsPanelOpen]);

    const handleDeleteConversation = useCallback(async () => {
        if (!currentSessionId) return;

        try {
            await deleteSessionMutation.mutateAsync({ sessionId: currentSessionId });
            setDeleteDialogOpen(false);
            handleReturnToWelcome();
        } catch (error) {
            console.error('Failed to delete conversation:', error);
            setErrorMessage(
                error instanceof Error ? error.message : 'Failed to delete conversation'
            );
            setTimeout(() => setErrorMessage(null), 5000);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSessionId, handleReturnToWelcome]);

    const quickActions = React.useMemo(() => {
        const connectAction: QuickAction = WELCOME_ACTIONS.find((a) => a.action === '__OPEN_SERVERS_PANEL__')!;
        const others = WELCOME_ACTIONS.filter((a) => a.action !== '__OPEN_SERVERS_PANEL__');
        const shuffled = [...others].sort(() => Math.random() - 0.5);
        const picked = shuffled.slice(0, 3);

        return [...picked, connectAction].sort(() => Math.random() - 0.5).map((a) => ({
            title: a.title,
            description: a.description,
            action: a.action === '__OPEN_SERVERS_PANEL__'
                ? () => setServersPanelOpen(true)
                : () => handleSend(a.action),
            icon: a.icon,
        }));
    }, [handleSend, setServersPanelOpen]);

    const dynamicQuickActions = React.useMemo(() => {
        if (!starterPromptsLoaded) {
            return quickActions.map((a) => ({
                description: `${a.icon} ${a.title}`,
                tooltip: a.description,
                action: a.action,
            }));
        }

        const actions: Array<{ description: string; tooltip?: string; action: () => void }> =
            starterPrompts.length > 0
                ? []
                : quickActions.map((a) => ({
                      description: `${a.icon} ${a.title}`,
                      tooltip: a.description,
                      action: a.action,
                  }));
        starterPrompts.forEach((prompt: Prompt) => {
            const description = prompt.title || prompt.description || 'Starter prompt';
            const tooltip = prompt.description;

            if (prompt?.name === 'starter:connect-tools') {
                actions.push({
                    description,
                    tooltip,
                    action: () => setServersPanelOpen(true),
                });
            } else {
                actions.push({
                    description,
                    tooltip,
                    action: async () => {
                        try {
                            const result = await resolvePrompt({
                                name: prompt.name,
                            });
                            if (result.text.trim()) {
                                handleSend(result.text.trim());
                            } else {
                                handleSend(`/${prompt.name}`);
                            }
                        } catch (error) {
                            console.error(
                                `Failed to resolve starter prompt ${prompt.name}:`,
                                error
                            );
                            handleSend(`/${prompt.name}`);
                        }
                    },
                });
            }
        });
        return actions;
    }, [
        starterPrompts,
        starterPromptsLoaded,
        quickActions,
        handleSend,
        setServersPanelOpen,
        resolvePrompt,
    ]);

    useHotkeys(
        'mod+backspace',
        () => {
            if (currentSessionId && !isWelcomeState) {
                if (messages.length > 0) {
                    setDeleteDialogOpen(true);
                } else {
                    handleDeleteConversation();
                }
            }
        },
        { preventDefault: true },
        [currentSessionId, isWelcomeState, messages.length, handleDeleteConversation]
    );

    useHotkeys('mod+h', handleOpenSessionsPanel, { preventDefault: true }, [
        handleOpenSessionsPanel,
    ]);

    useHotkeys('mod+k', handleReturnToWelcome, { preventDefault: true }, [handleReturnToWelcome]);

    useHotkeys('mod+j', handleOpenServersPanel, { preventDefault: true }, [handleOpenServersPanel]);

    useHotkeys('mod+m', () => setMemoryPanelOpen((prev) => !prev), { preventDefault: true });

    useHotkeys('mod+shift+s', () => setSearchOpen(true), { preventDefault: true });

    useHotkeys('mod+l', () => navigate({ to: '/servers' }), { preventDefault: true });

    useHotkeys('mod+shift+e', () => setExportOpen(true), { preventDefault: true });

    useHotkeys('mod+slash', () => setShowShortcuts(true), { preventDefault: true });

    useHotkeys('mod+b', () => {
        const current = usePreferenceStore.getState().buildMode;
        setBuildMode(current === 'build' ? 'plan' : 'build');
    }, { preventDefault: true });

    useHotkeys(
        'escape',
        () => {
            if (isServersPanelOpen) setServersPanelOpen(false);
            else if (isSessionsPanelOpen) setSessionsPanelOpen(false);
            else if (isMemoryPanelOpen) setMemoryPanelOpen(false);
            else if (isExportOpen) setExportOpen(false);
            else if (showShortcuts) setShowShortcuts(false);
            else if (isDeleteDialogOpen) setDeleteDialogOpen(false);
            else if (errorMessage) setErrorMessage(null);
            else if (processing) cancel(currentSessionId || undefined);
        },
        [
            isServersPanelOpen,
            isSessionsPanelOpen,
            isMemoryPanelOpen,
            isExportOpen,
            showShortcuts,
            isDeleteDialogOpen,
            errorMessage,
            processing,
            cancel,
            currentSessionId,
        ]
    );

    return (
        <div
            className="flex w-full bg-background"
            style={{
                height: 'var(--app-viewport-height, 100vh)',
                minHeight: 'var(--app-viewport-height, 100vh)',
            }}
        >
            {/* Left Sidebar - Chat History (Desktop only - inline) */}
            {/* Always visible: collapsed (thin bar) or expanded (full panel) */}
            <div
                className={cn(
                    'hidden md:block h-full shrink-0 bg-card/50 backdrop-blur-sm',
                    !isFirstRenderRef.current && 'transition-all duration-300 ease-in-out',
                    isSessionsPanelOpen ? 'w-72' : 'w-14'
                )}
                suppressHydrationWarning
            >
                <SessionPanel
                    isOpen={isSessionsPanelOpen}
                    onClose={() => setSessionsPanelOpen(false)}
                    onExpand={() => setSessionsPanelOpen(true)}
                    currentSessionId={currentSessionId}
                    onSessionChange={handleSessionChange}
                    returnToWelcome={handleReturnToWelcome}
                    variant="inline"
                    onSearchOpen={() => setSearchOpen(true)}
                    onNewChat={handleReturnToWelcome}
                    onSettingsOpen={() => setSettingsOpen(true)}
                    onPlaygroundOpen={() => navigate({ to: '/servers' })}
                    onThemeToggle={() => toggleTheme(theme === 'light')}
                    theme={theme}
                />
            </div>

            {/* Chat History Panel - Mobile/Narrow (overlay) */}
            <div className="md:hidden">
                <SessionPanel
                    isOpen={isSessionsPanelOpen}
                    onClose={() => setSessionsPanelOpen(false)}
                    currentSessionId={currentSessionId}
                    onSessionChange={handleSessionChange}
                    returnToWelcome={handleReturnToWelcome}
                    variant="overlay"
                    onSearchOpen={() => setSearchOpen(true)}
                    onNewChat={handleReturnToWelcome}
                    onSettingsOpen={() => setSettingsOpen(true)}
                    onPlaygroundOpen={() => navigate({ to: '/servers' })}
                    onThemeToggle={() => toggleTheme(theme === 'light')}
                    theme={theme}
                />
            </div>

            <main
                className="flex-1 h-full flex flex-col relative min-w-0"
                style={
                    { '--thread-max-width': '54rem' } as React.CSSProperties & {
                        '--thread-max-width': string;
                    }
                }
            >
                {/** Shared centered content width for welcome, messages, and composer */}
                {/** Keep this in sync to unify UI width like other chat apps */}
                {/** 720px base, expand to ~2xl on sm, ~3xl on lg */}
                {/* Unused var directive removed; keep code clean */}
                {(() => {
                    /* no-op to allow inline constant-like usage below via variable */
                    return null;
                })()}
                {/* Clean Header */}
                <header className="shrink-0 bg-background/80 backdrop-blur-sm relative">
                    <div className="flex items-center justify-between px-4 py-2.5 gap-3">
                        {/* Left Section */}
                        <div className="flex items-center gap-3 shrink-0">
                            {/* Fius Icon - Mobile only (desktop has collapsed sidebar) */}
                            <div className="md:hidden">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={handleOpenSessionsPanel}
                                            className="flex items-center hover:opacity-80 transition-opacity shrink-0"
                                            aria-label="Open chat history (⌘H)"
                                        >
                                            <img
                                                src="/favicon.png"
                                                alt="Fius"
                                                className="h-8 w-8"
                                            />
                                            <span className="sr-only">
                                                Fius - Open Chat History
                                            </span>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>Open Chat History (⌘H)</TooltipContent>
                                </Tooltip>
                            </div>

                            {/* Build/Plan Mode Toggle */}
                            <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5">
                                <Button
                                    variant={buildMode === 'build' ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => setBuildMode('build')}
                                    className="h-7 px-2.5 text-xs font-medium"
                                >
                                    ▶ Build
                                </Button>
                                <Button
                                    variant={buildMode === 'plan' ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => setBuildMode('plan')}
                                    className="h-7 px-2.5 text-xs font-medium"
                                >
                                    ◇ Plan
                                </Button>
                            </div>
                        </div>

                        {/* Right Section - Desktop buttons (hide when session panel is open on smaller screens) */}
                        <div
                            className={cn(
                                'hidden items-center gap-1',
                                isSessionsPanelOpen ? 'lg:flex' : 'md:flex'
                            )}
                        >
                            {/* Primary action group - Tools & Memories */}
                            <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-muted/30">
                                {/* Tools */}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleOpenServersPanel}
                                            className={cn(
                                                'h-7 w-7 p-0 transition-colors',
                                                isServersPanelOpen && 'bg-background'
                                            )}
                                            aria-label="Toggle tools panel"
                                        >
                                            <Wrench className="h-3.5 w-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Toggle tools panel (⌘J)</TooltipContent>
                                </Tooltip>

                                {/* Memories */}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setMemoryPanelOpen(!isMemoryPanelOpen)}
                                            className={cn(
                                                'h-7 w-7 p-0 transition-colors',
                                                isMemoryPanelOpen && 'bg-background'
                                            )}
                                            aria-label="Toggle memories panel"
                                        >
                                            <Brain className="h-3.5 w-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Toggle memories panel (⌘M)</TooltipContent>
                                </Tooltip>
                            </div>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                        <MoreHorizontal className="h-3.5 w-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {/* Always visible items */}
                                    <DropdownMenuItem onClick={() => navigate({ to: '/servers' })}>
                                        <Server className="h-4 w-4 mr-2" />
                                        Connect MCPs
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setExportOpen(true)}>
                                        <Download className="h-4 w-4 mr-2" />
                                        Export Config
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setShowShortcuts(true)}>
                                        <Keyboard className="h-4 w-4 mr-2" />
                                        Shortcuts
                                    </DropdownMenuItem>
                                    {/* Session Management Actions - Only show when there's an active session */}
                                    {currentSessionId && !isWelcomeState && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() => setDeleteDialogOpen(true)}
                                                className="text-destructive focus:text-destructive"
                                            >
                                                <Trash2 className="h-4 w-4 mr-2" />
                                                Delete Conversation
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        {/* Right Section - Narrow screens (hamburger menu) - also show on md when session panel open */}
                        <div
                            className={cn('flex', isSessionsPanelOpen ? 'lg:hidden' : 'md:hidden')}
                        >
                            <DropdownMenu open={isMobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0"
                                        aria-label="Open menu"
                                    >
                                        <Menu className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {/* All action buttons for narrow screens */}
                                    <DropdownMenuItem
                                        onClick={() => {
                                            handleOpenServersPanel();
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Wrench className="h-4 w-4 mr-2" />
                                        Tools
                                    </DropdownMenuItem>

                                    <DropdownMenuItem
                                        onClick={() => {
                                            setMemoryPanelOpen(!isMemoryPanelOpen);
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Brain className="h-4 w-4 mr-2" />
                                        Memories
                                    </DropdownMenuItem>

                                    <DropdownMenuItem
                                        onClick={() => {
                                            toggleTheme(theme === 'light');
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <span className="h-4 w-4 mr-2">🌙</span>
                                        Toggle Theme
                                    </DropdownMenuItem>

                                    <DropdownMenuItem
                                        onClick={() => {
                                            setSettingsOpen(true);
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Settings className="h-4 w-4 mr-2" />
                                        Settings
                                    </DropdownMenuItem>

                                    <DropdownMenuSeparator />

                                    {/* Always visible items */}
                                    <DropdownMenuItem
                                        onClick={() => {
                                            navigate({ to: '/servers' });
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Server className="h-4 w-4 mr-2" />
                                        Connect MCPs
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            navigate({ to: '/servers' });
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <FlaskConical className="h-4 w-4 mr-2" />
                                        MCP Servers
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setExportOpen(true);
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Export Config
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setShowShortcuts(true);
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Keyboard className="h-4 w-4 mr-2" />
                                        Shortcuts
                                    </DropdownMenuItem>
                                    {/* Session Management Actions - Only show when there's an active session */}
                                    {currentSessionId && !isWelcomeState && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() => {
                                                    setDeleteDialogOpen(true);
                                                    setMobileMenuOpen(false);
                                                }}
                                                className="text-destructive focus:text-destructive"
                                            >
                                                <Trash2 className="h-4 w-4 mr-2" />
                                                Delete Conversation
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </header>

                {/* Main Content Area */}
                <div className="flex-1 flex overflow-hidden min-w-0">
                    {/* Toasts */}
                    {successMessage && (
                        <div className="fixed bottom-4 right-4 z-50 border border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 text-foreground px-3 py-2 rounded-md shadow-md inline-flex items-center gap-2">
                            <Check className="h-4 w-4 text-green-600" />
                            <span className="text-sm">{successMessage}</span>
                        </div>
                    )}
                    {/* Error Message */}
                    {errorMessage && (
                        <div className="absolute top-4 right-4 z-50 bg-destructive text-destructive-foreground px-4 py-2 rounded-md shadow-lg">
                            {errorMessage}
                        </div>
                    )}

                    {/* Chat Content */}
                    <div className="flex-1 flex flex-col min-h-0 min-w-0">
                        {isWelcomeState ? (
                            /* Modern Welcome Screen with Central Search */
                            <div className="flex-1 flex flex-col justify-end sm:justify-center p-6 sm:-mt-20">
                                <div className="w-full max-w-full mx-auto pb-safe">
                                    {/* Greeting/Header Section - Narrowest */}
                                    <div className="text-center space-y-3 mb-8 max-w-full sm:max-w-3xl mx-auto">
                                        <h2 className="text-2xl font-bold font-mono tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text">
                                            {welcomeData.title}
                                        </h2>
                                        <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
                                            {welcomeData.subtitle}
                                        </p>
                                    </div>

                                    {/* Quick Actions Grid - Medium width */}
                                    <div className="flex flex-wrap justify-center gap-2 mb-6 max-w-full sm:max-w-3xl lg:max-w-4xl mx-auto">
                                        {dynamicQuickActions.map((action, index) => {
                                            const button = (
                                                <button
                                                    key={index}
                                                    onClick={action.action}
                                                    className="group px-3 py-2 text-left rounded-full bg-primary/5 hover:bg-primary/10 transition-all duration-200 hover:shadow-sm hover:scale-105"
                                                >
                                                    <span className="font-medium text-sm text-primary group-hover:text-primary/80 transition-colors">
                                                        {action.description}
                                                    </span>
                                                </button>
                                            );

                                            if (action.tooltip) {
                                                return (
                                                    <Tooltip key={index}>
                                                        <TooltipTrigger asChild>
                                                            {button}
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            {action.tooltip}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                );
                                            }

                                            return button;
                                        })}
                                    </div>

                                    {/* Central Input Bar - Narrowest, most focused */}
                                    <div className="max-w-full sm:max-w-3xl mx-auto mb-6">
                                        <InputArea
                                            onSend={handleSend}
                                            isSending={isSendingMessage}
                                            variant="welcome"
                                            isSessionsPanelOpen={isSessionsPanelOpen}
                                        />
                                    </div>

                                    {/* Quick Tips */}
                                    <div className="text-xs text-muted-foreground space-y-1 text-center max-w-full sm:max-w-3xl mx-auto">
                                        <p>
                                            💡 Hold
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">
                                                Ctrl
                                            </kbd>{' '}
                                            +{' '}
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                                                K
                                            </kbd>{' '}
                                            for new chat,{' '}
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                                                J
                                            </kbd>{' '}
                                            for tools,{' '}
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                                                L
                                            </kbd>{' '}
                                            for playground,{' '}
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                                                Backspace
                                            </kbd>{' '}
                                            to delete session,{' '}
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                                                /
                                            </kbd>{' '}
                                            for shortcuts
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Messages Area */
                            <div className="flex-1 min-h-0 overflow-hidden min-w-0">
                                <div
                                    ref={scrollContainerRef}
                                    className="h-full overflow-y-auto overflow-x-hidden overscroll-contain relative min-w-0"
                                >
                                    {/* Ensure the input dock sits at the very bottom even if content is short */}
                                    <div className="min-h-full grid grid-cols-1 grid-rows-[1fr_auto] min-w-0">
                                        <div className="w-full max-w-full sm:max-w-[var(--thread-max-width)] mx-0 sm:mx-auto min-w-0">
                                            <MessageList
                                                messages={messages}
                                                processing={processing}
                                                currentToolName={currentToolName}
                                                activeError={activeError}
                                                onDismissError={clearError}
                                                outerRef={listContentRef}
                                                onApprovalApprove={approvalHandlers?.onApprove}
                                                onApprovalDeny={approvalHandlers?.onDeny}
                                                sessionId={currentSessionId}
                                            />
                                        </div>
                                        {/* Sticky input dock inside scroll viewport */}
                                        <div
                                            className="sticky bottom-0 z-10 px-0 sm:px-4 pt-2 pb-2 bg-background relative"
                                            style={{
                                                paddingBottom:
                                                    'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)',
                                                marginBottom:
                                                    'calc(env(safe-area-inset-bottom, 0px) * -1)',
                                            }}
                                        >
                                            {showScrollHint && (
                                                <div className="absolute left-1/2 -translate-x-1/2 -top-3 z-20 pointer-events-none">
                                                    <button
                                                        onClick={() => {
                                                            setShowScrollHint(false);
                                                            scrollToBottom('smooth');
                                                        }}
                                                        className="pointer-events-auto w-7 h-7 rounded-full shadow-sm bg-background/95 border border-border/60 backdrop-blur supports-[backdrop-filter]:bg-background/80 text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center"
                                                    >
                                                        <ChevronDown className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            )}
                                            <div className="w-full max-w-full sm:max-w-[var(--thread-max-width)] mx-0 sm:mx-auto pointer-events-auto">
                                                <InputArea
                                                    onSend={handleSend}
                                                    isSending={isSendingMessage}
                                                    variant="chat"
                                                    isSessionsPanelOpen={isSessionsPanelOpen}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    {/* Scroll to bottom button */}
                                    {/* Scroll hint now rendered inside sticky dock */}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Narrow screens: overlay panel */}
                    <div className="md:hidden">
                        <ServersPanel
                            isOpen={isServersPanelOpen}
                            onClose={() => setServersPanelOpen(false)}
                            onOpenConnectModal={() => setModalOpen(true)}
                            onServerConnected={(name) => {
                                setServersRefreshTrigger((prev) => prev + 1);
                                setSuccessMessage(`Added ${name}`);
                                setTimeout(() => setSuccessMessage(null), 4000);
                            }}
                            variant="overlay"
                            refreshTrigger={serversRefreshTrigger}
                        />
                    </div>
                </div>

                {/* Connect Server Modal */}
                <ConnectServerModal
                    isOpen={isModalOpen}
                    onClose={() => {
                        setModalOpen(false);
                        setConnectPrefill(null);
                    }}
                    onServerConnected={async () => {
                        if (connectPrefill?.registryEntryId) {
                            try {
                                await serverRegistry.setInstalled(
                                    connectPrefill.registryEntryId,
                                    true
                                );
                            } catch (e) {
                                console.warn('Failed to mark registry entry installed:', e);
                            }
                        }
                        setServersRefreshTrigger((prev) => prev + 1);
                        const name = connectPrefill?.name || 'Server';
                        setSuccessMessage(`Added ${name}`);
                        setTimeout(() => setSuccessMessage(null), 4000);
                        setConnectPrefill(null);
                    }}
                    initialName={connectPrefill?.name}
                    initialConfig={connectPrefill?.config}
                    lockName={connectPrefill?.lockName}
                />

                {/* Export Configuration Modal */}
                <Dialog open={isExportOpen} onOpenChange={setExportOpen}>
                    <DialogContent className="sm:max-w-2xl">
                        <DialogHeader>
                            <DialogTitle className="flex items-center space-x-2">
                                <Download className="h-5 w-5" />
                                <span>Export Configuration</span>
                            </DialogTitle>
                            <DialogDescription>
                                Download your tool configuration for Claude Desktop or other MCP
                                clients
                                {currentSessionId && (
                                    <span className="block mt-1 text-sm text-muted-foreground">
                                        Including session-specific settings for:{' '}
                                        <span className="font-mono">{currentSessionId}</span>
                                    </span>
                                )}
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="filename">File name</Label>
                                <Input
                                    id="filename"
                                    value={exportName}
                                    onChange={(e) => setExportName(e.target.value)}
                                    placeholder="fius-config"
                                    className="font-mono"
                                />
                            </div>

                            {exportError && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Export Error</AlertTitle>
                                    <AlertDescription>{exportError}</AlertDescription>
                                </Alert>
                            )}

                            {exportContent && (
                                <div className="space-y-2">
                                    <Label>Configuration Preview</Label>
                                    <Textarea
                                        value={exportContent}
                                        readOnly
                                        className="h-32 font-mono text-xs bg-muted/30"
                                    />
                                </div>
                            )}
                        </div>

                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={handleCopy}
                                className="flex items-center space-x-2"
                            >
                                <span>{copySuccess ? 'Copied!' : 'Copy'}</span>
                            </Button>
                            <Button
                                onClick={handleDownload}
                                className="flex items-center space-x-2"
                            >
                                <Download className="h-4 w-4" />
                                <span>Download</span>
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Settings Panel */}
                <SettingsPanel isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />

                {/* Memory Panel */}
                <MemoryPanel
                    isOpen={isMemoryPanelOpen}
                    onClose={() => setMemoryPanelOpen(false)}
                    variant="modal"
                />

                {/* Delete Conversation Confirmation Modal */}
                <Dialog open={isDeleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center space-x-2">
                                <Trash2 className="h-5 w-5 text-destructive" />
                                <span>Delete Conversation</span>
                            </DialogTitle>
                            <DialogDescription>
                                This will permanently delete this conversation and all its messages.
                                This action cannot be undone.
                                {currentSessionId && (
                                    <span className="block mt-2 font-medium">
                                        Session:{' '}
                                        <span className="font-mono">{currentSessionId}</span>
                                    </span>
                                )}
                            </DialogDescription>
                        </DialogHeader>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleDeleteConversation}
                                disabled={deleteSessionMutation.isPending}
                                className="flex items-center space-x-2"
                            >
                                <Trash2 className="h-4 w-4" />
                                <span>
                                    {deleteSessionMutation.isPending
                                        ? 'Deleting...'
                                        : 'Delete Conversation'}
                                </span>
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Shortcuts Modal */}
                <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center space-x-2">
                                <Keyboard className="h-5 w-5" />
                                <span>Keyboard Shortcuts</span>
                            </DialogTitle>
                        </DialogHeader>

                        <div className="space-y-3">
                            {(() => {
                                const mod = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl';
                                return [
                                    { key: `${mod}+H`, desc: 'Toggle chat history panel' },
                                    { key: `${mod}+K`, desc: 'Create new chat' },
                                    { key: `${mod}+J`, desc: 'Toggle tools panel' },
                                    { key: `${mod}+M`, desc: 'Toggle memories panel' },
                                    { key: `${mod}+Shift+S`, desc: 'Search conversations' },
                                    { key: `${mod}+L`, desc: 'Open MCP Servers' },
                                    { key: `${mod}+Shift+E`, desc: 'Export config' },
                                    { key: `${mod}+/`, desc: 'Show shortcuts' },
                                    { key: `${mod}+B`, desc: 'Toggle Build/Plan mode' },
                                    { key: `${mod}+⌫`, desc: 'Delete current session' },
                                    { key: 'Esc', desc: 'Close panels' },
                                ];
                            })().map((shortcut, index) => (
                                <div key={index} className="flex justify-between items-center py-1">
                                    <span className="text-sm text-muted-foreground">
                                        {shortcut.desc}
                                    </span>
                                    <Badge variant="outline" className="font-mono text-xs">
                                        {shortcut.key}
                                    </Badge>
                                </div>
                            ))}
                        </div>

                        <DialogFooter>
                            <DialogClose asChild>
                                <Button variant="outline">Close</Button>
                            </DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </main>

            {/* Servers Panel - Desktop: inline panel (sibling to main for full height) */}
            <div
                className={cn(
                    'hidden md:block h-full shrink-0 transition-all duration-300 ease-in-out border-l border-border/50 bg-card/50 backdrop-blur-sm',
                    isServersPanelOpen ? 'w-80' : 'w-0 overflow-hidden'
                )}
            >
                {isServersPanelOpen && (
                    <ServersPanel
                        isOpen={isServersPanelOpen}
                        onClose={() => setServersPanelOpen(false)}
                        onOpenConnectModal={() => setModalOpen(true)}
                        onServerConnected={(name) => {
                            setServersRefreshTrigger((prev) => prev + 1);
                            setSuccessMessage(`Added ${name}`);
                            setTimeout(() => setSuccessMessage(null), 4000);
                        }}
                        variant="inline"
                        refreshTrigger={serversRefreshTrigger}
                    />
                )}
            </div>

            {/* Global Search Modal */}
            <GlobalSearchModal
                isOpen={isSearchOpen}
                onClose={() => setSearchOpen(false)}
                onNavigateToSession={(sessionId) => {
                    navigate({ to: `/chat/${sessionId}` });
                    setSearchOpen(false);
                }}
            />

            {/* Approval Handler */}
            <ApprovalRequestHandler onHandlersReady={setApprovalHandlers} />
        </div>
    );
}
