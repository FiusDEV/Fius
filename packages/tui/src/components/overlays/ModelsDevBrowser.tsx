

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
import { getCachedStringWidth, stripUnsafeCharacters, toCodePoints } from '../../utils/textUtils.js';
import { getMaxVisibleItemsForTerminalRows } from '../../utils/overlaySizing.js';
import { HintBar } from '../shared/HintBar.js';
import { saveCustomModel } from '@fiusdev/agent-management';
import type { CustomModel } from '@fiusdev/agent-management';
import type { LLMProvider } from '@fiusdev/llm';

interface ModelsDevProvider {
    id: string;
    name: string;
    modelCount: number;
    apiUrl?: string;
    envKey?: string;
}

interface ModelsDevModel {
    id: string;
    name: string;
    description: string;
    context: number;
    output: number;
    input: string;
    outputModalities: string;
    reasoning: boolean;
    toolCall: boolean;
    costInput: number;
    costOutput: number;
}

interface ModelsDevBrowserProps {
    isVisible: boolean;
    onClose: () => void;
    onModelAdded?: (model: CustomModel) => void;
}

export interface ModelsDevBrowserHandle {
    handleInput: (input: string, key: Key) => boolean;
}

let cachedApiData: Record<string, unknown> | null = null;
let cachePromise: Promise<Record<string, unknown>> | null = null;

async function fetchModelsDevData(): Promise<Record<string, unknown>> {
    if (cachedApiData) return cachedApiData;
    if (cachePromise) return cachePromise;
    cachePromise = (async () => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const resp = await fetch('https://models.dev/api.json', { signal: controller.signal });
            clearTimeout(timeout);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            cachedApiData = data as Record<string, unknown>;
            return cachedApiData;
        } catch (e) {
            cachePromise = null;
            throw e;
        }
    })();
    return cachePromise;
}

