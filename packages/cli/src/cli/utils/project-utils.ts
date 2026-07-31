import fs from 'node:fs/promises';
import { parseDocument } from 'yaml';
import { type LLMProvider, getDefaultModelForProvider } from '@fius/llm';
import { getPrimaryApiKeyEnvVar } from '@fius/core';

export async function updateFiusConfigFile(
    filepath: string,
    llmProvider: LLMProvider
): Promise<void> {
    const fileContent = await fs.readFile(filepath, 'utf8');
    const doc = parseDocument(fileContent);
    doc.setIn(['llm', 'provider'], llmProvider);
    doc.setIn(['llm', 'apiKey'], `$${getPrimaryApiKeyEnvVar(llmProvider)}`);
    const defaultModel = getDefaultModelForProvider(llmProvider);
    if (defaultModel) {
        doc.setIn(['llm', 'model'], defaultModel);
    }
    await fs.writeFile(filepath, doc.toString(), 'utf8');
}