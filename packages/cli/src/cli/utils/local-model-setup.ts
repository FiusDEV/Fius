import chalk from 'chalk';
import * as p from '@clack/prompts';
import * as fs from 'fs';
import * as path from 'path';
import {
    getRecommendedLocalModels,
    getAllLocalModels,
    getLocalModelById,
    detectGPU,
    formatGPUInfo,
    downloadModel,
    checkOllamaStatus,
    listOllamaModels,
    isOllamaModelAvailable,
    pullOllamaModel,
    isNodeLlamaCppInstalled,
    type ModelDownloadProgress,
} from '@fius/core';
import { spawn } from 'child_process';
import {
    getAllInstalledModels,
    setActiveModel,
    addInstalledModel,
    getModelsDirectory,
    modelFileExists,
    getModelFileSize,
    formatSize,
    saveCustomModel,
    getFiusGlobalPath,
    type InstalledModel,
} from '@fius/agent-management';

export interface LocalModelSetupResult {
    success: boolean;

    modelId?: string;

    cancelled?: boolean;

    back?: boolean;

    skipped?: boolean;
}

export function hasSelectedModel(
    result: LocalModelSetupResult
): result is LocalModelSetupResult & { modelId: string } {
    return (
        result.success && !result.cancelled && !result.back && !result.skipped && !!result.modelId
    );
}

async function installNodeLlamaCpp(): Promise<boolean> {
    const depsDir = getFiusGlobalPath('deps');


    if (!fs.existsSync(depsDir)) {
        fs.mkdirSync(depsDir, { recursive: true });
    }


    const packageJsonPath = path.join(depsDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        fs.writeFileSync(
            packageJsonPath,
            JSON.stringify(
                {
                    name: 'fius-deps',
                    version: '1.0.0',
                    private: true,
                    description: 'Native dependencies for Fius',
                },
                null,
                2
            )
        );
    }

    return new Promise((resolve) => {

        const child = spawn('npm', ['install', 'node-llama-cpp'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: depsDir,
            shell: true,
        });

        let stderr = '';
        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(true);
            } else {
                console.error(chalk.gray(stderr));
                resolve(false);
            }
        });

        child.on('error', () => {
            resolve(false);
        });
    });
}

async function ensureNodeLlamaCpp(): Promise<boolean> {
    const isInstalled = await isNodeLlamaCppInstalled();
    if (isInstalled) {
        return true;
    }

    p.note(
        'Local model execution requires node-llama-cpp.\n' +
            'This will compile native bindings for your system.\n\n' +
            chalk.gray('Installation may take 1-2 minutes.'),
        'Dependency Required'
    );

    const shouldInstall = await p.confirm({
        message: 'Install node-llama-cpp now?',
        initialValue: true,
    });

    if (p.isCancel(shouldInstall) || !shouldInstall) {
        return false;
    }

    const spinner = p.spinner();
    spinner.start('Installing node-llama-cpp (compiling native bindings)...');

    const success = await installNodeLlamaCpp();

    if (success) {
        spinner.stop(chalk.green('вњ“ node-llama-cpp installed successfully'));
        return true;
    } else {
        spinner.stop(chalk.red('вњ— Installation failed'));
        p.log.error(
            'Failed to install node-llama-cpp. You can try manually:\n' +
                chalk.gray('  npm install node-llama-cpp')
        );
        return false;
    }
}

