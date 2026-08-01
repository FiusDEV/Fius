/**
 * Model Picker Modal
 *
 * Allows users to browse and switch between LLM models across providers.
 *
 * TODO: Implement "Run via" toggle for featured models
 * - Show a single model card with toggle buttons: "Fius / Direct / OpenRouter"
 * - Toggle changes both provider AND model ID (e.g., fius uses OpenRouter IDs,
 *   direct uses native IDs like claude-sonnet-4-5 vs anthropic/claude-sonnet-4.5)
 * - Disable toggles when credentials are missing (e.g., no ANTHROPIC_API_KEY)
 * - Requires a curated mapping table for featured models (provider/model pairs per backend)
 * - See feature-plans/holistic-fius-auth-analysis/13-model-id-namespaces-and-mapping.md
 * - See feature-plans/holistic-fius-auth-analysis/14-webui-effective-credentials-and-routing-awareness.md
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
    useLLMCatalog,
    useSwitchLLM,
    useCustomModels,
    useCreateCustomModel,
    useDeleteCustomModel,
    useModelPickerState,
    useToggleFavoriteModel,
    useSetFavoriteModels,
    useProviderApiKey,
    useSaveApiKey,
    type SwitchLLMPayload,
    type CustomModel,
} from '../hooks/useLLM';
import { useLocalModels, useDeleteInstalledModel, type LocalModel } from '../hooks/useModels';
import { useFiusAuth } from '../hooks/useFiusAuth';
import {
    CustomModelForm,
    type CustomModelFormData,
    type CustomModelProvider,
} from './CustomModelForms';
import { ModelsDevBrowser } from './ModelsDevBrowser';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { ApiKeyModal } from '../ApiKeyModal';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { useCurrentLLM } from '../hooks/useCurrentLLM';
    import { Bot, ChevronDown, Loader2, Plus, Filter, ArrowLeft } from 'lucide-react';
import { SearchBar } from './SearchBar';
import { ModelCard } from './ModelCard';
import {
    CUSTOM_MODELS_STORAGE_KEY,
    FAVORITES_STORAGE_KEY,
    ProviderCatalog,
    ModelInfo,
    favKey,
    getModelDisplayName,
    parseFavoriteKey,
    validateBaseURL,
} from './types';
import { cn } from '../../lib/utils';
import { LLM_PROVIDERS, type LLMProvider } from '@fiusdev/llm';
import { PROVIDER_LOGOS, needsDarkModeInversion, hasLogo } from './constants';
import { useAnalytics } from '@/lib/analytics/index.js';

const GENERIC_UPLOAD_FILE_TYPES: ModelInfo['supportedFileTypes'] = [
    'pdf',
    'image',
    'audio',
    'video',
    'document',
];

const CUSTOM_PROVIDER_SUPPORTED_FILE_TYPES: Partial<
    Record<LLMProvider, ModelInfo['supportedFileTypes']>
> = {
    openrouter: GENERIC_UPLOAD_FILE_TYPES,
    litellm: GENERIC_UPLOAD_FILE_TYPES,
    glama: GENERIC_UPLOAD_FILE_TYPES,
    'fius': GENERIC_UPLOAD_FILE_TYPES,
    bedrock: [],
    ollama: ['image'],
    local: [],
};

function resolveSupportedFileTypes(
    provider: LLMProvider,
    providers: Partial<Record<LLMProvider, ProviderCatalog>>
): ModelInfo['supportedFileTypes'] {
    return (
        providers[provider]?.supportedFileTypes ??
        CUSTOM_PROVIDER_SUPPORTED_FILE_TYPES[provider] ??
        []
    );
}

export default function ModelPickerModal() {
    const [open, setOpen] = useState(false);
    const [providers, setProviders] = useState<Partial<Record<LLMProvider, ProviderCatalog>>>({});
    const [search, setSearch] = useState('');
    const [baseURL, setBaseURL] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'for-you' | 'all-models'>('for-you');
    const [providerFilter, setProviderFilter] = useState<Array<LLMProvider | 'custom'>>([]);
    const [showCustomForm, setShowCustomForm] = useState(false);
    const [isEditingModel, setIsEditingModel] = useState(false);
    const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

    const [customModelForm, setCustomModelForm] = useState<CustomModelFormData>({
        provider: 'fius',
        displayProvider: '',
        name: '',
        baseURL: '',
        displayName: '',
        maxInputTokens: '',
        maxOutputTokens: '',
        apiKey: '',
        filePath: '',
    });
    const [editingModelName, setEditingModelName] = useState<string | null>(null);
    const [editingModelProvider, setEditingModelProvider] = useState<string | null>(null);

    const [keyModalOpen, setKeyModalOpen] = useState(false);
    const [pendingKeyProvider, setPendingKeyProvider] = useState<LLMProvider | null>(null);
    const [pendingSelection, setPendingSelection] = useState<{
        provider: LLMProvider;
        model: ModelInfo;
        baseURL?: string;
    } | null>(null);

    const currentSessionId = useSessionStore((s) => s.currentSessionId);
    const { data: currentLLM, refetch: refreshCurrentLLM } = useCurrentLLM(currentSessionId);

    const analytics = useAnalytics();
    const analyticsRef = useRef(analytics);

    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    const {
        data: catalogData,
        isLoading: loading,
        error: catalogError,
    } = useLLMCatalog({
        enabled: open,
        scope: activeTab === 'all-models' ? 'all' : 'curated',
    });

                const { data: fiusAuthStatus } = useFiusAuth(open);

    const { data: customModels = [] } = useCustomModels();
    const { data: localModelsData } = useLocalModels({ enabled: open });
    const installedLocalModels = useMemo(
        () => localModelsData?.models ?? [],
        [localModelsData?.models]
    );
    const { mutateAsync: createCustomModelAsync } = useCreateCustomModel();
    const { mutate: deleteCustomModelMutation } = useDeleteCustomModel();
    const { mutate: deleteInstalledModelMutation } = useDeleteInstalledModel();
    const { mutateAsync: saveApiKey } = useSaveApiKey();
    const { mutateAsync: toggleFavoriteModelAsync } = useToggleFavoriteModel();
    const { mutateAsync: setFavoriteModelsAsync } = useSetFavoriteModels();

    const {
        data: modelPickerState,
        isLoading: modelPickerStateLoading,
        error: modelPickerStateError,
        refetch: refetchModelPickerState,
    } = useModelPickerState({ enabled: open });

    const { data: providerKeyData } = useProviderApiKey(customModelForm.provider as LLMProvider, {
        enabled: open && showCustomForm,
    });
    useEffect(() => {
        if (catalogData && 'providers' in catalogData) {
            setProviders(catalogData.providers);
        }
    }, [catalogData]);

    useEffect(() => {
        if (!open) return;
        if (currentLLM) {
            setBaseURL(currentLLM.baseURL || '');
        }
    }, [open, currentLLM]);

    const [favoritesMigrationDone, setFavoritesMigrationDone] = useState(false);

    useEffect(() => {
        if (!open || favoritesMigrationDone || !modelPickerState) return;

        const migrateFavorites = async () => {
            try {
                const favRaw = localStorage.getItem(FAVORITES_STORAGE_KEY);
                if (!favRaw) {
                    setFavoritesMigrationDone(true);
                    return;
                }

                if (modelPickerState.favorites.length > 0) {
                    localStorage.removeItem(FAVORITES_STORAGE_KEY);
                    setFavoritesMigrationDone(true);
                    return;
                }

                const parsed = JSON.parse(favRaw) as unknown;
                const favorites = Array.isArray(parsed)
                    ? parsed
                          .map((value) => {
                              const parsedFavorite =
                                  typeof value === 'string' ? parseFavoriteKey(value) : null;
                              if (
                                  !parsedFavorite ||
                                  !LLM_PROVIDERS.includes(parsedFavorite.provider as LLMProvider)
                              ) {
                                  return null;
                              }

                              return {
                                  provider: parsedFavorite.provider as LLMProvider,
                                  model: parsedFavorite.model,
                                  ...(parsedFavorite.baseURL
                                      ? { baseURL: parsedFavorite.baseURL }
                                      : {}),
                              };
                          })
                          .filter(
                              (
                                  value
                              ): value is {
                                  provider: LLMProvider;
                                  model: string;
                                  baseURL?: string;
                              } => Boolean(value)
                          )
                    : [];

                if (favorites.length === 0) {
                    localStorage.removeItem(FAVORITES_STORAGE_KEY);
                    setFavoritesMigrationDone(true);
                    return;
                }

                await setFavoriteModelsAsync({ favorites });
                localStorage.removeItem(FAVORITES_STORAGE_KEY);
                setFavoritesMigrationDone(true);
            } catch (migrationError) {
                console.warn('Failed to migrate favorites from localStorage:', migrationError);
            }
        };

        void migrateFavorites();
    }, [open, favoritesMigrationDone, modelPickerState, setFavoriteModelsAsync]);

    const [migrationDone, setMigrationDone] = useState(false);
    useEffect(() => {
        if (!open || migrationDone) return;

        const migrateModels = async () => {
            try {
                const localStorageRaw = localStorage.getItem(CUSTOM_MODELS_STORAGE_KEY);
                if (!localStorageRaw) {
                    setMigrationDone(true);
                    return;
                }

                const localModels = JSON.parse(localStorageRaw) as Array<{
                    name: string;
                    baseURL: string;
                    maxInputTokens?: number;
                    maxOutputTokens?: number;
                }>;

                if (localModels.length === 0) {
                    localStorage.removeItem(CUSTOM_MODELS_STORAGE_KEY);
                    setMigrationDone(true);
                    return;
                }

                const existingNames = new Set(customModels.map((m: CustomModel) => m.name));
                const toMigrate = localModels.filter((m) => !existingNames.has(m.name));

                if (toMigrate.length === 0) {
                    localStorage.removeItem(CUSTOM_MODELS_STORAGE_KEY);
                    setMigrationDone(true);
                    return;
                }

                const migrationPromises = toMigrate.map((model) =>
                    createCustomModelAsync({
                        name: model.name,
                        baseURL: model.baseURL,
                        maxInputTokens: model.maxInputTokens,
                        maxOutputTokens: model.maxOutputTokens,
                    })
                );

                await Promise.all(migrationPromises);

                localStorage.removeItem(CUSTOM_MODELS_STORAGE_KEY);
                console.info(`Migrated ${toMigrate.length} custom models from localStorage to API`);
                setMigrationDone(true);
            } catch (err) {
                console.warn('Failed to migrate custom models from localStorage:', err);
                setMigrationDone(true);
            }
        };

        migrateModels();
    }, [open, migrationDone, customModels, createCustomModelAsync]);

    const favoriteKeySet = useMemo(() => {
        return new Set(
            (modelPickerState?.favorites ?? []).map((entry) =>
                favKey(entry.provider, entry.model, entry.baseURL)
            )
        );
    }, [modelPickerState?.favorites]);

    const isFavorite = useCallback(
        (providerId: LLMProvider, modelName: string, modelBaseURL?: string) => {
            const key = favKey(providerId, modelName, modelBaseURL);
            return favoriteKeySet.has(key);
        },
        [favoriteKeySet]
    );

    const toggleFavorite = useCallback(
        async (providerId: LLMProvider, modelName: string, modelBaseURL?: string) => {
            try {
                await toggleFavoriteModelAsync({
                    provider: providerId,
                    model: modelName,
                    ...(modelBaseURL ? { baseURL: modelBaseURL } : {}),
                });
                await new Promise((r) => setTimeout(r, 200));
                await refetchModelPickerState();
                setError(null);
            } catch (toggleError) {
                setError(
                    toggleError instanceof Error
                        ? toggleError.message
                        : 'Failed to update favorites'
                );
            }
        },
        [toggleFavoriteModelAsync, refetchModelPickerState]
    );

    const [isAddingModel, setIsAddingModel] = useState(false);
    const switchLLMMutation = useSwitchLLM();

    const addCustomModel = useCallback(async (override?: Partial<typeof customModelForm>) => {
        const form = { ...customModelForm, ...override };
        const { provider, displayProvider, name, baseURL, maxInputTokens, maxOutputTokens, displayName, apiKey, supportedFileTypes } =
            form;

        if (!name.trim()) {
            setError('Model name is required');
            return;
        }

        setIsAddingModel(true);

        try {
            const SHARED_API_KEY_PROVIDERS = ['glama', 'openrouter', 'litellm'];
            const userEnteredKey = apiKey?.trim();
            const providerHasKey = providerKeyData?.hasKey ?? false;
            const hasSharedEnvVarKey = SHARED_API_KEY_PROVIDERS.includes(provider);

            let saveToProviderEnvVar = false;
            let saveAsPerModel = false;

            if (userEnteredKey) {
                if (hasSharedEnvVarKey) {
                    if (!providerHasKey) {
                        saveToProviderEnvVar = true;
                    } else {
                        saveAsPerModel = true;
                    }
                } else {
                    saveAsPerModel = true;
                }
            }
            if (saveToProviderEnvVar && userEnteredKey) {
                await saveApiKey({ provider: provider as LLMProvider, apiKey: userEnteredKey });
            }

            const providerChanged = editingModelProvider && provider !== editingModelProvider;
            if (editingModelName && (editingModelName !== name.trim() || providerChanged)) {
                try {
                    await new Promise<void>((resolve, reject) => {
                        deleteCustomModelMutation(editingModelName, {
                            onSuccess: () => resolve(),
                            onError: (err: Error) => reject(err),
                        });
                    });
                } catch (err) {
                    console.warn(`Failed to delete old model "${editingModelName}":`, err);
                }
            }

            await createCustomModelAsync({
                provider,
                displayProvider: displayProvider || provider,
                name: name.trim(),
                ...(baseURL.trim() && { baseURL: baseURL.trim() }),
                ...(displayName?.trim() && { displayName: displayName.trim() }),
                ...(maxInputTokens && { maxInputTokens: parseInt(maxInputTokens, 10) }),
                ...(maxOutputTokens && { maxOutputTokens: parseInt(maxOutputTokens, 10) }),
                ...(saveAsPerModel && userEnteredKey && { apiKey: userEnteredKey }),
                ...(supportedFileTypes && supportedFileTypes.length > 0 && { supportedFileTypes }),
            });

            if (!editingModelName) {
                const baseSwitchPayload: SwitchLLMPayload = {
                    provider: provider as LLMProvider,
                    model: name.trim(),
                    ...(baseURL.trim() && { baseURL: baseURL.trim() }),
                    ...(saveAsPerModel && userEnteredKey && { apiKey: userEnteredKey }),
                };

                await switchLLMMutation.mutateAsync(baseSwitchPayload);

                if (currentSessionId) {
                    try {
                        await switchLLMMutation.mutateAsync({
                            ...baseSwitchPayload,
                            sessionId: currentSessionId,
                        });
                    } catch (sessionErr) {
                        setError(
                            sessionErr instanceof Error
                                ? `Model added and set as global default, but failed to switch current session: ${sessionErr.message}`
                                : 'Model added and set as global default, but failed to switch current session'
                        );
                        await refreshCurrentLLM();
                        setIsAddingModel(false);
                        return;
                    }
                }

                await refreshCurrentLLM();

                if (currentLLM) {
                    analyticsRef.current.trackLLMSwitched({
                        fromProvider: currentLLM.provider,
                        fromModel: currentLLM.model,
                        toProvider: provider,
                        toModel: name.trim(),
                        sessionId: currentSessionId || undefined,
                        trigger: 'user_action',
                    });
                }
            }

            setCustomModelForm({
                provider: 'fius',
                displayProvider: '',
                name: '',
                baseURL: '',
                displayName: '',
                maxInputTokens: '',
                maxOutputTokens: '',
                apiKey: '',
                filePath: '',
                supportedFileTypes: undefined,
            });
            setEditingModelName(null);
            setShowCustomForm(false);
            setError(null);
            setOpen(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add model');
        } finally {
            setIsAddingModel(false);
        }
    }, [
        customModelForm,
        createCustomModelAsync,
        switchLLMMutation,
        currentSessionId,
        currentLLM,
        refreshCurrentLLM,
        providerKeyData,
        saveApiKey,
        editingModelName,
        deleteCustomModelMutation,
    ]);

    const deleteCustomModel = useCallback(
        (name: string) => {
            deleteCustomModelMutation(name, {
                onError: (err: Error) => {
                    setError(err.message);
                },
            });
        },
        [deleteCustomModelMutation]
    );

    const deleteInstalledModel = useCallback(
        (modelId: string) => {
            deleteInstalledModelMutation(
                { modelId, deleteFile: true },
                {
                    onError: (err: Error) => {
                        setError(err.message);
                    },
                }
            );
        },
        [deleteInstalledModelMutation]
    );

    const editCustomModel = useCallback((model: CustomModel) => {
        setCustomModelForm({
            provider: (model.provider || 'fius') as CustomModelProvider,
            displayProvider: model.displayProvider || model.provider || '',
            name: model.name,
            baseURL: model.baseURL ?? '',
            displayName: model.displayName ?? '',
            maxInputTokens: model.maxInputTokens?.toString() ?? '',
            maxOutputTokens: model.maxOutputTokens?.toString() ?? '',
            apiKey: model.apiKey ?? '',
            filePath: model.filePath ?? '',
            supportedFileTypes: model.supportedFileTypes,
        });
        setEditingModelName(model.name);
        setEditingModelProvider(model.provider || 'fius');
        setIsEditingModel(true);
        setShowCustomForm(true);
        setError(null);
    }, []);

    const modelMatchesSearch = useCallback(
        (providerId: LLMProvider, model: ModelInfo): boolean => {
            const q = search.trim().toLowerCase();
            if (!q) return true;
            const providerName = (providers[providerId]?.name ?? '').toLowerCase();
            return (
                model.name.toLowerCase().includes(q) ||
                (model.displayName?.toLowerCase().includes(q) ?? false) ||
                providerId.toLowerCase().includes(q) ||
                providerName.includes(q)
            );
        },
        [search, providers]
    );

    const onPickModel = useCallback(
        (
            providerId: LLMProvider,
            model: ModelInfo,
            customBaseURL?: string,
            skipApiKeyCheck = false,
            customApiKey?: string
        ) => {
            const provider = providers[providerId];
            const effectiveBaseURL = customBaseURL || baseURL;
            const supportsBaseURL = provider?.supportsBaseURL ?? Boolean(effectiveBaseURL);

            if (supportsBaseURL && effectiveBaseURL) {
                const v = validateBaseURL(effectiveBaseURL);
                if (!v.isValid) {
                    setError(v.error || 'Invalid base URL');
                    return;
                }
            }

                if (!skipApiKeyCheck && providerId === 'fius') {
                if (!fiusAuthStatus?.canUse) {
                    setError(
                        fiusAuthStatus?.authenticated
                            ? 'Your Fius login was found, but no usable Fius API key is available. Run `fius login` again to refresh your Fius access.'
                            : 'Run `fius login` or `/login` from the CLI to authenticate with Fius'
                    );
                    return;
                }
            } else if (!skipApiKeyCheck && provider && !provider.hasApiKey && !customApiKey) {
                setPendingSelection({
                    provider: providerId,
                    model,
                    ...(customBaseURL ? { baseURL: customBaseURL } : {}),
                });
                setPendingKeyProvider(providerId);
                setKeyModalOpen(true);
                return;
            }

                const basePayload: SwitchLLMPayload = {
                    provider: providerId,
                    model: model.name,
                    ...(customBaseURL && { baseURL: customBaseURL }),
                ...(customApiKey && { apiKey: customApiKey }),
            };

            switchLLMMutation.mutate(basePayload, {
                onSuccess: async () => {
                    if (currentSessionId) {
                        try {
                            await switchLLMMutation.mutateAsync({
                                ...basePayload,
                                sessionId: currentSessionId,
                            });
                        } catch (err) {
                            setError(
                                err instanceof Error
                                    ? err.message
                                    : 'Failed to switch model for current session'
                            );
                            return;
                        }
                    }

                    await refreshCurrentLLM();

                    if (currentLLM) {
                        analyticsRef.current.trackLLMSwitched({
                            fromProvider: currentLLM.provider,
                            fromModel: currentLLM.model,
                            toProvider: providerId,
                            toModel: model.name,
                            sessionId: currentSessionId || undefined,
                            trigger: 'user_action',
                        });
                    }

                    setOpen(false);
                    setError(null);
                },
                onError: (error: Error) => {
                    setError(error.message);
                },
            });
        },
        [
            baseURL,
            currentLLM,
            currentSessionId,
            fiusAuthStatus,
            providers,
            refreshCurrentLLM,
            switchLLMMutation,
        ]
    );

    const onPickCustomModel = useCallback(
        (customModel: CustomModel) => {
            const provider = (customModel.provider ?? 'fius') as LLMProvider;
            const modelInfo: ModelInfo = {
                name: customModel.name,
                displayName: customModel.displayName || customModel.name,
                maxInputTokens: customModel.maxInputTokens || 128000,
                supportedFileTypes: customModel.supportedFileTypes && customModel.supportedFileTypes.length > 0
                    ? customModel.supportedFileTypes as ModelInfo['supportedFileTypes']
                    : resolveSupportedFileTypes(provider, providers),
            };
            onPickModel(provider, modelInfo, customModel.baseURL, true, customModel.apiKey);
        },
        [onPickModel, providers]
    );

    const onPickInstalledModel = useCallback(
        (model: LocalModel) => {
            const modelInfo: ModelInfo = {
                name: model.id,
                displayName: model.displayName,
                maxInputTokens: model.contextLength || 8192,
                supportedFileTypes: [],
            };
            onPickModel('local', modelInfo, undefined, true);
        },
        [onPickModel]
    );

    function onApiKeySaved(meta: { provider: string; envVar: string }) {
        const providerKey = meta.provider as LLMProvider;
        setProviders((prev) => ({
            ...prev,
            [providerKey]: prev[providerKey]
                ? { ...prev[providerKey]!, hasApiKey: true }
                : prev[providerKey],
        }));
        setKeyModalOpen(false);
        if (pendingSelection) {
            const { provider: providerId, model, baseURL: pendingBaseURL } = pendingSelection;
            onPickModel(providerId, model, pendingBaseURL, true);
            setPendingSelection(null);
        }
    }

    const triggerLabel = currentLLM?.displayName || currentLLM?.model || 'Choose Model';
    const isWelcomeScreen = !currentSessionId;

    const toggleFilter = useCallback((filter: LLMProvider | 'custom') => {
        setProviderFilter((prev) =>
            prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
        );
    }, []);

    type ModelPickerSectionEntry = {
        provider: LLMProvider;
        model: string;
        baseURL?: string;
        displayName?: string;
        supportedFileTypes: ModelInfo['supportedFileTypes'];
        source: 'catalog' | 'custom' | 'local-installed';
    };

    const customModelsByKey = useMemo(() => {
        const byKey = new Map<string, CustomModel>();
        for (const customModel of customModels) {
            const keyProvider = customModel.displayProvider || customModel.provider || 'fius';
            byKey.set(favKey(keyProvider, customModel.name, customModel.baseURL), customModel);
        }
        return byKey;
    }, [customModels]);

    const customProviderNames = useMemo(() => {
        const names = new Set<string>();
        for (const cm of customModels) {
            const dp = cm.displayProvider || cm.provider;
            if (dp && dp !== 'fius') {
                names.add(dp);
            }
        }
        return Array.from(names);
    }, [customModels]);

    const providerBaseURLs = useMemo(() => {
        const map = new Map<string, string>();
        for (const cm of customModels) {
            if (cm.baseURL) {
                const dp = cm.displayProvider || cm.provider;
                if (dp && !map.has(dp)) {
                    map.set(dp, cm.baseURL);
                }
            }
        }
        return map;
    }, [customModels]);

    const installedLocalModelsById = useMemo(() => {
        const byId = new Map<string, LocalModel>();
        for (const model of installedLocalModels) {
            byId.set(model.id, model);
        }
        return byId;
    }, [installedLocalModels]);

    const providerModelsByKey = useMemo(() => {
        const byKey = new Map<string, ModelInfo>();
        for (const providerId of LLM_PROVIDERS) {
            const provider = providers[providerId];
            if (!provider) continue;
            for (const model of provider.models) {
                byKey.set(favKey(providerId, model.name), model);
            }
        }
        return byKey;
    }, [providers]);

    const resolveModelInfoFromEntry = useCallback(
        (entry: ModelPickerSectionEntry): ModelInfo => {
            const key = favKey(entry.provider, entry.model, entry.baseURL);
            const providerModel =
                providerModelsByKey.get(key) ??
                providerModelsByKey.get(favKey(entry.provider, entry.model));
            if (providerModel) {
                return providerModel;
            }

            const customModel = customModelsByKey.get(key);
            if (customModel) {
                return {
                    name: customModel.name,
                    displayName: customModel.displayName || customModel.name,
                    maxInputTokens: customModel.maxInputTokens || 128000,
                    supportedFileTypes: customModel.supportedFileTypes && customModel.supportedFileTypes.length > 0
                        ? customModel.supportedFileTypes as ModelInfo['supportedFileTypes']
                        : resolveSupportedFileTypes(entry.provider, providers),
                };
            }

            const installedModel =
                entry.provider === 'local' ? installedLocalModelsById.get(entry.model) : undefined;

            return {
                name: entry.model,
                displayName: entry.displayName || entry.model,
                maxInputTokens: installedModel?.contextLength || 8192,
                supportedFileTypes: entry.supportedFileTypes ?? [],
            };
        },
        [customModelsByKey, installedLocalModelsById, providerModelsByKey, providers]
    );

    const onPickSectionEntry = useCallback(
        (entry: ModelPickerSectionEntry) => {
            const key = favKey(entry.provider, entry.model, entry.baseURL);
            const customModel = customModelsByKey.get(key);
            if (customModel) {
                onPickCustomModel(customModel);
                return;
            }

            if (entry.provider === 'local') {
                const localModel = installedLocalModelsById.get(entry.model);
                if (localModel) {
                    onPickInstalledModel(localModel);
                    return;
                }

                setError(`Local model "${entry.model}" is no longer installed.`);
                void refetchModelPickerState();
                return;
            }

            onPickModel(entry.provider, resolveModelInfoFromEntry(entry), entry.baseURL);
        },
        [
            customModelsByKey,
            installedLocalModelsById,
            resolveModelInfoFromEntry,
            onPickModel,
            onPickCustomModel,
            onPickInstalledModel,
            refetchModelPickerState,
        ]
    );

    const modelPickerEntryMatchesSearch = useCallback(
        (entry: ModelPickerSectionEntry): boolean => {
            const q = search.trim().toLowerCase();
            if (!q) return true;

            const providerName = (providers[entry.provider]?.name ?? '').toLowerCase();
            return (
                entry.model.toLowerCase().includes(q) ||
                (entry.displayName?.toLowerCase().includes(q) ?? false) ||
                entry.provider.toLowerCase().includes(q) ||
                providerName.includes(q)
            );
        },
        [providers, search]
    );

    const forYouSections = useMemo(() => {
        if (!providers) {
            return [];
        }

        const providerSections: Array<{
            id: string;
            title: string;
            providers: Array<{
                id: string;
                name: string;
                modelCount: number;
                models: typeof providers[string]['models'];
            }>;
        }> = [];

        const fiusProvider = providers['fius'];
        if (fiusProvider && fiusProvider.models.length > 0) {
            const filteredModels = search
                ? fiusProvider.models.filter((m) =>
                      (m.displayName || m.name).toLowerCase().includes(search.toLowerCase())
                  )
                : fiusProvider.models;
            if (filteredModels.length > 0) {
                providerSections.push({
                    id: 'fius',
                    title: 'Fius',
                    providers: [{
                        id: 'fius',
                        name: 'Fius',
                        modelCount: filteredModels.length,
                        models: filteredModels,
                    }],
                });
            }
        }

        const customByProvider = new Map<string, typeof customModels>();
        for (const cm of customModels) {
            const displayProvider = cm.displayProvider || cm.provider || 'custom';
            if (!customByProvider.has(displayProvider)) customByProvider.set(displayProvider, []);
            customByProvider.get(displayProvider)!.push(cm);
        }

        const customProviders: Array<{
            id: string;
            name: string;
            modelCount: number;
            models: typeof customModels;
        }> = [];

        for (const [displayProvider, models] of customByProvider) {
            const filteredModels = search
                ? models.filter((m) =>
                      (m.displayName || m.name).toLowerCase().includes(search.toLowerCase())
                  )
                : models;
            if (filteredModels.length > 0) {
                customProviders.push({
                    id: displayProvider,
                    name: displayProvider,
                    modelCount: filteredModels.length,
                    models: filteredModels,
                });
            }
        }

        if (customProviders.length > 0) {
            providerSections.push({
                id: 'custom',
                title: 'Custom Providers',
                providers: customProviders,
            });
        }

        return providerSections;
    }, [providers, customModels, search]);

    const allModels = useMemo(() => {
        const providerFilters = providerFilter.filter((f): f is LLMProvider => f !== 'custom');
        if (providerFilter.length > 0 && providerFilters.length === 0) return [];

        const result: Array<{
            providerId: LLMProvider;
            provider: ProviderCatalog;
            model: ModelInfo;
        }> = [];

        for (const providerId of LLM_PROVIDERS) {
            if (providerFilter.length > 0 && !providerFilters.includes(providerId)) continue;

            const provider = providers[providerId];
            if (!provider) continue;

            for (const model of provider.models) {
                if (modelMatchesSearch(providerId, model)) {
                    result.push({ providerId, provider, model });
                }
            }
        }

        return result;
    }, [providers, providerFilter, modelMatchesSearch]);

    const filteredCustomModels = useMemo(() => {
        const hasCustomFilter = providerFilter.includes('custom');
        const hasOpenRouterFilter = providerFilter.includes('openrouter');
        const noFilter = providerFilter.length === 0;

        if (!noFilter && !hasCustomFilter && !hasOpenRouterFilter) return [];

        let filtered = customModels;

        if (hasOpenRouterFilter && !hasCustomFilter && !noFilter) {
            filtered = customModels.filter((cm: CustomModel) => cm.provider === 'openrouter');
        }

        const q = search.trim().toLowerCase();
        if (!q) return filtered;
        return filtered.filter(
            (cm: CustomModel) =>
                cm.name.toLowerCase().includes(q) ||
                (cm.displayName?.toLowerCase().includes(q) ?? false) ||
                (cm.provider?.toLowerCase().includes(q) ?? false) ||
                (cm.baseURL?.toLowerCase().includes(q) ?? false)
        );
    }, [providerFilter, search, customModels]);

    const filteredInstalledModels = useMemo<LocalModel[]>(() => {
        const hasLocalFilter = providerFilter.includes('local');
        const noFilter = providerFilter.length === 0;

        if (!noFilter && !hasLocalFilter) return [];

        const q = search.trim().toLowerCase();
        if (!q) return installedLocalModels;
        return installedLocalModels.filter(
            (model: LocalModel) =>
                model.id.toLowerCase().includes(q) ||
                getModelDisplayName(model, model.id).toLowerCase().includes(q) ||
                'local'.includes(q)
        );
    }, [providerFilter, search, installedLocalModels]);

    const availableProviders = useMemo(() => {
        const base = LLM_PROVIDERS.filter((p) => p === 'openrouter' || providers[p]?.models.length);
        if (installedLocalModels.length > 0 && !base.includes('local')) {
            return [...base, 'local' as LLMProvider];
        }
        return base;
    }, [providers, installedLocalModels]);

    const isCurrentModel = (providerId: string, modelName: string, modelBaseURL?: string) =>
        currentLLM?.provider === providerId &&
        currentLLM?.model === modelName &&
        (modelBaseURL === undefined || (currentLLM.baseURL ?? '') === modelBaseURL);

    return (
        <>
            <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setShowCustomForm(false); setIsEditingModel(false); setSelectedProviderId(null); setEditingModelName(null); setEditingModelProvider(null); } }}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="flex items-center gap-2 cursor-pointer"
                        title="Choose model"
                    >
                        {currentLLM?.provider && hasLogo(currentLLM.provider as LLMProvider) ? (
                            <img
                                src={PROVIDER_LOGOS[currentLLM.provider as LLMProvider]}
                                alt={`${currentLLM.provider} logo`}
                                width={16}
                                height={16}
                                className={cn(
                                    'object-contain',
                                    needsDarkModeInversion(currentLLM.provider as LLMProvider) &&
                                        'dark:invert dark:brightness-0 dark:contrast-200'
                                )}
                            />
                        ) : (
                            <Bot className="h-4 w-4" />
                        )}
                        <span className="text-sm">{triggerLabel}</span>
                        {currentLLM?.viaFius && (
                            <span className="text-xs text-muted-foreground">via Fius</span>
                        )}
                        <ChevronDown
                            className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
                        />
                    </Button>
                </PopoverTrigger>

                <PopoverContent
                    side="top"
                    align="end"
                    sideOffset={8}
                    avoidCollisions={true}
                    collisionPadding={16}
                    className={cn(
                        'w-[calc(100vw-32px)] max-w-[700px]',
                        isWelcomeScreen ? 'max-h-[min(400px,50vh)]' : 'max-h-[min(580px,75vh)]',
                        'flex flex-col p-0 overflow-hidden',
                        'rounded-xl border border-border/60 bg-popover/98 backdrop-blur-xl shadow-xl'
                    )}
                >
                    {/* Full-screen Add Custom Model Form - replaces all content when active */}
                    {showCustomForm ? (
                        isEditingModel ? (
                            <CustomModelForm
                                formData={customModelForm}
                                onChange={(updates) => setCustomModelForm((prev) => ({ ...prev, ...updates }))}
                                onSubmit={() => { void addCustomModel(); }}
                                onCancel={() => {
                                    setShowCustomForm(false);
                                    setIsEditingModel(false);
                                    setEditingModelName(null);
                                    setError(null);
                                }}
                                isSubmitting={isAddingModel}
                                error={error}
                                isEditing={!!editingModelName}
                                customProviders={customProviderNames}
                            />
                        ) : (
                            <ModelsDevBrowser
                                onAddModel={(model) => {
                                    const formOverride = {
                                        provider: model.provider as CustomModelProvider,
                                        displayProvider: model.displayProvider || model.provider,
                                        name: model.name,
                                        baseURL: model.baseURL || '',
                                        displayName: model.displayName || '',
                                        maxInputTokens: '',
                                        maxOutputTokens: '',
                                        apiKey: model.apiKey || '',
                                        filePath: '',
                                        supportedFileTypes: model.supportedFileTypes,
                                    };
                                    setCustomModelForm(formOverride);
                                    void addCustomModel(formOverride);
                                    setShowCustomForm(false);
                                }}
                                onCancel={() => {
                                    setShowCustomForm(false);
                                    setIsEditingModel(false);
                                    setEditingModelName(null);
                                    setError(null);
                                }}
                            />
                        )
                    ) : (
                        <>
                            {/* Header */}
                            <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-border/30 space-y-2">
                                {(error || catalogError || modelPickerStateError) && (
                                    <Alert variant="destructive" className="py-2">
                                        <AlertDescription className="text-xs">
                                            {error ||
                                                catalogError?.message ||
                                                modelPickerStateError?.message}
                                        </AlertDescription>
                                    </Alert>
                                )}
                                <div className="flex items-center gap-2">
                                    <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-1">
                                        <button
                                            onClick={() => { setActiveTab('for-you'); setSelectedProviderId(null); }}
                                            className={cn(
                                                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                                                activeTab === 'for-you'
                                                    ? 'bg-background text-foreground shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            )}
                                        >
                                            All Providers
                                        </button>
                                        <button
                                            onClick={() => { setActiveTab('all-models'); setProviderFilter([]); }}
                                            className={cn(
                                                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                                                activeTab === 'all-models'
                                                    ? 'bg-background text-foreground shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            )}
                                        >
                                            All Models
                                        </button>
                                    </div>
                                    <div className="flex-1">
                                        <SearchBar
                                            value={search}
                                            onChange={setSearch}
                                            placeholder={
                                                activeTab === 'all-models'
                                                    ? 'Search all models...'
                                                    : 'Search providers...'
                                            }
                                        />
                                    </div>
                                </div>

                                {activeTab === 'all-models' && availableProviders.length > 1 && (
                                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                        <Filter className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                        <button
                                            onClick={() => setProviderFilter([])}
                                            className={cn(
                                                'px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                                                providerFilter.length === 0
                                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                    : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                                            )}
                                        >
                                            All
                                        </button>
                                        {availableProviders.map((providerId) => (
                                            <button
                                                key={providerId}
                                                onClick={() => toggleFilter(providerId)}
                                                className={cn(
                                                    'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                                                    providerFilter.includes(providerId)
                                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                        : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                                                )}
                                            >
                                                {PROVIDER_LOGOS[providerId] && (
                                                    <img
                                                        src={PROVIDER_LOGOS[providerId]}
                                                        alt=""
                                                        width={10}
                                                        height={10}
                                                        className={cn(
                                                            'object-contain',
                                                            needsDarkModeInversion(providerId) &&
                                                                !providerFilter.includes(
                                                                    providerId
                                                                ) &&
                                                                'dark:invert dark:brightness-0 dark:contrast-200'
                                                        )}
                                                    />
                                                )}
                                                <span className="hidden sm:inline">
                                                    {providers[providerId]?.name || providerId}
                                                </span>
                                            </button>
                                        ))}
                                        <button
                                            onClick={() => toggleFilter('custom')}
                                            className={cn(
                                                'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                                                providerFilter.includes('custom')
                                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                    : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                                            )}
                                        >
                                            <Bot className="h-2.5 w-2.5" />
                                            <span className="hidden sm:inline">Custom</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Main Content */}
                            <div className="flex-1 min-h-0 overflow-y-auto p-3">
                                {loading || (activeTab === 'for-you' && modelPickerStateLoading) ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                    </div>
                                ) : activeTab === 'for-you' ? (
                                    (() => {
                if (selectedProviderId) {
                                            const allProviders = forYouSections.flatMap((s) => s.providers);
                                            const selected = allProviders.find((p) => p.id === selectedProviderId);
                                            if (!selected) {
                                                setSelectedProviderId(null);
                                                return null;
                                            }
                                            return (
                                                <div className="space-y-2">
                                                    <button
                                                        onClick={() => setSelectedProviderId(null)}
                                                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
                                                    >
                                                        <ArrowLeft className="h-3.5 w-3.5" />
                                                        Back to providers
                                                    </button>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="text-sm font-medium text-foreground">{selected.name}</div>
                                                        {selectedProviderId !== 'fius' && (
                                                            <button
                                                                onClick={() => {
                                                                    const existingBaseURL = providerBaseURLs.get(selectedProviderId) || '';
                                                                    setCustomModelForm({
                                                                        provider: selectedProviderId as CustomModelProvider,
                                                                        name: '',
                                                                        baseURL: existingBaseURL,
                                                                        displayName: '',
                                                                        maxInputTokens: '',
                                                                        maxOutputTokens: '',
                                                                        apiKey: '',
                                                                        filePath: '',
                                                                    });
                                                                    setEditingModelName(null);
                                                                    setIsEditingModel(true);
                                                                    setShowCustomForm(true);
                                                                    setSelectedProviderId(null);
                                                                }}
                                                                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                                                            >
                                                                <Plus className="h-3.5 w-3.5" />
                                                                Add model
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        {selected.models.map((model) => (
                                                            <button
                                                                key={model.name}
                                                                onClick={() => {
                                                                    if (selectedProviderId === 'fius') {
                                                                        const modelInfo: ModelInfo = {
                                                                            name: model.name,
                                                                            displayName: (model as ModelInfo).displayName || model.name,
                                                                            maxInputTokens: (model as ModelInfo).maxInputTokens || 128000,
                                                                            supportedFileTypes: [],
                                                                        };
                                                                        onPickModel('fius', modelInfo);
                                                                    } else {
                                                                        const cm = customModels.find(
                                                                            (m) => m.name === model.name &&
                                                                                (m.displayProvider || m.provider) === selectedProviderId
                                                                        );
                                                                        if (cm) {
                                                                            onPickCustomModel(cm);
                                                                        }
                                                                    }
                                                                    setOpen(false);
                                                                    setSelectedProviderId(null);
                                                                }}
                                                                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-muted/50 transition-colors group"
                                                            >
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-sm font-medium text-foreground truncate">
                                                                        {model.displayName || model.name}
                                                                    </div>
                                                                </div>
                                                                <div className="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
                                                                    →
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }

                                        if (forYouSections.length === 0) {
                                            return (
                                                <div className="flex flex-col items-center justify-center py-8 text-center">
                                                    <p className="text-sm font-medium text-muted-foreground">No providers found</p>
                                                    <p className="text-xs text-muted-foreground/70 mt-1">Try adjusting your search</p>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div className="flex flex-wrap gap-3">
                                                {forYouSections.flatMap((section) =>
                                                    section.providers.map((provider) => (
                                                        <button
                                                            key={provider.id}
                                                            onClick={() => setSelectedProviderId(provider.id)}
                                                            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border/50 bg-card hover:bg-muted/50 hover:border-border transition-all text-center group w-[140px] flex-shrink-0"
                                                        >
                                                        {provider.id === 'fius' ? (
                                                            <div className="w-10 h-10 rounded-xl overflow-hidden shadow-md">
                                                                <img src="/favicon.png" alt="Fius" className="w-full h-full object-cover" />
                                                            </div>
                                                        ) : (
                                                                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-muted-foreground font-bold text-lg">
                                                                    {provider.name.charAt(0).toUpperCase()}
                                                                </div>
                                                            )}
                                                        <div className="space-y-0.5 min-w-0">
                                                            <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                                                                {provider.id === 'fius' && fiusAuthStatus?.plan
                                                                    ? `Fius ${fiusAuthStatus.plan.charAt(0).toUpperCase() + fiusAuthStatus.plan.slice(1)}`
                                                                    : provider.name}
                                                            </div>
                                                            <div className="text-[11px] text-muted-foreground">
                                                                {provider.modelCount} {provider.modelCount === 1 ? 'model' : 'models'}
                                                            </div>
                                                        </div>
                                                        </button>
                                                    ))
                                                )}
                                                <button
                                                    onClick={() => { setIsEditingModel(false); setShowCustomForm(true); }}
                                                    className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-border/50 bg-card/50 hover:bg-muted/50 hover:border-border transition-all text-center group w-[140px] flex-shrink-0"
                                                >
                                                    <div className="w-10 h-10 rounded-xl border-2 border-dashed border-muted-foreground/30 group-hover:border-muted-foreground/50 flex items-center justify-center text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
                                                        <Plus className="h-5 w-5" />
                                                    </div>
                                                    <div className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                                                        Add provider
                                                    </div>
                                                </button>
                                            </div>
                                        );
                                    })()
                                ) : (
                                    <div>
                                        {allModels.length === 0 &&
                                        filteredCustomModels.length === 0 &&
                                        filteredInstalledModels.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-8 text-center">
                                                <p className="text-sm font-medium text-muted-foreground">
                                                    {providerFilter.includes('openrouter')
                                                        ? 'No OpenRouter models yet'
                                                        : providerFilter.includes('local')
                                                          ? 'No local models installed'
                                                          : 'No models found'}
                                                </p>
                                                <p className="text-xs text-muted-foreground/70 mt-1">
                                                    {providerFilter.includes('openrouter')
                                                        ? 'Click the + button to add an OpenRouter model'
                                                        : providerFilter.includes('local')
                                                          ? 'Use the CLI to download models: fius setup'
                                                          : 'Try adjusting your search or filters'}
                                                </p>
                                            </div>
                                        ) : (
                                            <div
                                                className="grid gap-2 justify-center"
                                                style={{
                                                    gridTemplateColumns: 'repeat(auto-fill, 140px)',
                                                }}
                                            >
                                                {allModels.map(
                                                    ({ providerId, provider, model }) => (
                                                        <ModelCard
                                                            key={`${providerId}|${model.name}`}
                                                            provider={providerId}
                                                            model={model}
                                                            providerInfo={provider}
                                                            isFavorite={isFavorite(
                                                                providerId,
                                                                model.name
                                                            )}
                                                            isActive={isCurrentModel(
                                                                providerId,
                                                                model.name
                                                            )}
                                                            onClick={() =>
                                                                onPickModel(providerId, model)
                                                            }
                                                            onToggleFavorite={() => {
                                                                void toggleFavorite(
                                                                    providerId,
                                                                    model.name
                                                                );
                                                            }}
                                                            size="sm"
                                                        />
                                                    )
                                                )}
                                                {/* Installed local models (downloaded via CLI) - shown before custom models */}
                                                {filteredInstalledModels.map(
                                                    (model: LocalModel) => (
                                                        <ModelCard
                                                            key={`local|${model.id}`}
                                                            provider="local"
                                                            model={{
                                                                name: model.id,
                                                                displayName: model.displayName,
                                                                maxInputTokens:
                                                                    model.contextLength || 8192,
                                                                supportedFileTypes: [],
                                                            }}
                                                            isFavorite={isFavorite(
                                                                'local',
                                                                model.id
                                                            )}
                                                            isActive={isCurrentModel(
                                                                'local',
                                                                model.id
                                                            )}
                                                            onClick={() =>
                                                                onPickInstalledModel(model)
                                                            }
                                                            onToggleFavorite={() => {
                                                                void toggleFavorite(
                                                                    'local',
                                                                    model.id
                                                                );
                                                            }}
                                                            onDelete={() =>
                                                                deleteInstalledModel(model.id)
                                                            }
                                                            size="sm"
                                                            isInstalled
                                                        />
                                                    )
                                                )}
                                                {/* Custom models (user-configured) */}
                                                {filteredCustomModels.map((cm: CustomModel) => {
                                                    const cmProvider = (cm.provider ??
                                                        'fius') as LLMProvider;
                                                    return (
                                                        <ModelCard
                                                            key={`custom|${cm.name}|${cm.baseURL ?? ''}`}
                                                            provider={cmProvider}
                                                            providerInfo={providers[cmProvider]}
                                                            model={{
                                                                name: cm.name,
                                                                displayName:
                                                                    cm.displayName || cm.name,
                                                                maxInputTokens:
                                                                    cm.maxInputTokens || 128000,
                                                                supportedFileTypes:
                                                                    cm.supportedFileTypes && cm.supportedFileTypes.length > 0
                                                                        ? cm.supportedFileTypes as ModelInfo['supportedFileTypes']
                                                                        : resolveSupportedFileTypes(
                                                                            cmProvider,
                                                                            providers
                                                                        ),
                                                            }}
                                                            isFavorite={isFavorite(
                                                                cmProvider,
                                                                cm.name,
                                                                cm.baseURL
                                                            )}
                                                            isActive={isCurrentModel(
                                                                cmProvider,
                                                                cm.name,
                                                                cm.baseURL
                                                            )}
                                                            onClick={() => onPickCustomModel(cm)}
                                                            onToggleFavorite={() => {
                                                                void toggleFavorite(
                                                                    cmProvider,
                                                                    cm.name,
                                                                    cm.baseURL
                                                                );
                                                            }}
                                                            onEdit={() => editCustomModel(cm)}
                                                            onDelete={() =>
                                                                deleteCustomModel(cm.name)
                                                            }
                                                            size="sm"
                                                            isCustom
                                                            displayProvider={cm.displayProvider}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </PopoverContent>
            </Popover>

            {pendingKeyProvider && (
                <ApiKeyModal
                    open={keyModalOpen}
                    onOpenChange={setKeyModalOpen}
                    provider={pendingKeyProvider}
                    primaryEnvVar={providers[pendingKeyProvider]?.primaryEnvVar || ''}
                    onSaved={onApiKeySaved}
                />
            )}
        </>
    );
}
