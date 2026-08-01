

import type { CustomModel, CustomModelProvider } from '@fiusdev/agent-management';
import type { Key } from '../../../hooks/useInputOrchestrator.js';


export interface WizardStep {
    field: string;
    label: string;
    placeholder: string;
    required: boolean;
    validate?: (value: string) => string | null;
    
    condition?: (values: Record<string, string>) => boolean;
}


export interface ProviderWizardProps {
    
    values: Record<string, string>;
    
    currentStep: number;
    
    currentInput: string;
    
    error: string | null;
    
    isValidating: boolean;
    
    isSaving: boolean;
    
    isEditing: boolean;
}


export interface ProviderWizardHandle {
    
    handleInput: (input: string, key: Key) => boolean;
    
    getSteps: () => WizardStep[];
    
    getCurrentStepConfig: () => WizardStep | undefined;
}


export interface ProviderConfig {
    
    displayName: string;
    
    description: string;
    
    steps: WizardStep[];
    
    buildModel: (values: Record<string, string>, provider: CustomModelProvider) => CustomModel;
    
    asyncValidation?: {
        field: string;
        validate: (value: string) => Promise<string | null>;
    };
    
    setupInfo?: {
        title: string;
        description: string;
        docsUrl?: string;
    };
}


export const validators = {
    required: (label: string) => (v: string) => (v.trim() ? null : `${label} is required`),

    url: (v: string) => {
        if (!v.trim()) return 'URL is required';
        try {
            const url = new URL(v);
            if (!['http:', 'https:'].includes(url.protocol)) {
                return 'URL must use http:// or https://';
            }
            return null;
        } catch {
            return 'Invalid URL format';
        }
    },

    positiveNumber: (v: string) => {
        if (!v.trim()) return null; // Optional field
        const num = parseInt(v, 10);
        if (isNaN(num) || num <= 0) return 'Must be a positive number';
        return null;
    },

    slashFormat: (v: string) => {
        if (!v.trim()) return 'Model ID is required';
        if (!v.includes('/')) return 'Must use format: provider/model-name';
        return null;
    },
};
