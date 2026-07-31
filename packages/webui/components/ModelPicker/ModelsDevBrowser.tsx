import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Search, Plus, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '@/lib/utils';
import { CapabilityIcons } from './CapabilityIcons';
import { getSupportedFileTypesFromModelsDev } from './models-dev-lookup';

interface ModelsDevModel {
    name: string;
    description?: string;
    limit?: { context?: number; output?: number };
    modalities?: { input?: string; output?: string };
    cost?: { input?: number; output?: number };
    reasoning?: boolean;
    tool_call?: boolean;
}

interface ModelsDevProvider {
    name: string;
    api?: string;
    env?: string[];
    models: Record<string, ModelsDevModel>;
}

interface ModelsDevData {
    [providerId: string]: ModelsDevProvider;
}

type BrowserStep = 'providers' | 'models' | 'config' | 'custom-config';

interface ModelsDevBrowserProps {
    onAddModel: (model: {
        name: string;
        provider: string;
        displayProvider: string;
        baseURL?: string;
        apiKey?: string;
        displayName?: string;
        supportedFileTypes?: string[];
    }) => void;
    onCancel: () => void;
}

let cachedData: ModelsDevData | null = null;
let cachePromise: Promise<ModelsDevData> | null = null;

async function fetchModelsDevData(): Promise<ModelsDevData> {
    if (cachedData) return cachedData;
    if (cachePromise) return cachePromise;

    cachePromise = (async () => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const resp = await fetch('https://models.dev/api.json', { signal: controller.signal });
            clearTimeout(timeout);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            cachedData = data;
            return data;
        } catch {
            cachePromise = null;
            return {};
        }
    })();

    return cachePromise;
}

