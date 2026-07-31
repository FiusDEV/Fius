/**
 * Custom Models Persistence
 *
 * Manages saved custom model configurations.
 * Stored in ~/.fius/models/custom-models.json
 */

import { z } from 'zod';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getFiusGlobalPath } from '../utils/path.js';

export type CustomModelProvider = string;

/**
 * Schema for a saved custom model configuration.
 */
export const CustomModelSchema = z
    .object({
        name: z.string().min(1),
        provider: z.string().default('custom'),
        displayProvider: z.string().optional(),
        baseURL: z.string().url().optional(),
        displayName: z.string().optional(),
        maxInputTokens: z.number().int().positive().optional(),
        maxOutputTokens: z.number().int().positive().optional(),
        apiKey: z.string().optional(),
        reasoningPreset: z.string().optional(),
        filePath: z.string().optional(),
        supportedFileTypes: z.array(z.string()).optional(),
    })
    .passthrough();

export type CustomModel = z.infer<typeof CustomModelSchema>;

const CUSTOM_MODELS_DIR = 'models';
const CUSTOM_MODELS_FILE = 'custom-models.json';

export function getCustomModelsPath(): string {
    return path.join(getFiusGlobalPath('models'), CUSTOM_MODELS_FILE);
}

export async function loadCustomModels(): Promise<CustomModel[]> {
    try {
        const data = await fs.readFile(getCustomModelsPath(), 'utf-8');
        return z.array(CustomModelSchema).parse(JSON.parse(data));
    } catch {
        return [];
    }
}

export async function saveCustomModels(models: CustomModel[]): Promise<void> {
    const dir = path.dirname(getCustomModelsPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getCustomModelsPath(), JSON.stringify(models, null, 2));
}

export async function saveCustomModel(model: CustomModel): Promise<void> {
    const models = await loadCustomModels();
    const existingIndex = models.findIndex(
        (m) => m.name === model.name && m.provider === model.provider
    );
    if (existingIndex >= 0) {
        models[existingIndex] = model;
    } else {
        models.push(model);
    }
    await saveCustomModels(models);
}

export async function deleteCustomModel(name: string, provider?: string): Promise<boolean> {
    const models = await loadCustomModels();
    const filtered = models.filter(
        (m) => provider ? !(m.name === name && m.provider === provider) : m.name !== name
    );
    const deleted = filtered.length < models.length;
    await saveCustomModels(filtered);
    return deleted;
}

export async function getCustomModel(name: string, provider: string): Promise<CustomModel | undefined> {
    const models = await loadCustomModels();
    return models.find((m) => m.name === name && m.provider === provider);
}

export async function addCustomModel(model: CustomModel): Promise<void> {
    await saveCustomModel(model);
}

export async function removeCustomModel(name: string, provider: string): Promise<void> {
    await deleteCustomModel(name, provider);
}