export async function setupLocalModels(): Promise<LocalModelSetupResult> {
    console.log(chalk.cyan('\nрџ¤– Local Model Setup\n'));


    const dependencyReady = await ensureNodeLlamaCpp();
    if (!dependencyReady) {
        p.log.warn('Setup cancelled - node-llama-cpp is required for local models.');
        return { success: false, cancelled: true };
    }


    const installed = await getAllInstalledModels();
    const installedIds = new Set<string>(installed.map((m) => m.id));


    if (installed.length > 0) {
        const useExisting = await p.confirm({
            message: `You have ${installed.length} model(s) installed. Use an existing model?`,
            initialValue: true,
        });

        if (p.isCancel(useExisting)) {
            return { success: false, cancelled: true };
        }

        if (useExisting) {

            const selected = await selectInstalledModel(installed);
            if (selected.cancelled) {
                return { success: false, cancelled: true };
            }
            if (selected.customGGUF) {

                return setupCustomGGUF();
            }
            if (selected.modelId) {
                await setActiveModel(selected.modelId);
                p.log.success(`Using ${selected.modelId} as active model`);
                return { success: true, modelId: selected.modelId };
            }
        }
    }


    const gpuInfo = await detectGPU();
    console.log(chalk.gray(`GPU detected: ${formatGPUInfo(gpuInfo)}\n`));


    const recommendedModels = getRecommendedLocalModels();


    const modelOptions = recommendedModels.map((model) => {
        const isInstalled = installedIds.has(model.id);
        const statusIcon = isInstalled ? chalk.green('вњ“') : chalk.gray('в—‹');
        const vramHint = model.minVRAM ? `${model.minVRAM}GB+ VRAM` : 'CPU OK';

        return {
            value: model.id,
            label: `${statusIcon} ${model.name}`,
            hint: `${formatSize(model.sizeBytes)} | ${vramHint}${isInstalled ? ' (installed)' : ''}`,
        };
    });


    modelOptions.push({
        value: '_all_models',
        label: `${chalk.blue('...')} Show all available models`,
        hint: `${getAllLocalModels().length} models available`,
    });


    modelOptions.push({
        value: '_custom_gguf',
        label: `${chalk.blue('...')} Use custom GGUF file`,
        hint: 'For GGUF files not in registry',
    });


    modelOptions.push({
        value: '_skip',
        label: `${chalk.rgb(255, 165, 0)('в†’')} Skip for now`,
        hint: 'Configure later with: fius setup',
    });


    modelOptions.push({
        value: '_back',
        label: chalk.gray('в†ђ Back'),
        hint: 'Choose a different provider',
    });

    p.note(
        'Local models run completely on your machine - free, private, and offline.\n' +
            'Select a model to download (or use an existing one).',
        'Local AI'
    );

    const selected = await p.select({
        message: 'Choose a model to use',
        options: modelOptions,
    });

    if (p.isCancel(selected)) {
        return { success: false, cancelled: true };
    }

    if (selected === '_skip') {
        p.log.info(chalk.gray('Skipped model selection. Use `fius setup` to configure later.'));
        return { success: true, skipped: true };
    }

    if (selected === '_back') {
        return { success: false, back: true };
    }

    if (selected === '_all_models') {

        return await showAllModelsSelection(installedIds);
    }

    if (selected === '_custom_gguf') {

        return setupCustomGGUF();
    }

    const modelId = selected as string;


    if (installedIds.has(modelId)) {
        await setActiveModel(modelId);
        p.log.success(`Using ${modelId} as active model`);
        return { success: true, modelId };
    }


    const downloadResult = await downloadModelInteractive(modelId);
    if (!downloadResult.success) {
        if (downloadResult.cancelled) {
            return { success: false, cancelled: true };
        }
        return { success: false };
    }


    await setActiveModel(modelId);
    return { success: true, modelId };
}