export function ModelsDevBrowser({ onAddModel, onCancel }: ModelsDevBrowserProps) {
    const [step, setStep] = useState<BrowserStep>('providers');
    const [providers, setProviders] = useState<Array<{ id: string; name: string; modelCount: number; data: ModelsDevProvider }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [selectedProvider, setSelectedProvider] = useState<{ id: string; data: ModelsDevProvider } | null>(null);
    const [selectedModel, setSelectedModel] = useState<{ id: string; data: ModelsDevModel } | null>(null);
    const [baseURL, setBaseURL] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [modelName, setModelName] = useState('');

    useEffect(() => {
        fetchModelsDevData().then((data) => {
            const list = Object.entries(data)
                .map(([id, provider]) => ({
                    id,
                    name: provider.name || id,
                    modelCount: Object.keys(provider.models || {}).length,
                    data: provider,
                }))
                .filter((p) => p.modelCount > 0)
                .sort((a, b) => b.modelCount - a.modelCount);
            setProviders(list);
            setLoading(false);
        });
    }, []);

    const filteredProviders = useMemo(() => {
        if (!search) return providers;
        const q = search.toLowerCase();
        return providers.filter(
            (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
        );
    }, [providers, search]);

    const filteredModels = useMemo(() => {
        if (!selectedProvider) return [];
        const models = Object.entries(selectedProvider.data.models || {}).map(([id, model]) => ({
            id,
            data: model,
        }));
        if (!search) return models;
        const q = search.toLowerCase();
        return models.filter(
            (m) =>
                m.data.name.toLowerCase().includes(q) ||
                m.id.toLowerCase().includes(q)
        );
    }, [selectedProvider, search]);

    const handleProviderSelect = (provider: { id: string; data: ModelsDevProvider }) => {
        setSelectedProvider(provider);
        setSearch('');
        setBaseURL(provider.data.api || '');
        setStep('models');
    };

    const handleModelSelect = (model: { id: string; data: ModelsDevModel }) => {
        setSelectedModel(model);
        setStep('config');
    };

    const handleCustomProvider = () => {
        setStep('custom-config');
        setSearch('');
    };

    const handleSave = () => {
        if (!selectedProvider || !selectedModel) return;
        onAddModel({
            name: selectedModel.id,
            provider: selectedProvider.id,
            displayProvider: selectedProvider.name,
            baseURL: baseURL || selectedProvider.data.api,
            apiKey: apiKey || undefined,
            displayName: selectedModel.data.name || selectedModel.id,
            supportedFileTypes: getSupportedFileTypes(selectedModel.data),
        });
    };

    const handleSaveCustom = async () => {
        if (!modelName.trim()) return;
        let provider = 'custom';
        if (baseURL.trim()) {
            try {
                const u = new URL(baseURL.trim());
                provider = u.hostname;
            } catch {
                provider = baseURL.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            }
        }
        let supportedFileTypes: string[] | undefined;
        try {
            const caps = await lookupModelCapabilities(provider, modelName.trim());
            if (caps && caps.fileTypes.length > 0) supportedFileTypes = caps.fileTypes;
        } catch { }
        onAddModel({
            name: modelName.trim(),
            provider,
            displayProvider: provider,
            baseURL: baseURL || undefined,
            apiKey: apiKey || undefined,
            supportedFileTypes,
        });
    };

    const formatContext = (context?: number) => {
        if (!context) return '';
        if (context >= 1000000) return `${(context / 1000000).toFixed(0)}M`;
        if (context >= 1000) return `${(context / 1000).toFixed(0)}K`;
        return String(context);
    };

    const getModalities = (model: ModelsDevModel): string[] => {
        const mods: string[] = [];
        const input = model.modalities?.input || '';
        const output = model.modalities?.output || '';
        if (input.includes('text') || output.includes('text')) mods.push('text');
        if (input.includes('image') || output.includes('image')) mods.push('image');
        if (input.includes('video') || output.includes('video')) mods.push('video');
        if (input.includes('audio') || output.includes('audio')) mods.push('audio');
        if (input.includes('pdf') || output.includes('pdf')) mods.push('pdf');
        if (mods.length === 0 && !input && !output) mods.push('text');
        return mods;
    };

    const getSupportedFileTypes = (model: ModelsDevModel): string[] => {
        const types = getSupportedFileTypesFromModelsDev(model);
        return types.length > 0 ? types : ['image', 'pdf'];
    };

    return (
        <div className="flex flex-col" style={{ height: '100%', maxHeight: '460px', overflow: 'hidden' }}>
            {/* Header */}
            <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border/30">
                {step !== 'providers' && (
                    <button
                        onClick={() => {
                            if (step === 'models') { setStep('providers'); setSelectedProvider(null); setSearch(''); }
                            else if (step === 'config') { setStep('models'); setSelectedModel(null); }
                            else if (step === 'custom-config') { setStep('providers'); setSearch(''); }
                        }}
                        className="p-1 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                )}
                <div className="flex-1">
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={
                            step === 'providers' ? 'Search providers...' :
                            step === 'models' ? 'Search models...' :
                            step === 'config' ? '' :
                            'Model name...'
                        }
                        className="h-8 text-sm"
                        disabled={step === 'config'}
                        autoFocus={step !== 'config'}
                    />
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-3" style={{ minHeight: 0 }}>
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : error ? (
                    <div className="text-center py-8 text-sm text-destructive">{error}</div>
                ) : step === 'providers' ? (
                    <div className="space-y-1">
                        {filteredProviders.map((provider) => (
                            <button
                                key={provider.id}
                                onClick={() => handleProviderSelect(provider)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-muted/50 transition-colors group"
                            >
                                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                                    {provider.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-foreground truncate">{provider.name}</div>
                                    <div className="text-[11px] text-muted-foreground">{provider.modelCount} models</div>
                                </div>
                                <div className="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
                                    →
                                </div>
                            </button>
                        ))}
                        <button
                            onClick={handleCustomProvider}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-muted/50 transition-colors border border-dashed border-border/50 mt-2"
                        >
                            <div className="w-8 h-8 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-muted-foreground/50">
                                <Plus className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-muted-foreground">Custom Provider</div>
                                <div className="text-[11px] text-muted-foreground/70">Add any OpenAI-compatible API</div>
                            </div>
                        </button>
                    </div>
                ) : step === 'models' ? (
                    <div className="space-y-1">
                        {filteredModels.length === 0 ? (
                            <div className="text-center py-8 text-sm text-muted-foreground">No models found</div>
                        ) : (
                            filteredModels.map((model) => (
                                <button
                                    key={model.id}
                                    onClick={() => handleModelSelect(model)}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-muted/50 transition-colors group"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-foreground truncate">
                                            {model.data.name || model.id}
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            {model.data.limit?.context && (
                                                <span className="text-[11px] text-muted-foreground">Ctx: {formatContext(model.data.limit.context)}</span>
                                            )}
                                            {model.data.limit?.output && (
                                                <span className="text-[11px] text-muted-foreground">Out: {formatContext(model.data.limit.output)}</span>
                                            )}
                                            <CapabilityIcons
                                                supportedFileTypes={getSupportedFileTypes(model.data)}
                                                hasApiKey={true}
                                                showReasoning={model.data.reasoning}
                                                showLockIcon={false}
                                                size="sm"
                                            />
                                        </div>
                                    </div>
                                    <div className="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
                                        →
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                ) : step === 'config' ? (
                    <div className="space-y-4">
                        <div className="text-center py-2">
                            <div className="text-sm font-medium text-foreground">{selectedModel?.data.name || selectedModel?.id}</div>
                            <div className="text-xs text-muted-foreground">{selectedProvider?.name}</div>
                        </div>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Base URL</Label>
                                <Input
                                    value={baseURL}
                                    onChange={(e) => setBaseURL(e.target.value)}
                                    placeholder="https://api.example.com/v1"
                                    className="h-8 text-sm font-mono"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">API Key</Label>
                                <Input
                                    type="password"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="h-8 text-sm font-mono"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={onCancel} className="flex-1 h-9">
                                Cancel
                            </Button>
                            <Button onClick={handleSave} disabled={!selectedModel} className="flex-1 h-9">
                                Add Model
                            </Button>
                        </div>
                    </div>
                ) : (
                    /* Custom provider config */
                    <div className="space-y-4">
                        <div className="text-center py-2">
                            <div className="text-sm font-medium text-foreground">Custom Provider</div>
                            <div className="text-xs text-muted-foreground">Add any OpenAI-compatible API</div>
                        </div>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Model Name *</Label>
                                <Input
                                    value={modelName}
                                    onChange={(e) => setModelName(e.target.value)}
                                    placeholder="e.g. gpt-4o, claude-sonnet-4-5"
                                    className="h-8 text-sm"
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Base URL *</Label>
                                <Input
                                    value={baseURL}
                                    onChange={(e) => setBaseURL(e.target.value)}
                                    placeholder="https://api.example.com/v1"
                                    className="h-8 text-sm font-mono"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">API Key</Label>
                                <Input
                                    type="password"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="h-8 text-sm font-mono"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={onCancel} className="flex-1 h-9">
                                Cancel
                            </Button>
                            <Button onClick={handleSaveCustom} disabled={!modelName.trim() || !baseURL.trim()} className="flex-1 h-9">
                                Add Provider
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
