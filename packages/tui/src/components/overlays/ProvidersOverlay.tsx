

import {
    useState,
    useEffect,
    forwardRef,
    useRef,
    useImperativeHandle,
    useMemo,
    useCallback,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { LLMProvider } from '@fiusdev/llm';
import { getCachedStringWidth, stripUnsafeCharacters, toCodePoints } from '../../utils/textUtils.js';
import { getMaxVisibleItemsForTerminalRows } from '../../utils/overlaySizing.js';
import { HintBar } from '../shared/HintBar.js';
import type { TuiAgentBackend } from '../../agent-backend.js';
import { fetchPlatformModels } from '../../utils/platform-models.js';
import { loadCustomModels, deleteCustomModel, type CustomModel } from '@fiusdev/agent-management';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ModelsDevEntry {
    context: number;
    output: number;
    input: string;
    outputModalities: string;
    reasoning: boolean;
    toolCall: boolean;
    costInput: number;
    costOutput: number;
}

let cachedModelsDev: Map<string, ModelsDevEntry> | null = null;

async function getModelsDevIndex(): Promise<Map<string, ModelsDevEntry>> {
    if (cachedModelsDev) return cachedModelsDev;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const resp = await fetch('https://models.dev/api.json', { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) return new Map();
        const data = await resp.json() as Record<string, Record<string, unknown>>;
        const idx = new Map<string, ModelsDevEntry>();
        for (const [, providerData] of Object.entries(data)) {
            const p = providerData as Record<string, unknown>;
            const models = p.models as Record<string, Record<string, unknown>> | undefined;
            if (!models) continue;
            for (const [modelName, mData] of Object.entries(models)) {
                const m = mData as Record<string, unknown>;
                idx.set(modelName.toLowerCase(), {
                    context: (m.context as number) || 0,
                    output: (m.output as number) || 0,
                    input: (m.input as string) || 'text',
                    outputModalities: (m.outputModalities as string) || 'text',
                    reasoning: (m.reasoning as boolean) || false,
                    toolCall: (m.toolCall as boolean) || false,
                    costInput: (m.costInput as number) || 0,
                    costOutput: (m.costOutput as number) || 0,
                });
            }
        }
        cachedModelsDev = idx;
        return idx;
    } catch {
        return new Map();
    }
}

function fmtCtx(n: number): string {
    if (n === 0) return '';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return String(n);
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProviderEntry {
    provider: string;
    displayName: string;
    planLabel: string;
    modelCount: number;
    capabilities: string[];
    isPlatform: boolean;
    isCustom: boolean;
    customModels?: CustomModel[];
}

interface ProvidersOverlayProps {
    isVisible: boolean;
    onSelectProvider?: (provider: LLMProvider) => void;
    onAddCustomProvider?: () => void;
    onClose: () => void;
    agent: TuiAgentBackend;
}

export interface ProvidersOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/* ------------------------------------------------------------------ */
/*  Provider config                                                    */
/* ------------------------------------------------------------------ */

const PROVIDER_COLORS: Record<string, string> = {
    fius: 'cyan',
    openai: 'green',
    anthropic: 'yellow',
    google: 'blue',
    groq: 'magenta',
    xai: 'red',
    cohere: 'cyan',
    minimax: 'yellow',
    glm: 'green',
    openrouter: 'gray',
    litellm: 'gray',
    vertex: 'blue',
    bedrock: 'yellow',
    ollama: 'gray',
    local: 'gray',
    'openai-compatible': 'gray',
};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
    fius: 'Fius',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    groq: 'Groq',
    xai: 'xAI',
    cohere: 'Cohere',
    minimax: 'MiniMax',
    glm: 'GLM',
    openrouter: 'OpenRouter',
    litellm: 'LiteLLM',
    vertex: 'Vertex AI',
    bedrock: 'Bedrock',
    ollama: 'Ollama (Local)',
    local: 'Local',
    'openai-compatible': 'OpenAI Compatible',
};

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function normalizeLineText(value: string): string {
    return stripUnsafeCharacters(value).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatLineToWidth(value: string, width: number): string {
    if (width <= 0) return '';
    const normalized = normalizeLineText(value);
    if (!normalized) return ' '.repeat(width);
    const normalizedWidth = getCachedStringWidth(normalized);
    if (normalizedWidth <= width) return normalized + ' '.repeat(width - normalizedWidth);
    if (width === 1) return '.';
    const targetWidth = width - 3;
    let truncated = '';
    for (const char of toCodePoints(normalized)) {
        const candidate = `${truncated}${char}`;
        if (getCachedStringWidth(candidate) > targetWidth) break;
        truncated = candidate;
    }
    return truncated + '...';
}

function padRight(text: string, width: number): string {
    const w = getCachedStringWidth(text);
    if (w >= width) return text;
    return text + ' '.repeat(width - w);
}

/* ------------------------------------------------------------------ */
/*  Search match                                                       */
/* ------------------------------------------------------------------ */

function matchesSearch(query: string, provider: string, displayName: string): boolean {
    if (!query.trim()) return true;
    const q = query.toLowerCase().replace(/[\s-]+/g, '');
    const providerNorm = provider.toLowerCase().replace(/[\s-]+/g, '');
    const displayNorm = displayName.toLowerCase().replace(/[\s-]+/g, '');
    return providerNorm.includes(q) || displayNorm.includes(q);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const ProvidersOverlay = forwardRef<ProvidersOverlayHandle, ProvidersOverlayProps>(
    function ProvidersOverlay({ isVisible, onSelectProvider, onAddCustomProvider, onClose, agent }, ref) {
        const { rows: terminalRows, columns: terminalColumns } = useTerminalSize();
        const overlayWidth = useMemo(() => Math.max(28, terminalColumns - 4), [terminalColumns]);
        const listViewportItems = useMemo(
            () =>
                getMaxVisibleItemsForTerminalRows({
                    rows: terminalRows,
                    hardCap: 30,
                    reservedRows: 8,
                    minVisibleItems: 5,
                }),
            [terminalRows],
        );

        const [providers, setProviders] = useState<ProviderEntry[]>([]);
        const [isLoading, setIsLoading] = useState(true);
        const [searchQuery, setSearchQuery] = useState('');
        const selectedIndexRef = useRef(0);
        const [selection, setSelection] = useState({ index: 0, offset: 0 });
        const scrollOffsetRef = useRef(0);

        // Detail view state for custom providers
        const [detailProvider, setDetailProvider] = useState<ProviderEntry | null>(null);
        const [detailModels, setDetailModels] = useState<CustomModel[]>([]);
        const detailIndexRef = useRef(0);
        const [detailSelection, setDetailSelection] = useState({ index: 0, offset: 0 });
        const detailScrollOffsetRef = useRef(0);
        const [deleteStatus, setDeleteStatus] = useState<'idle' | 'deleting' | 'deleted'>('idle');
        const modelsDevRef = useRef<Map<string, ModelsDevEntry>>(new Map());

        const loadProviders = useCallback(async () => {
            try {
                const [supportedModels, platformData, customModels] = await Promise.all([
                    agent.getSupportedModels(),
                    fetchPlatformModels(),
                    loadCustomModels(),
                ]);

                const entries: ProviderEntry[] = [];

                // Fius platform provider
                if (platformData.models.length > 0) {
                    const planLabel = platformData.plan.toUpperCase();
                    const fiusModels: CustomModel[] = platformData.models.map((m) => ({
                        name: m.name,
                        provider: 'fius',
                        displayProvider: 'fius',
                        displayName: m.displayName,
                    }));
                    entries.push({
                        provider: 'fius',
                        displayName: `Fius ${planLabel}`,
                        planLabel,
                        modelCount: platformData.models.length,
                        capabilities: [`${platformData.models.length} models`],
                        isPlatform: true,
                        isCustom: false,
                        customModels: fiusModels,
                    });
                }

                // Built-in providers from agent
                for (const [provider, models] of Object.entries(supportedModels)) {
                    if (provider === 'fius') continue;
                    entries.push({
                        provider,
                        displayName: PROVIDER_DISPLAY_NAMES[provider] || provider,
                        planLabel: '',
                        modelCount: models.length,
                        capabilities: [],
                        isPlatform: false,
                        isCustom: false,
                    });
                }

                // Custom models grouped by displayProvider (real provider name)
                if (customModels.length > 0) {
                    const grouped = new Map<string, CustomModel[]>();
                    for (const model of customModels) {
                        const key = model.displayProvider || model.provider;
                        if (!grouped.has(key)) grouped.set(key, []);
                        grouped.get(key)!.push(model);
                    }

                    for (const [groupKey, models] of grouped) {
                        entries.push({
                            provider: `custom:${groupKey}`,
                            displayName: groupKey,
                            planLabel: '',
                            modelCount: models.length,
                            capabilities: ['custom'],
                            isPlatform: false,
                            isCustom: true,
                            customModels: models,
                        });
                    }
                }

                setProviders(entries);
                setIsLoading(false);
            } catch {
                setProviders([]);
                setIsLoading(false);
            }
        }, [agent]);

        useEffect(() => {
            if (!isVisible) return;
            let cancelled = false;
            void loadProviders().then(() => { if (cancelled) return; });
            return () => { cancelled = true; };
        }, [isVisible, loadProviders]);

        const filteredProviders = useMemo(() => {
            const q = searchQuery.trim();
            if (!q) return providers;
            return providers.filter((p) => matchesSearch(q, p.provider, p.displayName));
        }, [providers, searchQuery]);

        const ADD_CUSTOM_ROW = useMemo(
            () => ({
                provider: '__add_custom__',
                displayName: 'Add provider...',
                planLabel: '',
                modelCount: 0,
                capabilities: [] as string[],
                isPlatform: false,
                isCustom: false,
            }),
            [],
        );

        const displayList = useMemo(
            () => [...filteredProviders, ADD_CUSTOM_ROW],
            [filteredProviders, ADD_CUSTOM_ROW],
        );

        const ensureVisible = useCallback(
            (targetIndex: number) => {
                const maxOffset = Math.max(0, displayList.length - listViewportItems);
                let newOffset = scrollOffsetRef.current;
                if (targetIndex < newOffset) {
                    newOffset = targetIndex;
                } else if (targetIndex >= newOffset + listViewportItems) {
                    newOffset = targetIndex - listViewportItems + 1;
                }
                newOffset = Math.min(maxOffset, Math.max(0, newOffset));
                scrollOffsetRef.current = newOffset;
                setSelection({ index: targetIndex, offset: newOffset });
            },
            [displayList.length, listViewportItems],
        );

        const moveUp = useCallback(() => {
            const next = (selectedIndexRef.current - 1 + displayList.length) % displayList.length;
            selectedIndexRef.current = next;
            ensureVisible(next);
        }, [displayList.length, ensureVisible]);

        const moveDown = useCallback(() => {
            const next = (selectedIndexRef.current + 1) % displayList.length;
            selectedIndexRef.current = next;
            ensureVisible(next);
        }, [displayList.length, ensureVisible]);

        const enterDetail = useCallback(async (provider: ProviderEntry) => {
            setDetailProvider(provider);
            // Fetch models.dev data for enrichment
            const devIndex = await getModelsDevIndex();
            modelsDevRef.current = devIndex;
            // Deduplicate models by name, then enrich with models.dev data
            const rawModels = provider.customModels || [];
            const seen = new Set<string>();
            const enriched: CustomModel[] = [];
            for (const m of rawModels) {
                const key = m.name.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                const dev = devIndex.get(key);
                if (dev) {
                    enriched.push({
                        ...m,
                        maxInputTokens: m.maxInputTokens || dev.context || undefined,
                        maxOutputTokens: m.maxOutputTokens || dev.output || undefined,
                    });
                } else {
                    enriched.push(m);
                }
            }
            setDetailModels(enriched);
            detailIndexRef.current = 0;
            detailScrollOffsetRef.current = 0;
            setDetailSelection({ index: 0, offset: 0 });
            setSearchQuery('');
            selectedIndexRef.current = 0;
            scrollOffsetRef.current = 0;
            setSelection({ index: 0, offset: 0 });
        }, []);

        const exitDetail = useCallback(() => {
            setDetailProvider(null);
            setDetailModels([]);
            setDeleteStatus('idle');
        }, []);

        const deleteModel = useCallback(async (model: CustomModel) => {
            setDeleteStatus('deleting');
            try {
                await deleteCustomModel(model.name, model.provider);
                const updated = detailModels.filter(
                    (m) => !(m.name === model.name && m.provider === model.provider)
                );
                setDetailModels(updated);

                if (updated.length === 0) {
                    // No more models, go back to provider list
                    exitDetail();
                    await loadProviders();
                } else {
                    // Update detail provider
                    setDetailProvider((prev) =>
                        prev ? { ...prev, modelCount: updated.length, customModels: updated } : null
                    );
                    // Adjust selection
                    const maxIdx = Math.max(0, updated.length - 1);
                    if (detailIndexRef.current > maxIdx) {
                        detailIndexRef.current = maxIdx;
                        detailScrollOffsetRef.current = Math.max(0, maxIdx - listViewportItems + 1);
                        setDetailSelection({
                            index: maxIdx,
                            offset: detailScrollOffsetRef.current,
                        });
                    }
                    // Also refresh the main provider list
                    await loadProviders();
                }
            } catch {
                // ignore
            }
            setDeleteStatus('idle');
        }, [detailModels, exitDetail, loadProviders, listViewportItems]);

        const detailEnsureVisible = useCallback(
            (targetIndex: number) => {
                const maxOffset = Math.max(0, detailModels.length - listViewportItems);
                let newOffset = detailScrollOffsetRef.current;
                if (targetIndex < newOffset) {
                    newOffset = targetIndex;
                } else if (targetIndex >= newOffset + listViewportItems) {
                    newOffset = targetIndex - listViewportItems + 1;
                }
                newOffset = Math.min(maxOffset, Math.max(0, newOffset));
                detailScrollOffsetRef.current = newOffset;
                setDetailSelection({ index: targetIndex, offset: newOffset });
            },
            [detailModels.length, listViewportItems],
        );

        const selectCurrent = useCallback(() => {
            const item = displayList[selectedIndexRef.current];
            if (!item) return;
            if (item.provider === '__add_custom__') {
                onAddCustomProvider?.();
                return;
            }
            // All providers — enter detail view to see models
            enterDetail(item);
        }, [displayList, onAddCustomProvider, enterDetail]);

        useImperativeHandle(
            ref,
            () => ({
                handleInput(input: string, key: Key): boolean {
                    if (!isVisible) return false;

                    // Detail view mode
                    if (detailProvider) {
                        if (key.escape) { exitDetail(); return true; }
                        if (deleteStatus === 'deleting') return true;

                        if (key.upArrow) {
                            const next = (detailIndexRef.current - 1 + detailModels.length) % detailModels.length;
                            detailIndexRef.current = next;
                            detailEnsureVisible(next);
                            return true;
                        }
                        if (key.downArrow) {
                            const next = (detailIndexRef.current + 1) % detailModels.length;
                            detailIndexRef.current = next;
                            detailEnsureVisible(next);
                            return true;
                        }
                        if (key.return) {
                            if (detailProvider?.isCustom) {
                                const model = detailModels[detailIndexRef.current];
                                if (model) void deleteModel(model);
                            }
                            return true;
                        }
                        // Backspace on empty query → back to provider list
                        if ((key.backspace || key.delete) && searchQuery.length === 0) {
                            exitDetail();
                            return true;
                        }
                        return false;
                    }

                    // Provider list mode
                    if (isLoading) {
                        if (key.escape) onClose();
                        return true;
                    }
                    if (key.escape) { onClose(); return true; }
                    if (key.backspace || key.delete) {
                        if (searchQuery.length > 0) {
                            setSearchQuery((prev) => prev.slice(0, -1));
                            return true;
                        }
                        return false;
                    }
                    if (key.upArrow) { moveUp(); return true; }
                    if (key.downArrow) { moveDown(); return true; }
                    if (key.return) { selectCurrent(); return true; }
                    if (input && !key.return && !key.upArrow && !key.downArrow) {
                        if (input.length === 1 && input.charCodeAt(0) >= 32) {
                            setSearchQuery((prev) => prev + input);
                            selectedIndexRef.current = 0;
                            ensureVisible(0);
                            return true;
                        }
                    }
                    return false;
                },
            }),
            [
                isVisible, isLoading, displayList, searchQuery,
                detailProvider, detailModels, detailSelection, deleteStatus,
                onClose, moveUp, moveDown, selectCurrent, ensureVisible,
                exitDetail, detailEnsureVisible, deleteModel,
            ],
        );

        if (!isVisible) return null;

        // Detail view
        if (detailProvider) {
            return renderDetailView(
                detailProvider,
                detailModels,
                detailSelection,
                listViewportItems,
                overlayWidth,
                deleteStatus,
                searchQuery,
                modelsDevRef.current,
            );
        }

        // Provider list view
        const visibleItems = displayList.slice(selection.offset, selection.offset + listViewportItems);
        const blankLine = ' '.repeat(overlayWidth);
        const contentWidth = overlayWidth - 4;

        return (
            <Box flexDirection="column" width={overlayWidth}>
                {/* Header */}
                <Box paddingX={0} paddingY={0} width={overlayWidth}>
                    <Text color="cyan" bold>
                        {'  Providers'}
                    </Text>
                </Box>

                {/* Search */}
                <Box paddingX={0} paddingY={0} width={overlayWidth}>
                    <Text color={searchQuery ? 'white' : 'gray'}>
                        {formatLineToWidth(
                            `  Search: ${searchQuery || 'Type to filter...'}`,
                            overlayWidth,
                        )}
                    </Text>
                </Box>

                {/* Provider cards */}
                <Box flexDirection="column" marginTop={1} width={overlayWidth}>
                    <Box flexDirection="column" height={listViewportItems} width={overlayWidth}>
                        {isLoading || displayList.length === 0
                            ? Array.from({ length: listViewportItems }, (_, index) => (
                                  <Box
                                      key={`prov-empty-${index}`}
                                      paddingX={0}
                                      paddingY={0}
                                      width={overlayWidth}
                                  >
                                      <Text>
                                          {isLoading && index === 0
                                              ? formatLineToWidth('  Loading providers...', overlayWidth)
                                              : !isLoading && displayList.length === 0 && index === 0
                                                ? formatLineToWidth('  No providers available', overlayWidth)
                                                : blankLine}
                                      </Text>
                                  </Box>
                              ))
                            : Array.from({ length: listViewportItems }, (_, rowIndex) => {
                                  const item = visibleItems[rowIndex];
                                  if (!item) {
                                      return (
                                          <Box
                                              key={`prov-empty-${rowIndex}`}
                                              paddingX={0}
                                              paddingY={0}
                                              width={overlayWidth}
                                          >
                                              <Text>{blankLine}</Text>
                                          </Box>
                                      );
                                  }

                                  const actualIndex = selection.offset + rowIndex;
                                  const isSelected = actualIndex === selection.index;

                                  if (item.provider === '__add_custom__') {
                                      return renderAddCustomRow(isSelected, overlayWidth);
                                  }

                                  return renderProviderCard(item, isSelected, overlayWidth, contentWidth);
                              })}
                    </Box>
                </Box>

                {/* Hint bar */}
                <Box paddingX={0} paddingY={0} marginTop={1} width={overlayWidth}>
                    <HintBar
                        hints={['UP/DN navigate', 'Enter select', 'Esc close', 'Type search']}
                    />
                </Box>
            </Box>
        );
    },
);

/* ------------------------------------------------------------------ */
/*  Detail view for custom providers                                   */
/* ------------------------------------------------------------------ */

function renderDetailView(
    provider: ProviderEntry,
    models: CustomModel[],
    detailSelection: { index: number; offset: number },
    listViewportItems: number,
    overlayWidth: number,
    deleteStatus: 'idle' | 'deleting' | 'deleted',
    _searchQuery: string,
    modelsDevIndex: Map<string, ModelsDevEntry>,
): React.ReactNode {
    const visibleModels = models.slice(detailSelection.offset, detailSelection.offset + listViewportItems);
    const blankLine = ' '.repeat(overlayWidth);
    const contentWidth = overlayWidth - 4;

    const hints = deleteStatus === 'deleting'
        ? ['Deleting...']
        : provider.isCustom
            ? ['UP/DN navigate', 'Enter delete model', 'Esc back']
            : ['UP/DN navigate', 'Esc back'];

    return (
        <Box flexDirection="column" width={overlayWidth}>
            {/* Header */}
            <Box paddingX={0} paddingY={0} width={overlayWidth}>
                <Text color="cyan" bold>
                    {formatLineToWidth(`  ${provider.displayName}`, overlayWidth)}
                </Text>
            </Box>

            <Box paddingX={0} paddingY={0} width={overlayWidth}>
                <Text color="gray">
                    {formatLineToWidth(
                        `  ${provider.modelCount} model${provider.modelCount !== 1 ? 's' : ''}${provider.isCustom ? ' (Enter to delete)' : ''}`,
                        overlayWidth,
                    )}
                </Text>
            </Box>

            {/* Model list */}
            <Box flexDirection="column" marginTop={1} width={overlayWidth}>
                <Box flexDirection="column" height={listViewportItems} width={overlayWidth}>
                    {models.length === 0
                        ? Array.from({ length: listViewportItems }, (_, i) => (
                              <Box key={`dm-${i}`} paddingX={0} paddingY={0} width={overlayWidth}>
                                  <Text>{i === 0 ? formatLineToWidth('  No models', overlayWidth) : blankLine}</Text>
                              </Box>
                          ))
                        : Array.from({ length: listViewportItems }, (_, rowIndex) => {
                              const model = visibleModels[rowIndex];
                              if (!model) {
                                  return (
                                      <Box key={`dm-${rowIndex}`} paddingX={0} paddingY={0} width={overlayWidth}>
                                          <Text>{blankLine}</Text>
                                      </Box>
                                  );
                              }

                              const actualIndex = detailSelection.offset + rowIndex;
                              const isSelected = actualIndex === detailSelection.index;

                              const displayName = model.displayName || model.name;
                              const dev = modelsDevIndex.get(model.name.toLowerCase());
                              const ctxStr = (model.maxInputTokens || dev?.context)
                                  ? `${fmtCtx(model.maxInputTokens || dev!.context)} ctx`
                                  : '';
                              const outStr = (model.maxOutputTokens || dev?.output)
                                  ? `${fmtCtx(model.maxOutputTokens || dev!.output)} out`
                                  : '';
                              const modStr = dev?.input && dev.input !== 'text' ? dev.input : '';
                              const costParts: string[] = [];
                              if (dev?.costInput && dev.costInput > 0) costParts.push(`$${dev.costInput}/M in`);
                              if (dev?.costOutput && dev.costOutput > 0) costParts.push(`$${dev.costOutput}/M out`);

                              const icon = isSelected ? '►' : '◇';
                              const metaParts = [ctxStr, outStr, modStr, ...costParts].filter(Boolean);
                              const metaStr = metaParts.length > 0 ? ` | ${metaParts.join(' | ')}` : '';
                              const label = displayName;

                              return (
                                  <Box key={`dm-${model.name}`} paddingX={0} paddingY={0} width={overlayWidth}>
                                      <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                          {formatLineToWidth(`  ${icon} ${label}${metaStr}`, overlayWidth)}
                                      </Text>
                                  </Box>
                              );
                          })}
                </Box>
            </Box>

            {/* Hint bar */}
            <Box paddingX={0} paddingY={0} marginTop={1} width={overlayWidth}>
                <HintBar hints={hints} />
            </Box>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  Provider card — 2 lines per card                                   */
/*  Line 1: | Provider Name                    Model Count            */
/*  Line 2: +-------------------------------------------------+      */
/* ------------------------------------------------------------------ */

function renderProviderCard(
    item: ProviderEntry,
    isSelected: boolean,
    overlayWidth: number,
    contentWidth: number,
): React.ReactNode {
    const icon = isSelected ? '►' : '◇';
    const countStr = item.modelCount > 0 ? `(${item.modelCount})` : '';
    const line = `  ${icon} ${item.displayName} ${countStr}`;

    return (
        <Box key={`provider-card-${item.provider}`} paddingX={0} paddingY={0} width={overlayWidth}>
            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                {formatLineToWidth(line, overlayWidth)}
            </Text>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  Add custom provider row                                            */
/* ------------------------------------------------------------------ */

function renderAddCustomRow(isSelected: boolean, overlayWidth: number): React.ReactNode {
    const icon = isSelected ? '►' : '◇';
    const line = `  ${icon} Add provider`;

    return (
        <Box paddingX={0} paddingY={0} width={overlayWidth}>
            <Text color={isSelected ? 'green' : 'gray'} bold={isSelected}>
                {formatLineToWidth(line, overlayWidth)}
            </Text>
        </Box>
    );
}
