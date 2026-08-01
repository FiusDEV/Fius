import { setImageImporter } from '@fiusdev/agent-config';
import { importImageModule } from './image-store.js';

let imageImporterConfigured = false;

export async function ensureImageImporterConfigured(): Promise<void> {
    if (imageImporterConfigured) {
        return;
    }

    try {
        setImageImporter((specifier) => importImageModule(specifier));
    } catch {

    }
    imageImporterConfigured = true;
}