function norm(value: string): string {
    return stripUnsafeCharacters(value).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function fmtLine(value: string, width: number): string {
    if (width <= 0) return '';
    const n = norm(value);
    if (!n) return ' '.repeat(width);
    const w = getCachedStringWidth(n);
    if (w <= width) return n + ' '.repeat(width - w);
    if (width <= 3) return n.slice(0, width);
    let t = '';
    for (const ch of toCodePoints(n)) {
        if (getCachedStringWidth(t + ch) > width - 3) break;
        t += ch;
    }
    return t + '...';
}

function padR(text: string, width: number): string {
    const w = getCachedStringWidth(text);
    return w >= width ? text : text + ' '.repeat(width - w);
}

function fmtCtx(n: number): string {
    if (n === 0) return '-';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return String(n);
}

function fmtCost(n: number | undefined): string {
    if (!n || n === 0) return '-';
    return `$${n.toFixed(2)}`;
}

type Step = 'providers' | 'models' | 'config' | 'custom-config';

export const ModelsDevBrowser = forwardRef<ModelsDevBrowserHandle, ModelsDevBrowserProps>(
    function ModelsDevBrowser({ isVisible, onClose, onModelAdded }, ref) {
        const { rows: terminalRows, columns: terminalColumns } = useTerminalSize();
        const overlayWidth = useMemo(() => Math.max(32, terminalColumns - 4), [terminalColumns]);
        const listViewportItems = useMemo(
            () => getMaxVisibleItemsForTerminalRows({ rows: terminalRows, hardCap: 30, reservedRows: 10, minVisibleItems: 5 }),
            [terminalRows],
        );

        const [step, setStep] = useState<Step>('providers');
        const [providers, setProviders] = useState<ModelsDevProvider[]>([]);
        const [isLoading, setIsLoading] = useState(true);
        const [searchQuery, setSearchQuery] = useState('');
        const selectedIndexRef = useRef(0);
        const [selection, setSelection] = useState({ index: 0, offset: 0 });
        const scrollOffsetRef = useRef(0);

        const [selectedProvider, setSelectedProvider] = useState<ModelsDevProvider | null>(null);
        const [models, setModels] = useState<ModelsDevModel[]>([]);
        const [modelsLoading, setModelsLoading] = useState(false);
        const [loadError, setLoadError] = useState<string | null>(null);

        const [selectedModel, setSelectedModel] = useState<ModelsDevModel | null>(null);
        const [baseUrl, setBaseUrl] = useState('');
        const [apiKey, setApiKey] = useState('');
        const [configField, setConfigField] = useState<'baseURL' | 'apiKey'>('baseURL');
        const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

        // Custom provider fields
        const [customModelName, setCustomModelName] = useState('');
        const [customBaseUrl, setCustomBaseUrl] = useState('');
        const [customApiKey, setCustomApiKey] = useState('');
        const [customField, setCustomField] = useState<'modelName' | 'baseURL' | 'apiKey'>('modelName');

        const stepRef = useRef(step);
        const searchQueryRef = useRef(searchQuery);
        const configFieldRef = useRef(configField);
        const saveStatusRef = useRef(saveStatus);
        const customFieldRef = useRef(customField);
        stepRef.current = step;
        searchQueryRef.current = searchQuery;
        configFieldRef.current = configField;
        saveStatusRef.current = saveStatus;
        customFieldRef.current = customField;

        useEffect(() => {
            if (!isVisible) return;
            let cancelled = false;

            const load = async () => {
                try {
                    const data = await fetchModelsDevData();
                    if (cancelled) return;

                    const entries = Object.entries(data);
                    const provs: ModelsDevProvider[] = [];
                    for (const [id, providerData] of entries) {
                        const p = providerData as Record<string, unknown>;
                        const modelsObj = p.models as Record<string, unknown> | undefined;
                        const modelCount = modelsObj ? Object.keys(modelsObj).length : 0;
                        if (modelCount === 0) continue;
                        const name = (p.name as string) || id;
                        const apiUrl = (p.api as string) || undefined;
                        const envRaw = p.env;
                        const envKey = Array.isArray(envRaw) ? envRaw[0] : (typeof envRaw === 'string' ? envRaw.split(' ')[0] : undefined);
                        provs.push({ id, name, modelCount, apiUrl, envKey });
                    }
                    provs.sort((a, b) => b.modelCount - a.modelCount);
                    // Add "Custom Provider" entry at the end
                    provs.push({ id: '__custom__', name: 'Custom Provider', modelCount: 0 });
                    setProviders(provs);
                    setLoadError(null);
                    setIsLoading(false);
                } catch (e) {
                    if (!cancelled) {
                        setProviders([]);
                        setLoadError(e instanceof Error ? e.message : 'Network error');
                        setIsLoading(false);
                    }
                }
            };

            void load();
            return () => { cancelled = true; };
        }, [isVisible]);

        const filteredProviders = useMemo(() => {
            const q = searchQuery.trim().toLowerCase();
            if (!q) return providers;
            return providers.filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
        }, [providers, searchQuery]);

        const filteredModels = useMemo(() => {
            const q = searchQuery.trim().toLowerCase();
            if (!q) return models;
            return models.filter((m) =>
                m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
            );
        }, [models, searchQuery]);

        const displayList = useMemo(() => {
            if (step === 'providers') return filteredProviders;
            if (step === 'models') return filteredModels;
            return [];
        }, [step, filteredProviders, filteredModels]);

        const displayListRef = useRef(displayList);
        displayListRef.current = displayList;

        const ensureVisible = useCallback((targetIndex: number) => {
            const maxOffset = Math.max(0, displayList.length - listViewportItems);
            let newOffset = scrollOffsetRef.current;
            if (targetIndex < newOffset) newOffset = targetIndex;
            else if (targetIndex >= newOffset + listViewportItems) newOffset = targetIndex - listViewportItems + 1;
            newOffset = Math.min(maxOffset, Math.max(0, newOffset));
            scrollOffsetRef.current = newOffset;
            setSelection({ index: targetIndex, offset: newOffset });
        }, [displayList.length, listViewportItems]);

        const moveUp = useCallback(() => {
            const len = displayList.length || 1;
            const next = (selectedIndexRef.current - 1 + len) % len;
            selectedIndexRef.current = next;
            ensureVisible(next);
        }, [displayList.length, ensureVisible]);

        const moveDown = useCallback(() => {
            const len = displayList.length || 1;
            const next = (selectedIndexRef.current + 1) % len;
            selectedIndexRef.current = next;
            ensureVisible(next);
        }, [displayList.length, ensureVisible]);

        const goBack = useCallback(() => {
            if (step === 'config') {
                setStep('models'); setSelectedModel(null); setBaseUrl(''); setApiKey('');
                setSaveStatus('idle'); setSearchQuery('');
                selectedIndexRef.current = 0; scrollOffsetRef.current = 0;
                setSelection({ index: 0, offset: 0 });
            } else if (step === 'custom-config') {
                setStep('providers'); setCustomModelName(''); setCustomBaseUrl(''); setCustomApiKey('');
                setSaveStatus('idle'); setSearchQuery(''); setCustomField('modelName');
                selectedIndexRef.current = 0; scrollOffsetRef.current = 0;
                setSelection({ index: 0, offset: 0 });
            } else if (step === 'models') {
                setStep('providers'); setSelectedProvider(null); setModels([]);
                setSearchQuery(''); selectedIndexRef.current = 0; scrollOffsetRef.current = 0;
                setSelection({ index: 0, offset: 0 });
            } else {
                onClose();
            }
        }, [step, onClose]);

        const selectCurrent = useCallback(async () => {
            if (step === 'providers') {
                const prov = filteredProviders[selectedIndexRef.current];
                if (!prov) return;
                // Handle "Custom Provider" entry
                if (prov.id === '__custom__') {
                    setStep('custom-config');
                    setCustomModelName(''); setCustomBaseUrl(''); setCustomApiKey('');
                    setCustomField('modelName'); setSearchQuery('');
                    selectedIndexRef.current = 0; scrollOffsetRef.current = 0;
                    setSelection({ index: 0, offset: 0 });
                    return;
                }
                setSelectedProvider(prov);
                setModelsLoading(true);
                setStep('models');
                setSearchQuery(''); selectedIndexRef.current = 0; scrollOffsetRef.current = 0;
                setSelection({ index: 0, offset: 0 });

                try {
                    const data = await fetchModelsDevData();
                    const provData = data[prov.id] as Record<string, unknown> | undefined;
                    const modelsObj = (provData?.models ?? {}) as Record<string, Record<string, unknown>>;
                    const entries = Object.entries(modelsObj);

                    const modelList: ModelsDevModel[] = [];
                    for (const [modelId, mData] of entries) {
                        if (!mData || typeof mData !== 'object') continue;
                        const m = mData as Record<string, unknown>;
                        const limit = (m.limit ?? {}) as Record<string, number>;
                        const modalities = (m.modalities ?? {}) as Record<string, string>;
                        const cost = (m.cost ?? {}) as Record<string, number>;
                        modelList.push({
                            id: modelId,
                            name: String(m.name || modelId),
                            description: String(m.description || ''),
                            context: Number(limit.context) || 0,
                            output: Number(limit.output) || 0,
                            input: String(modalities.input || 'text'),
                            outputModalities: String(modalities.output || 'text'),
                            reasoning: Boolean(m.reasoning),
                            toolCall: Boolean(m.tool_call),
                            costInput: Number(cost.input) || 0,
                            costOutput: Number(cost.output) || 0,
                        });
                    }
                    modelList.sort((a, b) => b.context - a.context);
                    setModels(modelList);
                } catch {
                    setModels([]);
                }
                setModelsLoading(false);
            } else if (step === 'models') {
                const model = filteredModels[selectedIndexRef.current];
                if (!model) return;
                setSelectedModel(model);
                setBaseUrl(selectedProvider?.apiUrl || '');
                setStep('config'); setSearchQuery(''); setConfigField(selectedProvider?.apiUrl ? 'apiKey' : 'baseURL');
            } else if (step === 'config') {
                if (saveStatus === 'saved') { onClose(); return; }
                if (!baseUrl.trim() || !selectedModel || !selectedProvider) return;
                setSaveStatus('saving');
                try {
                    const customModel: CustomModel = {
                        name: selectedModel.id,
                        provider: 'openai-compatible',
                        displayProvider: selectedProvider?.name || selectedProvider?.id || 'custom',
                        baseURL: baseUrl.trim(),
                        displayName: selectedModel.name,
                        maxInputTokens: selectedModel.context || undefined,
                        maxOutputTokens: selectedModel.output || undefined,
                        apiKey: apiKey.trim() || undefined,
                    };
                    await saveCustomModel(customModel);
                    setSaveStatus('saved');
                    onModelAdded?.(customModel);
                } catch {
                    setSaveStatus('error');
                }
            } else if (step === 'custom-config') {
                if (saveStatus === 'saved') { onClose(); return; }
                if (!customModelName.trim() || !customBaseUrl.trim()) return;
                setSaveStatus('saving');
                try {
                    const customModel: CustomModel = {
                        name: customModelName.trim(),
                        provider: 'openai-compatible',
                        displayProvider: new URL(customBaseUrl.trim()).hostname.replace(/^www\./, ''),
                        baseURL: customBaseUrl.trim(),
                        displayName: customModelName.trim(),
                        apiKey: customApiKey.trim() || undefined,
                    };
                    await saveCustomModel(customModel);
                    setSaveStatus('saved');
                    onModelAdded?.(customModel);
                } catch {
                    setSaveStatus('error');
                }
            }
        }, [step, filteredProviders, filteredModels, selectedProvider, selectedModel, baseUrl, apiKey, saveStatus, customModelName, customBaseUrl, customApiKey, onClose, onModelAdded]);

        const goBackRef = useRef(goBack);
        goBackRef.current = goBack;
        const moveUpRef = useRef(moveUp);
        moveUpRef.current = moveUp;
        const moveDownRef = useRef(moveDown);
        moveDownRef.current = moveDown;
        const selectCurrentRef = useRef(selectCurrent);
        selectCurrentRef.current = selectCurrent;

        useImperativeHandle(ref, () => ({
            handleInput(input: string, key: Key): boolean {
                if (!isVisible) return false;
                if (saveStatusRef.current === 'saving') return true;

                const curStep = stepRef.current;
                const curQuery = searchQueryRef.current;
                const curConfigField = configFieldRef.current;

                if (key.escape) { goBackRef.current(); return true; }
                if (key.backspace || key.delete) {
                    if (curStep === 'config') {
                        if (curConfigField === 'apiKey') setApiKey((p) => p.slice(0, -1));
                        else setBaseUrl((p) => p.slice(0, -1));
                        return true;
                    }
                    if (curStep === 'custom-config') {
                        const curCF = customFieldRef.current;
                        if (curCF === 'modelName') setCustomModelName((p) => p.slice(0, -1));
                        else if (curCF === 'baseURL') setCustomBaseUrl((p) => p.slice(0, -1));
                        else setCustomApiKey((p) => p.slice(0, -1));
                        return true;
                    }
                    if (curQuery.length > 0) { setSearchQuery((p) => p.slice(0, -1)); return true; }
                    return false;
                }
                if (key.tab && curStep === 'config') {
                    setConfigField((p) => (p === 'baseURL' ? 'apiKey' : 'baseURL'));
                    return true;
                }
                if (key.tab && curStep === 'custom-config') {
                    setCustomField((p) => {
                        if (p === 'modelName') return 'baseURL';
                        if (p === 'baseURL') return 'apiKey';
                        return 'modelName';
                    });
                    return true;
                }
                if ((key.upArrow || key.downArrow) && curStep === 'config') {
                    setConfigField((p) => (p === 'baseURL' ? 'apiKey' : 'baseURL'));
                    return true;
                }
                if ((key.upArrow || key.downArrow) && curStep === 'custom-config') {
                    setCustomField((p) => {
                        if (key.upArrow) {
                            if (p === 'modelName') return 'apiKey';
                            if (p === 'baseURL') return 'modelName';
                            return 'baseURL';
                        }
                        if (p === 'modelName') return 'baseURL';
                        if (p === 'baseURL') return 'apiKey';
                        return 'modelName';
                    });
                    return true;
                }
                if (key.upArrow) { moveUpRef.current(); return true; }
                if (key.downArrow) { moveDownRef.current(); return true; }
                if (key.return) { selectCurrentRef.current(); return true; }

                if (curStep === 'config') {
                    if (input && input.length === 1 && input.charCodeAt(0) >= 32) {
                        if (curConfigField === 'apiKey') setApiKey((p) => p + input);
                        else setBaseUrl((p) => p + input);
                        return true;
                    }
                    return false;
                }

                if (curStep === 'custom-config') {
                    if (input && input.length === 1 && input.charCodeAt(0) >= 32) {
                        const curCF = customFieldRef.current;
                        if (curCF === 'modelName') setCustomModelName((p) => p + input);
                        else if (curCF === 'baseURL') setCustomBaseUrl((p) => p + input);
                        else setCustomApiKey((p) => p + input);
                        return true;
                    }
                    return false;
                }

                if (input && input.length === 1 && input.charCodeAt(0) >= 32) {
                    setSearchQuery((p) => p + input);
                    selectedIndexRef.current = 0;
                    ensureVisible(0);
                    return true;
                }
                return false;
            },
        }), [isVisible, onClose, ensureVisible]);

        if (!isVisible) return null;

        const blankLine = ' '.repeat(overlayWidth);
        const cw = overlayWidth - 4;

        const title = step === 'providers' ? 'Browse Models (models.dev)'
            : step === 'models' ? `Models - ${selectedProvider?.name ?? ''}`
            : step === 'custom-config' ? 'Add Custom Provider'
            : `Add ${selectedProvider?.name ?? ''} model`;

        const hints = step === 'config'
            ? [`↑↓ switch (${configField === 'baseURL' ? 'URL' : 'Key'})`, 'Enter save', 'Esc back']
            : step === 'custom-config'
            ? [`↑↓ switch (${customField === 'modelName' ? 'Name' : customField === 'baseURL' ? 'URL' : 'Key'})`, 'Enter save', 'Esc back']
            : ['UP/DN navigate', 'Enter select', 'Esc back', 'Type search'];

        return (
            <Box flexDirection="column" width={overlayWidth}>
                <Box width={overlayWidth}>
                    <Text color="cyan" bold>{fmtLine(`  ${title}`, overlayWidth)}</Text>
                </Box>
                {step !== 'config' && step !== 'custom-config' && (
                    <Box width={overlayWidth}>
                        <Text color={searchQuery ? 'white' : 'gray'}>
                            {fmtLine(`  Search: ${searchQuery || 'Type to filter...'}`, overlayWidth)}
                        </Text>
                    </Box>
                )}
                <Box flexDirection="column" marginTop={1} width={overlayWidth}>
                    <Box flexDirection="column" height={listViewportItems} width={overlayWidth}>
                        {step === 'custom-config' ? (
                            renderCustomConfig(customModelName, customBaseUrl, customApiKey, customField, saveStatus, overlayWidth)
                        ) : step === 'config' ? (
                            renderConfig(selectedModel, selectedProvider, configField, baseUrl, apiKey, saveStatus, overlayWidth)
                        ) : (isLoading || modelsLoading) ? (
                            Array.from({ length: listViewportItems }, (_, i) => (
                                <Box key={`me-${i}`} width={overlayWidth}>
                                    <Text>{i === 0 ? fmtLine('  Loading...', overlayWidth) : blankLine}</Text>
                                </Box>
                            ))
                        ) : displayList.length === 0 ? (
                            Array.from({ length: listViewportItems }, (_, i) => (
                                <Box key={`me-${i}`} width={overlayWidth}>
                                    <Text>{i === 0 ? fmtLine(loadError ? `  Error: ${loadError}` : '  No results', overlayWidth) : blankLine}</Text>
                                </Box>
                            ))
                        ) : (
                            Array.from({ length: listViewportItems }, (_, ri) => {
                                const actualIndex = selection.offset + ri;
                                const item = displayList[actualIndex];
                                if (!item) return <Box key={`me-${ri}`} width={overlayWidth}><Text>{blankLine}</Text></Box>;
                                const sel = actualIndex === selection.index;
                                if (step === 'providers') return renderProv(item as ModelsDevProvider, sel, overlayWidth, cw);
                                return renderModel(item as ModelsDevModel, sel, overlayWidth, cw);
                            })
                        )}
                    </Box>
                </Box>
                <Box width={overlayWidth} marginTop={1}>
                    <HintBar hints={hints} />
                </Box>
            </Box>
        );
    },
);

function renderProv(p: ModelsDevProvider, sel: boolean, ow: number, cw: number): React.ReactNode {
    const selChar = sel ? '>' : ' ';
    const nameStr = `${selChar} ${p.name}`;
    const countStr = `(${p.modelCount})`;
    const namePadded = padR(nameStr, cw - getCachedStringWidth(countStr) - 1);
    const line1 = `  | ${namePadded}${countStr}`;
    const line2 = `  +${'-'.repeat(cw - 1)}+`;
    return (
        <Box key={p.id} flexDirection="column" width={ow}>
            <Box width={ow}><Text color={sel ? 'cyan' : 'gray'} bold={sel}>{fmtLine(line1, ow)}</Text></Box>
            <Box width={ow}><Text color={sel ? 'cyan' : 'gray'}>{fmtLine(line2, ow)}</Text></Box>
        </Box>
    );
}

function renderModel(m: ModelsDevModel, sel: boolean, ow: number, cw: number): React.ReactNode {
    const selChar = sel ? '>' : ' ';
    const displayName = m.name || m.id;
    const caps: string[] = [];
    if (m.reasoning) caps.push('Reasoning');
    if (m.toolCall) caps.push('Tools');
    const costParts: string[] = [];
    if (m.costInput > 0) costParts.push(`$${m.costInput}/M in`);
    if (m.costOutput > 0) costParts.push(`$${m.costOutput}/M out`);
    const meta = [...caps, ...costParts].join(' | ');
    const ctxStr = m.context > 0 ? `${fmtCtx(m.context)} ctx` : '';
    const outStr = m.output > 0 ? `${fmtCtx(m.output)} out` : '';
    const modStr = m.input || 'text';
    const line1 = `  ${selChar} ${displayName}`;
    const line2 = `    ${[ctxStr, outStr, modStr].filter(Boolean).join(' | ')}${meta ? ' | ' + meta : ''}`;
    return (
        <Box key={m.id} flexDirection="column" width={ow}>
            <Box width={ow}><Text color={sel ? 'yellow' : 'gray'} bold={sel}>{fmtLine(line1, ow)}</Text></Box>
            <Box width={ow}><Text color={sel ? 'white' : 'gray'}>{fmtLine(line2, ow)}</Text></Box>
        </Box>
    );
}

function renderCustomConfig(
    modelName: string,
    baseUrl: string,
    apiKey: string,
    activeField: 'modelName' | 'baseURL' | 'apiKey',
    saveStatus: 'idle' | 'saving' | 'saved' | 'error',
    ow: number,
): React.ReactNode {
    const nameDisp = modelName || '(enter model name, e.g. gpt-4o)';
    const urlDisp = baseUrl || '(enter API base URL, e.g. https://api.openai.com/v1)';
    const keyDisp = apiKey || '(enter API key)';
    const nameActive = activeField === 'modelName';
    const urlActive = activeField === 'baseURL';
    const keyActive = activeField === 'apiKey';
    let statusLine = '';
    let statusColor = 'gray';
    if (saveStatus === 'saving') { statusLine = '  Saving...'; statusColor = 'yellow'; }
    else if (saveStatus === 'saved') { statusLine = '  Saved! Enter to close'; statusColor = 'green'; }
    else if (saveStatus === 'error') { statusLine = '  Error saving'; statusColor = 'red'; }
    return (
        <Box flexDirection="column" width={ow}>
            <Box width={ow}><Text color="cyan" bold>{fmtLine('  Custom Provider', ow)}</Text></Box>
            <Box width={ow} marginTop={1}>
                <Text color={nameActive ? 'cyan' : 'white'}>
                    {fmtLine(`  Model Name: ${nameActive ? '>' : ' '}`, 16)}
                </Text>
                <Text color={nameActive ? 'cyan' : modelName ? 'white' : 'gray'}>
                    {fmtLine(nameDisp, ow - 16)}
                </Text>
            </Box>
            <Box width={ow}>
                <Text color={urlActive ? 'cyan' : 'white'}>
                    {fmtLine(`  Base URL:   ${urlActive ? '>' : ' '}`, 16)}
                </Text>
                <Text color={urlActive ? 'cyan' : baseUrl ? 'white' : 'gray'}>
                    {fmtLine(urlDisp, ow - 16)}
                </Text>
            </Box>
            <Box width={ow}>
                <Text color={keyActive ? 'cyan' : 'white'}>
                    {fmtLine(`  API Key:    ${keyActive ? '>' : ' '}`, 16)}
                </Text>
                <Text color={keyActive ? 'cyan' : apiKey ? 'white' : 'gray'}>
                    {fmtLine(keyDisp, ow - 16)}
                </Text>
            </Box>
            {statusLine && <Box width={ow} marginTop={1}><Text color={statusColor}>{fmtLine(statusLine, ow)}</Text></Box>}
        </Box>
    );
}

function renderConfig(
    model: ModelsDevModel | null,
    provider: ModelsDevProvider | null,
    activeField: 'baseURL' | 'apiKey',
    baseUrl: string,
    apiKey: string,
    saveStatus: 'idle' | 'saving' | 'saved' | 'error',
    ow: number,
): React.ReactNode {
    if (!model) return null;
    const provName = provider?.name ?? '';
    const urlDisp = baseUrl || '(enter API base URL)';
    const keyDisp = apiKey || '(enter API key)';
    const urlActive = activeField === 'baseURL';
    const keyActive = activeField === 'apiKey';
    let statusLine = '';
    let statusColor = 'gray';
    if (saveStatus === 'saving') { statusLine = '  Saving...'; statusColor = 'yellow'; }
    else if (saveStatus === 'saved') { statusLine = '  Saved! Enter to close'; statusColor = 'green'; }
    else if (saveStatus === 'error') { statusLine = '  Error saving'; statusColor = 'red'; }
    return (
        <Box flexDirection="column" width={ow}>
            <Box width={ow}><Text color="yellow" bold>{fmtLine(`  ${provName} - ${model.name}`, ow)}</Text></Box>
            <Box width={ow}><Text color="gray">{fmtLine(`    ${model.id}`, ow)}</Text></Box>
            {model.context > 0 && <Box width={ow}><Text color="gray">{fmtLine(`    ${fmtCtx(model.context)} ctx | ${model.input} | ${model.outputModalities}`, ow)}</Text></Box>}
            <Box width={ow} marginTop={1}>
                <Text color={urlActive ? 'cyan' : 'white'}>
                    {fmtLine(`  Base URL: ${urlActive ? '>' : ' '}`, 16)}
                </Text>
                <Text color={urlActive ? 'cyan' : baseUrl ? 'white' : 'gray'}>
                    {fmtLine(urlDisp, ow - 16)}
                </Text>
            </Box>
            <Box width={ow}>
                <Text color={keyActive ? 'cyan' : 'white'}>
                    {fmtLine(`  API Key:  ${keyActive ? '>' : ' '}`, 16)}
                </Text>
                <Text color={keyActive ? 'cyan' : apiKey ? 'white' : 'gray'}>
                    {fmtLine(keyDisp, ow - 16)}
                </Text>
            </Box>
            {statusLine && <Box width={ow} marginTop={1}><Text color={statusColor}>{fmtLine(statusLine, ow)}</Text></Box>}
        </Box>
    );
}
