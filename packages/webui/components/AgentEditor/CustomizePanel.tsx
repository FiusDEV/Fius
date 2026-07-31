/**
 * CustomizePanel - Parent coordinator for agent configuration editing
 *
 * Responsibilities:
 * - Load/save configuration via API
 * - Mode switching (Form ↔ YAML)
 * - YAML ↔ Config object conversion
 * - Unsaved changes detection
 * - Validation orchestration
 *
 * The actual editing is delegated to:
 * - YAMLEditorView - for YAML mode
 * - FormEditorView - for Form mode
 *
 * TODO: Future optimization - derive form metadata from schemas
 * Currently form sections have manual field definitions. Consider deriving:
 * - Required/optional fields from schema
 * - Default values from schema defaults
 * - Enum options from schema enums
 * - Field types from schema types
 * This would eliminate hardcoded UI metadata and reduce maintenance.
 * This likely requires shared runtime-safe schema metadata helpers in core.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDebounce } from 'use-debounce';
import { Button } from '../ui/button';
import { X, Save, RefreshCw, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    useAgentConfig,
    useValidateAgent,
    useSaveAgentConfig,
    type ValidationError,
    type ValidationWarning,
} from '../hooks/useAgentConfig';
import YAMLEditorView from './YAMLEditorView';
import FormEditorView from './FormEditorView';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../ui/dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import * as yaml from 'yaml';
import type { AgentConfig } from '@fius/agent-config';

interface CustomizePanelProps {
    isOpen: boolean;
    onClose: () => void;
    variant?: 'overlay' | 'inline';
}

type EditorMode = 'form' | 'yaml';

export default function CustomizePanel({
    isOpen,
    onClose,
    variant = 'overlay',
}: CustomizePanelProps) {
    const {
        data: configData,
        isLoading,
        error: loadError,
        refetch: refetchConfig,
    } = useAgentConfig(isOpen);
    const validateMutation = useValidateAgent();
    const saveMutation = useSaveAgentConfig();

    const [yamlContent, setYamlContent] = useState<string>('');
    const [originalYamlContent, setOriginalYamlContent] = useState<string>('');
    const [parsedConfig, setParsedConfig] = useState<AgentConfig | null>(null);
    const [originalParsedConfig, setOriginalParsedConfig] = useState<AgentConfig | null>(null);
    const [yamlDocument, setYamlDocument] = useState<yaml.Document | null>(null);
    const [relativePath, setRelativePath] = useState<string>('');

    const [editorMode, setEditorMode] = useState<EditorMode>('yaml');
    const [parseError, setParseError] = useState<string | null>(null);

    const [isValid, setIsValid] = useState(true);
    const [errors, setErrors] = useState<ValidationError[]>([]);
    const [warnings, setWarnings] = useState<ValidationWarning[]>([]);

    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string>('');

    const [debouncedYamlContent] = useDebounce(yamlContent, 500);
    const latestValidationRequestRef = useRef(0);

    const validateYaml = useCallback(
        async (yaml: string) => {
            const requestId = latestValidationRequestRef.current + 1;
            latestValidationRequestRef.current = requestId;

            try {
                const data = await validateMutation.mutateAsync({ yaml });
                if (latestValidationRequestRef.current === requestId) {
                    setIsValid(data.valid);
                    setErrors(data.errors || []);
                    setWarnings(data.warnings || []);
                }
            } catch (_err: unknown) {
                if (latestValidationRequestRef.current === requestId) {
                    setIsValid(false);
                    setErrors([
                        { message: 'Failed to validate configuration', code: 'VALIDATION_ERROR' },
                    ]);
                }
            }
        },
        [validateMutation.mutateAsync]
    );

    useEffect(() => {
        if (configData && isOpen) {
            setYamlContent(configData.yaml);
            setOriginalYamlContent(configData.yaml);
            setRelativePath(configData.relativePath);
            setHasUnsavedChanges(false);

            const { config, document } = parseYamlToConfig(configData.yaml);
            if (config && document) {
                setParsedConfig(config);
                setOriginalParsedConfig(config);
                setYamlDocument(document);
            }

            validateYaml(configData.yaml);
        }
    }, [configData, isOpen, validateYaml]);

    const parseYamlToConfig = (
        yamlString: string
    ): { config: AgentConfig | null; document: yaml.Document | null; error: string | null } => {
        try {
            const document = yaml.parseDocument(yamlString);

            if (document.errors && document.errors.length > 0) {
                const message = document.errors.map((e) => e.message).join('; ');
                return { config: null, document: null, error: message };
            }

            const config = document.toJS() as AgentConfig;
            return { config, document, error: null };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to parse YAML';
            return { config: null, document: null, error: message };
        }
    };

    const updateYamlDocumentFromConfig = (
        document: yaml.Document,
        config: AgentConfig
    ): yaml.Document => {
        const updateNode = (node: yaml.Node | null | undefined, value: unknown): yaml.Node => {
            if (value === null || value === undefined) {
                return document.createNode(value);
            }

            if (Array.isArray(value)) {
                return document.createNode(value);
            }

            if (typeof value === 'object' && !Array.isArray(value)) {
                if (!node || !yaml.isMap(node)) {
                    return document.createNode(value);
                }

                const existingKeys = new Set<string>();

                for (const pair of node.items) {
                    if (!yaml.isScalar(pair.key) || typeof pair.key.value !== 'string') {
                        continue;
                    }

                    const key = pair.key.value;
                    existingKeys.add(key);

                    if (key in (value as Record<string, unknown>)) {
                        pair.value = updateNode(
                            yaml.isNode(pair.value) ? pair.value : null,
                            (value as Record<string, unknown>)[key]
                        );
                    }
                }

                for (const [key, val] of Object.entries(value)) {
                    if (!existingKeys.has(key)) {
                        node.items.push(document.createPair(key, val));
                    }
                }

                node.items = node.items.filter((pair) => {
                    if (!yaml.isScalar(pair.key) || typeof pair.key.value !== 'string') {
                        return false;
                    }
                    return pair.key.value in (value as Record<string, unknown>);
                });

                return node;
            }

            return document.createNode(value);
        };

        document.contents = updateNode(document.contents, config);
        return document;
    };

    const cleanupConfig = (config: AgentConfig): AgentConfig => {
        const isEmptyValue = (value: unknown): boolean => {
            if (value === null || value === undefined) return true;
            if (value === '') return true;
            if (Array.isArray(value) && value.length === 0) return true;
            if (
                typeof value === 'object' &&
                value !== null &&
                Object.prototype.toString.call(value) === '[object Object]' &&
                Object.keys(value).length === 0
            ) {
                return true;
            }
            return false;
        };

        const deepCleanup = (obj: unknown): unknown => {
            if (Array.isArray(obj)) {
                return obj.map(deepCleanup).filter((item) => !isEmptyValue(item));
            }

            if (typeof obj === 'object' && obj !== null) {
                const cleaned: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(obj)) {
                    if (isEmptyValue(value)) {
                        continue;
                    }

                    if (typeof value === 'object' && value !== null) {
                        const cleanedValue = deepCleanup(value);
                        if (!isEmptyValue(cleanedValue)) {
                            cleaned[key] = cleanedValue;
                        }
                    } else {
                        cleaned[key] = value;
                    }
                }
                return cleaned;
            }

            return obj;
        };

        return deepCleanup(config) as AgentConfig;
    };

    const serializeConfigToYaml = (config: AgentConfig, document: yaml.Document): string => {
        const cleanedConfig = cleanupConfig(config);

        const updatedDoc = updateYamlDocumentFromConfig(document, cleanedConfig);
        const result = updatedDoc.toString();
        return result;
    };

    const configsAreEqual = (a: AgentConfig | null, b: AgentConfig | null): boolean => {
        if (a === b) return true;
        if (!a || !b) return false;
        return JSON.stringify(a) === JSON.stringify(b);
    };

    const handleYamlChange = (value: string) => {
        setYamlContent(value);
        setHasUnsavedChanges(value !== originalYamlContent);
        setSaveSuccess(false);

        const { config, document } = parseYamlToConfig(value);
        if (config && document) {
            setParsedConfig(config);
            setYamlDocument(document);
        }
    };

    const handleFormChange = (newConfig: AgentConfig) => {
        if (!yamlDocument) {
            return;
        }

        setParsedConfig(newConfig);
        const newYaml = serializeConfigToYaml(newConfig, yamlDocument);
        setYamlContent(newYaml);
        setHasUnsavedChanges(!configsAreEqual(newConfig, originalParsedConfig));
        setSaveSuccess(false);
    };

    const handleModeSwitch = (newMode: EditorMode) => {
        if (newMode === editorMode) {
            return;
        }

        if (newMode === 'form') {
            const { config, document, error } = parseYamlToConfig(yamlContent);
            if (error) {
                setParseError(error);
                return;
            }
            setParsedConfig(config);
            setYamlDocument(document);
            setParseError(null);
        }

        setEditorMode(newMode);
    };

    const handleSave = useCallback(async () => {
        if (!isValid || errors.length > 0) {
            return;
        }

        setSaveSuccess(false);
        setSaveMessage('');

        try {
            const data = await saveMutation.mutateAsync({ yaml: yamlContent });

            setOriginalYamlContent(yamlContent);
            setHasUnsavedChanges(false);
            setSaveSuccess(true);

            if (data.restarted) {
                setSaveMessage(
                    `Configuration applied successfully — ${data.changesApplied.join(', ')} updated`
                );
            } else {
                setSaveMessage('Configuration saved successfully (no changes detected)');
            }

            setTimeout(() => {
                setSaveSuccess(false);
                setSaveMessage('');
            }, 5000);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Error saving agent config: ${message}`);
        }
    }, [isValid, errors, saveMutation, yamlContent]);

    const handleReload = () => {
        if (hasUnsavedChanges) {
            setShowUnsavedDialog(true);
        } else {
            refetchConfig();
        }
    };

    const handleClose = useCallback(() => {
        if (hasUnsavedChanges) {
            setShowUnsavedDialog(true);
        } else {
            onClose();
        }
    }, [hasUnsavedChanges, onClose]);

    const handleDiscardChanges = () => {
        setShowUnsavedDialog(false);
        setYamlContent(originalYamlContent);
        if (originalParsedConfig) {
            setParsedConfig(originalParsedConfig);
            const { document } = parseYamlToConfig(originalYamlContent);
            if (document) {
                setYamlDocument(document);
            }
        }
        setHasUnsavedChanges(false);
        refetchConfig();
    };

    useEffect(() => {
        if (isOpen) {
            validateYaml(debouncedYamlContent);
        }
    }, [debouncedYamlContent, isOpen, validateYaml]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                if (!saveMutation.isPending && isValid) {
                    handleSave();
                }
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, saveMutation.isPending, isValid, hasUnsavedChanges, handleSave, handleClose]);

    if (!isOpen) return null;

    const getSaveDisabledReason = (): string | null => {
        if (saveMutation.isPending) return null;
        if (!hasUnsavedChanges) return 'No changes to save';
        if (errors.length > 0) {
            const firstError = errors[0];
            if (firstError.path) {
                return `Configuration error in ${firstError.path}: ${firstError.message}`;
            }
            return `Configuration error: ${firstError.message}`;
        }
        if (!isValid) return 'Configuration has validation errors';
        return null;
    };

    const saveDisabledReason = getSaveDisabledReason();
    const isSaveDisabled =
        !hasUnsavedChanges || saveMutation.isPending || !isValid || errors.length > 0;

    const panelContent = (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold">Customize Agent</h2>
                            <a
                                href="https://docs.fius.ai/docs/guides/configuring-fius/overview"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                                title="View configuration documentation"
                            >
                                View docs
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        </div>
                        {relativePath && (
                            <p className="text-xs text-muted-foreground">{relativePath}</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Mode Toggle */}
                    <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant={editorMode === 'yaml' ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => handleModeSwitch('yaml')}
                                    className="h-7 px-3"
                                >
                                    YAML Editor
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Edit configuration in raw YAML format with full control
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant={editorMode === 'form' ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => handleModeSwitch('form')}
                                    className="h-7 px-3"
                                >
                                    Form Editor
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Edit configuration using user-friendly forms
                            </TooltipContent>
                        </Tooltip>
                    </div>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleReload}
                                disabled={isLoading}
                            >
                                <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Reload configuration</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="sm" onClick={handleClose}>
                                <X className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Close (Esc)</TooltipContent>
                    </Tooltip>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {loadError ? (
                    <div className="flex items-center justify-center h-full p-4">
                        <div className="text-center max-w-md">
                            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
                            <h3 className="text-lg font-semibold mb-2">
                                Failed to load configuration
                            </h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                {loadError?.message || 'Unknown error'}
                            </p>
                            <Button onClick={() => refetchConfig()} variant="outline">
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Retry
                            </Button>
                        </div>
                    </div>
                ) : isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
                            <p className="text-sm text-muted-foreground">
                                Loading configuration...
                            </p>
                        </div>
                    </div>
                ) : parseError && editorMode === 'form' ? (
                    <div className="flex items-center justify-center h-full p-4">
                        <div className="text-center max-w-md">
                            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
                            <h3 className="text-lg font-semibold mb-2">Cannot parse YAML</h3>
                            <p className="text-sm text-muted-foreground mb-4">{parseError}</p>
                            <Button onClick={() => setEditorMode('yaml')} variant="outline">
                                Switch to YAML Editor
                            </Button>
                        </div>
                    </div>
                ) : editorMode === 'yaml' ? (
                    <YAMLEditorView
                        value={yamlContent}
                        onChange={handleYamlChange}
                        isValidating={validateMutation.isPending}
                        isValid={isValid}
                        errors={errors}
                        warnings={warnings}
                        hasUnsavedChanges={hasUnsavedChanges}
                    />
                ) : parsedConfig ? (
                    <FormEditorView
                        config={parsedConfig}
                        onChange={handleFormChange}
                        errors={errors.reduce(
                            (acc, err) => {
                                if (err.path) {
                                    acc[err.path] = err.message;
                                }
                                return acc;
                            },
                            {} as Record<string, string>
                        )}
                    />
                ) : null}
            </div>

            {/* Footer */}
            {!loadError && !isLoading && (
                <div className="flex flex-col border-t border-border">
                    {/* Save status messages */}
                    {(saveSuccess || saveMutation.error) && (
                        <div className="px-4 py-3 bg-muted/50 border-b border-border">
                            {saveSuccess && (
                                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
                                    <CheckCircle className="h-4 w-4" />
                                    <span>{saveMessage}</span>
                                </div>
                            )}
                            {saveMutation.error && (
                                <div className="flex items-center gap-2 text-sm text-destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <span>{saveMutation.error.message}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center justify-between px-4 py-3">
                        <div />
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={handleClose}>
                                Close
                            </Button>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div>
                                        <Button
                                            variant="default"
                                            size="sm"
                                            onClick={handleSave}
                                            disabled={isSaveDisabled}
                                        >
                                            {saveMutation.isPending ? (
                                                <>
                                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent mr-2" />
                                                    Saving...
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="h-4 w-4 mr-2" />
                                                    Save
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {saveDisabledReason || 'Save configuration (⌘S)'}
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    </div>
                </div>
            )}

            {/* Unsaved changes dialog */}
            <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Unsaved Changes</DialogTitle>
                        <DialogDescription>
                            You have unsaved changes. Do you want to discard them?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowUnsavedDialog(false)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDiscardChanges}>
                            Discard Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );

    if (variant === 'inline') {
        return panelContent;
    }

    return (
        <>
            {/* Backdrop */}
            <div
                className={cn(
                    'fixed inset-0 z-40 bg-background/60 backdrop-blur-sm transition-opacity duration-300',
                    isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
                onClick={handleClose}
            />
            {/* Panel */}
            <div
                className={cn(
                    'fixed inset-y-0 right-0 z-50 w-full sm:w-[600px] md:w-[700px] lg:w-[800px] border-l border-border/50 bg-card/95 backdrop-blur-xl shadow-2xl transform transition-transform duration-300',
                    isOpen ? 'translate-x-0' : 'translate-x-full'
                )}
            >
                {panelContent}
            </div>
        </>
    );
}
