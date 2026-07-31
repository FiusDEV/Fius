import { createWriteStream, promises as fs, existsSync, createReadStream } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import type { ModelDownloadProgress, ModelDownloadStatus } from './types.js';
import { LocalModelError } from './errors.js';
import { getLocalModelById } from './registry.js';

export interface DownloadEvents {
    onProgress?: (progress: ModelDownloadProgress) => void;
    onComplete?: (modelId: string, filePath: string) => void;
    onError?: (modelId: string, error: Error) => void;
}

export interface DownloadOptions {
    
    targetDir: string;
    
    events?: DownloadEvents;
    
    hfToken?: string;
    
    verifyHash?: boolean;
    
    signal?: AbortSignal;
    
    expectedHash?: string;
}

export interface DownloadResult {
    
    success: boolean;
    
    filePath: string;
    
    sizeBytes: number;
    
    sha256?: string;
    
    resumed: boolean;
}

function buildHuggingFaceUrl(huggingfaceId: string, filename: string): string {
    return `https://huggingface.co/${huggingfaceId}/resolve/main/${filename}`;
}

async function getPartialSize(filePath: string): Promise<number> {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    } catch {
        return 0;
    }
}

export async function calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);

        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

function createProgressEvent(
    modelId: string,
    status: ModelDownloadStatus,
    bytesDownloaded: number,
    totalBytes: number,
    speed?: number,
    eta?: number,
    error?: string
): ModelDownloadProgress {
    const progress: ModelDownloadProgress = {
        modelId,
        status,
        bytesDownloaded,
        totalBytes,
        percentage: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0,
    };

    if (speed !== undefined) {
        progress.speed = speed;
    }
    if (eta !== undefined) {
        progress.eta = eta;
    }
    if (error !== undefined) {
        progress.error = error;
    }

    return progress;
}