async function ensureOllamaModelAvailable(modelName: string): Promise<boolean> {

    const isAvailable = await isOllamaModelAvailable(modelName);
    if (isAvailable) {
        return true;
    }


    console.log(chalk.rgb(255, 165, 0)(`\nвљ пёЏ  Model '${modelName}' is not available locally.\n`));

    const shouldPull = await p.confirm({
        message: `Pull '${modelName}' from Ollama now?`,
        initialValue: true,
    });

    if (p.isCancel(shouldPull) || !shouldPull) {
        p.log.warn('Skipping model pull. You can pull it later with: ollama pull ' + modelName);
        return false;
    }


    const spinner = p.spinner();
    spinner.start(`Pulling ${modelName} from Ollama...`);

    try {
        await pullOllamaModel(modelName, undefined, (progress) => {

            if (progress.completed && progress.total) {
                const percent = Math.round((progress.completed / progress.total) * 100);
                const sizeDownloaded = formatSize(progress.completed);
                const sizeTotal = formatSize(progress.total);
                spinner.message(
                    `Pulling ${modelName}... ${percent}% (${sizeDownloaded}/${sizeTotal}) - ${progress.status}`
                );
            } else {
                spinner.message(`Pulling ${modelName}... ${progress.status}`);
            }
        });

        spinner.stop(chalk.green(`вњ“ Successfully pulled ${modelName}`));
        return true;
    } catch (error) {
        spinner.stop(chalk.red('вњ— Failed to pull model'));
        console.error(
            chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`)
        );
        p.log.warn('You can try pulling manually: ollama pull ' + modelName);
        return false;
    }
}

export async function setupOllamaModels(): Promise<LocalModelSetupResult> {
    console.log(chalk.cyan('\nрџ¦™ Ollama Setup\n'));


    const status = await checkOllamaStatus();

    if (!status.running) {
        p.note(
            chalk.rgb(255, 165, 0)('Ollama server is not running.\n\n') +
                'To use Ollama:\n' +
                '  1. Install Ollama: https://ollama.com/download\n' +
                '  2. Start the server: ollama serve\n' +
                '  3. Pull a model: ollama pull llama3.2',
            'Ollama Required'
        );

        const proceed = await p.confirm({
            message: 'Continue setup anyway? (You can configure Ollama later)',
            initialValue: true,
        });

        if (p.isCancel(proceed)) {
            return { success: false, cancelled: true };
        }
        if (!proceed) {
            return { success: false };
        }


        const modelName = await p.text({
            message: 'Enter the Ollama model name to use',
            placeholder: 'llama3.2',
            initialValue: 'llama3.2',
        });

        if (p.isCancel(modelName)) {
            return { success: false, cancelled: true };
        }

        return { success: true, modelId: modelName.trim() };
    }


    console.log(chalk.green(`вњ“ Ollama ${status.version || ''} running at ${status.url}\n`));

    const ollamaModels = await listOllamaModels();

    if (ollamaModels.length === 0) {
        p.note(
            'No models found in Ollama.\n\n' +
                'To pull a model:\n' +
                '  ollama pull llama3.2\n\n' +
                'Popular models:\n' +
                '  вЂў llama3.2 (3B/8B general)\n' +
                '  вЂў qwen2.5-coder (coding)\n' +
                '  вЂў mistral (7B general)',
            'No Models'
        );

        const modelName = await p.text({
            message: 'Enter the model name to pull',
            placeholder: 'llama3.2',
            initialValue: 'llama3.2',
        });

        if (p.isCancel(modelName)) {
            return { success: false, cancelled: true };
        }

        const trimmedName = modelName.trim();
        const isReady = await ensureOllamaModelAvailable(trimmedName);

        if (!isReady) {

            return { success: false };
        }

        return { success: true, modelId: trimmedName };
    }


    const modelOptions = ollamaModels.map((model) => ({
        value: model.name,
        label: model.name,
        hint: formatSize(model.size),
    }));


    modelOptions.push({
        value: '_custom',
        label: `${chalk.blue('...')} Enter custom model name`,
        hint: 'For models not yet pulled',
    });


    modelOptions.push({
        value: '_back',
        label: chalk.gray('в†ђ Back'),
        hint: 'Choose a different provider',
    });

    const selected = await p.select({
        message: 'Select an Ollama model',
        options: modelOptions,
    });

    if (p.isCancel(selected)) {
        return { success: false, cancelled: true };
    }

    if (selected === '_back') {
        return { success: false, back: true };
    }

    if (selected === '_custom') {
        const modelName = await p.text({
            message: 'Enter the Ollama model name',
            placeholder: 'llama3.2:70b',
        });

        if (p.isCancel(modelName)) {
            return { success: false, cancelled: true };
        }

        const trimmedName = modelName.trim();
        const isReady = await ensureOllamaModelAvailable(trimmedName);

        if (!isReady) {

            return { success: false };
        }

        return { success: true, modelId: trimmedName };
    }

    return { success: true, modelId: selected as string };
}

async function selectInstalledModel(
    installed: InstalledModel[]
): Promise<{ modelId?: string; cancelled?: boolean; customGGUF?: boolean }> {
    const options = installed.map((model) => ({
        value: model.id,
        label: model.id,
        hint: formatSize(model.sizeBytes),
    }));

    options.push({
        value: '_download_new',
        label: `${chalk.blue('+')} Download a new model`,
        hint: 'Browse available models',
    });

    options.push({
        value: '_custom_gguf',
        label: `${chalk.blue('...')} Use custom GGUF file`,
        hint: 'For GGUF files not in registry',
    });

    const selected = await p.select({
        message: 'Select a model',
        options,
    });

    if (p.isCancel(selected)) {
        return { cancelled: true };
    }

    if (selected === '_download_new') {
        return {};
    }

    if (selected === '_custom_gguf') {
        return { customGGUF: true };
    }

    return { modelId: selected as string };
}

async function showAllModelsSelection(installedIds: Set<string>): Promise<LocalModelSetupResult> {
    const allModels = getAllLocalModels();

    const modelOptions = allModels.map((model) => {
        const isInstalled = installedIds.has(model.id);
        const statusIcon = isInstalled ? chalk.green('вњ“') : chalk.gray('в—‹');
        const category = model.categories?.[0] || 'general';
        const vramHint = model.minVRAM ? `${model.minVRAM}GB+` : 'CPU';

        return {
            value: model.id,
            label: `${statusIcon} ${model.name}`,
            hint: `${category} | ${formatSize(model.sizeBytes)} | ${vramHint}${isInstalled ? ' (installed)' : ''}`,
        };
    });

    modelOptions.push({
        value: '_back',
        label: `${chalk.rgb(255, 165, 0)('в†ђ')} Back`,
        hint: 'Return to recommended models',
    });

    const selected = await p.select({
        message: 'Select a model',
        options: modelOptions,
    });

    if (p.isCancel(selected)) {
        return { success: false, cancelled: true };
    }

    if (selected === '_back') {

        return setupLocalModels();
    }

    const modelId = selected as string;


    if (installedIds.has(modelId)) {
        await setActiveModel(modelId);
        p.log.success(`Using ${modelId} as active model`);
        return { success: true, modelId };
    }


    const downloadResult = await downloadModelInteractive(modelId);
    if (!downloadResult.success) {
        if (downloadResult.cancelled) {
            return { success: false, cancelled: true };
        }
        return { success: false };
    }

    await setActiveModel(modelId);
    return { success: true, modelId };
}

async function downloadModelInteractive(
    modelId: string
): Promise<{ success: boolean; cancelled?: boolean }> {
    const modelInfo = getLocalModelById(modelId);
    if (!modelInfo) {
        p.log.error(`Model '${modelId}' not found in registry`);
        return { success: false };
    }



    const fileExistsInSubdir = await modelFileExists(modelId, modelInfo.filename);
    const rootFilePath = `${getModelsDirectory()}/${modelInfo.filename}`;
    let actualFilePath: string | null = null;
    let fileSize: number | null = null;

    if (fileExistsInSubdir) {
        actualFilePath = `${getModelsDirectory()}/${modelId}/${modelInfo.filename}`;
        fileSize = await getModelFileSize(modelId, modelInfo.filename);
    } else {

        try {
            const fs = await import('fs/promises');
            const stats = await fs.stat(rootFilePath);
            if (stats.isFile()) {
                actualFilePath = rootFilePath;
                fileSize = stats.size;
            }
        } catch {

        }
    }

    if (actualFilePath) {
        p.log.info(chalk.green(`вњ“ Model file already exists on disk`));


        const installedModel: InstalledModel = {
            id: modelId,
            filePath: actualFilePath,
            sizeBytes: fileSize ?? modelInfo.sizeBytes,
            downloadedAt: new Date().toISOString(),
            source: 'huggingface',
            filename: modelInfo.filename,
        };

        await addInstalledModel(installedModel);
        p.log.success(`Model '${modelId}' registered successfully`);
        return { success: true };
    }


    p.note(
        `${modelInfo.name}\n` +
            `${modelInfo.description}\n\n` +
            `Size: ${formatSize(modelInfo.sizeBytes)}\n` +
            `Context: ${modelInfo.contextLength.toLocaleString()} tokens\n` +
            `Quantization: ${modelInfo.quantization}`,
        'Model Details'
    );

    const confirmed = await p.confirm({
        message: `Download ${modelInfo.name} (${formatSize(modelInfo.sizeBytes)})?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
        return { success: false, cancelled: true };
    }


    const spinner = p.spinner();
    spinner.start('Starting download...');

    try {
        const result = await downloadModel(modelId, {
            targetDir: getModelsDirectory(),
            events: {
                onProgress: (progress: ModelDownloadProgress) => {
                    const pct = progress.percentage.toFixed(1);
                    const downloaded = formatSize(progress.bytesDownloaded);
                    const total = formatSize(progress.totalBytes);
                    const speedStr = progress.speed ? `${formatSize(progress.speed)}/s` : '';
                    const etaStr = progress.eta ? `ETA: ${Math.round(progress.eta)}s` : '';

                    spinner.message(`${pct}% (${downloaded}/${total}) ${speedStr} ${etaStr}`);
                },
                onComplete: () => {
                    spinner.stop(chalk.green(`вњ“ Downloaded ${modelInfo.name}`));
                },
                onError: (_modelId: string, error: Error) => {
                    spinner.stop(chalk.red(`вњ— Download failed: ${error.message}`));
                },
            },
        });


        const installedModel: InstalledModel = {
            id: modelId,
            filePath: result.filePath,
            sizeBytes: result.sizeBytes,
            downloadedAt: new Date().toISOString(),
            source: 'huggingface',
            filename: modelInfo.filename,
        };

        if (result.sha256) {
            installedModel.sha256 = result.sha256;
        }

        await addInstalledModel(installedModel);

        p.log.success(`Model '${modelId}' installed successfully`);
        return { success: true };
    } catch (error) {
        spinner.stop(chalk.red('Download failed'));
        p.log.error(
            `Failed to download: ${error instanceof Error ? error.message : String(error)}`
        );
        return { success: false };
    }
}

async function setupCustomGGUF(): Promise<LocalModelSetupResult> {

    const filePath = await p.text({
        message: 'Enter path to GGUF file',
        placeholder: '/path/to/model.gguf',
        validate: (value) => {
            if (!value.trim()) {
                return 'File path is required';
            }
            if (!value.endsWith('.gguf')) {
                return 'File must have .gguf extension';
            }
            if (!path.isAbsolute(value)) {
                return 'Please enter an absolute path';
            }
            return undefined;
        },
    });

    if (p.isCancel(filePath)) {
        return { success: false, cancelled: true };
    }

    const trimmedPath = filePath.trim();


    try {
        const stats = fs.statSync(trimmedPath);
        if (!stats.isFile()) {
            p.log.error('Path is not a file');
            return { success: false };
        }

        const sizeBytes = stats.size;
        const filename = path.basename(trimmedPath, '.gguf');

        console.log(
            chalk.green(`\nвњ“ Found: ${path.basename(trimmedPath)} (${formatSize(sizeBytes)})\n`)
        );


        const displayName = await p.text({
            message: 'Display name (optional)',
            placeholder: filename,
            initialValue: filename,
        });

        if (p.isCancel(displayName)) {
            return { success: false, cancelled: true };
        }





        let modelId = filename
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .substring(0, 50);


        if (!modelId) {
            modelId = `custom-model-${Date.now()}`;
        }


        await saveCustomModel({
            name: modelId,
            provider: 'local',
            filePath: trimmedPath,
            displayName: displayName?.trim() || filename,
        });

        p.log.success(`Registered as '${modelId}'`);

        return { success: true, modelId };
    } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
            p.log.error('File not found');
        } else if (nodeError.code === 'EACCES') {
            p.log.error('Permission denied - file is not readable');
        } else {
            p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
        return { success: false };
    }
}

export function getModelFromResult(result: LocalModelSetupResult & { modelId: string }): string {
    return result.modelId;
}