async function downloadFromHuggingFace(
    url: string,
    targetPath: string,
    options: DownloadOptions,
    modelId: string,
    expectedSize: number
): Promise<DownloadResult> {
    const { events, hfToken, signal } = options;

    const tempPath = `${targetPath}.download`;
    const partialSize = await getPartialSize(tempPath);
    const resumed = partialSize > 0;

    const headers: Record<string, string> = {
        'User-Agent': 'Fius/1.0',
    };

    if (hfToken) {
        headers['Authorization'] = `Bearer ${hfToken}`;
    }

    if (partialSize > 0) {
        headers['Range'] = `bytes=${partialSize}-`;
    }

    try {
        const fetchOptions: RequestInit = { headers };
        if (signal) {
            fetchOptions.signal = signal;
        }

        const response = await fetch(url, fetchOptions);

        if (response.status === 401 || response.status === 403) {
            throw LocalModelError.hfAuthRequired(modelId);
        }

        if (!response.ok && response.status !== 206) {
            throw LocalModelError.downloadFailed(
                modelId,
                `HTTP ${response.status}: ${response.statusText}`
            );
        }

        const contentLengthHeader = response.headers.get('content-length');
        const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
        const totalSize = partialSize + contentLength;

        await fs.mkdir(path.dirname(tempPath), { recursive: true });

        const writeStream = createWriteStream(tempPath, {
            flags: resumed ? 'a' : 'w',
        });

        let bytesDownloaded = partialSize;
        const startTime = Date.now();
        let lastProgressUpdate = startTime;

        const reader = response.body?.getReader();
        if (!reader) {
            writeStream.destroy();
            throw LocalModelError.downloadFailed(modelId, 'No response body');
        }

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                writeStream.write(value);
                bytesDownloaded += value.length;

                const now = Date.now();
                if (now - lastProgressUpdate > 100 || done) {
                    lastProgressUpdate = now;
                    const elapsedSeconds = (now - startTime) / 1000;
                    const speed =
                        elapsedSeconds > 0 ? (bytesDownloaded - partialSize) / elapsedSeconds : 0;
                    const remainingBytes = totalSize - bytesDownloaded;
                    const eta = speed > 0 ? remainingBytes / speed : 0;

                    const progress = createProgressEvent(
                        modelId,
                        'downloading',
                        bytesDownloaded,
                        totalSize || expectedSize,
                        speed,
                        eta
                    );

                    events?.onProgress?.(progress);
                }
            }

            await new Promise<void>((resolve, reject) => {
                writeStream.end((err: Error | null | undefined) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (error) {
            writeStream.destroy();
            throw error;
        }

        events?.onProgress?.(createProgressEvent(modelId, 'verifying', bytesDownloaded, totalSize));

        await fs.rename(tempPath, targetPath);

        const stats = await fs.stat(targetPath);

        events?.onProgress?.(createProgressEvent(modelId, 'complete', stats.size, stats.size));

        return {
            success: true,
            filePath: targetPath,
            sizeBytes: stats.size,
            resumed,
        };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw LocalModelError.downloadInterrupted(modelId);
        }
        throw error;
    }
}

export async function downloadModel(
    modelId: string,
    options: DownloadOptions
): Promise<DownloadResult> {
    const modelInfo = getLocalModelById(modelId);
    if (!modelInfo) {
        throw LocalModelError.modelNotFound(modelId);
    }

    const targetPath = path.join(options.targetDir, modelInfo.filename);
    const url = buildHuggingFaceUrl(modelInfo.huggingfaceId, modelInfo.filename);

    if (existsSync(targetPath)) {
        const stats = await fs.stat(targetPath);
        if (stats.size === modelInfo.sizeBytes) {
            return {
                success: true,
                filePath: targetPath,
                sizeBytes: stats.size,
                resumed: false,
            };
        }
        await fs.unlink(targetPath);
    }

    try {
        options.events?.onProgress?.(
            createProgressEvent(modelId, 'pending', 0, modelInfo.sizeBytes)
        );

        const result = await downloadFromHuggingFace(
            url,
            targetPath,
            options,
            modelId,
            modelInfo.sizeBytes
        );

        if (options.verifyHash && options.expectedHash) {
            const actualHash = await calculateFileHash(targetPath);
            if (actualHash !== options.expectedHash) {
                await fs.unlink(targetPath);
                throw LocalModelError.hashMismatch(modelId, options.expectedHash, actualHash);
            }
            result.sha256 = actualHash;
        }

        options.events?.onComplete?.(modelId, targetPath);
        return result;
    } catch (error) {
        options.events?.onError?.(modelId, error as Error);
        throw error;
    }
}

export async function downloadModelFromUrl(
    modelId: string,
    url: string,
    filename: string,
    options: DownloadOptions
): Promise<DownloadResult> {
    const targetPath = path.join(options.targetDir, filename);

    try {
        options.events?.onProgress?.(createProgressEvent(modelId, 'pending', 0, 0));

        const result = await downloadFromHuggingFace(url, targetPath, options, modelId, 0);
        options.events?.onComplete?.(modelId, targetPath);
        return result;
    } catch (error) {
        options.events?.onError?.(modelId, error as Error);
        throw error;
    }
}

export async function checkDiskSpace(targetDir: string): Promise<number> {
    try {
        await fs.access(targetDir);
        return Number.MAX_SAFE_INTEGER;
    } catch {
        try {
            await fs.mkdir(targetDir, { recursive: true });
            return Number.MAX_SAFE_INTEGER;
        } catch {
            return 0;
        }
    }
}

export async function validateDiskSpace(
    modelId: string,
    requiredBytes: number,
    targetDir: string
): Promise<void> {
    const available = await checkDiskSpace(targetDir);
    if (available < requiredBytes) {
        throw LocalModelError.insufficientDiskSpace(modelId, requiredBytes, available);
    }
}

export async function cleanupPartialDownload(targetDir: string, filename: string): Promise<void> {
    const tempPath = path.join(targetDir, `${filename}.download`);
    try {
        await fs.unlink(tempPath);
    } catch {
    }
}

export async function isDownloadInProgress(targetDir: string, filename: string): Promise<boolean> {
    const tempPath = path.join(targetDir, `${filename}.download`);
    try {
        await fs.access(tempPath);
        return true;
    } catch {
        return false;
    }
}

export async function getPartialDownloadProgress(
    modelId: string,
    targetDir: string,
    filename: string,
    totalBytes: number
): Promise<ModelDownloadProgress | null> {
    const tempPath = path.join(targetDir, `${filename}.download`);
    try {
        const stats = await fs.stat(tempPath);
        return createProgressEvent(modelId, 'downloading', stats.size, totalBytes);
    } catch {
        return null;
    }
}
