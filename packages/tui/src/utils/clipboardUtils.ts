

import { spawn, spawnSync } from 'node:child_process';
import { platform, release } from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ClipboardImageContent {
    
    data: string;
    
    mimeType: string;
}


async function execCommand(
    command: string,
    args: string[],
    timeoutMs: number = 10000
): Promise<{ stdout: Buffer; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        let timedOut = false;
        const proc = spawn(command, args);
        const stdoutChunks: Buffer[] = [];
        let stderr = '';

        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill();
            resolve({
                stdout: Buffer.concat(stdoutChunks),
                stderr: stderr + '\nCommand timed out',
                exitCode: 1,
            });
        }, timeoutMs);

        proc.stdout.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
        });

        proc.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        proc.on('close', (exitCode) => {
            if (timedOut) return;
            clearTimeout(timer);
            resolve({
                stdout: Buffer.concat(stdoutChunks),
                stderr,
                exitCode: exitCode ?? 1,
            });
        });

        proc.on('error', () => {
            if (timedOut) return;
            clearTimeout(timer);
            resolve({
                stdout: Buffer.concat(stdoutChunks),
                stderr,
                exitCode: 1,
            });
        });
    });
}


async function execOsascript(script: string): Promise<{ stdout: string; success: boolean }> {
    const result = await execCommand('osascript', ['-e', script]);
    return {
        stdout: result.stdout.toString().trim(),
        success: result.exitCode === 0,
    };
}


async function readClipboardImageMacOS(): Promise<ClipboardImageContent | undefined> {
    const tmpFile = path.join(os.tmpdir(), `fius-clipboard-${Date.now()}-${process.pid}.png`);

    try {
        // AppleScript to save clipboard image as PNG to temp file
        const script = `
            set imageData to the clipboard as "PNGf"
            set fileRef to open for access POSIX file "${tmpFile}" with write permission
            set eof fileRef to 0
            write imageData to fileRef
            close access fileRef
        `;

        const result = await execOsascript(script);
        if (!result.success) {
            return undefined;
        }

        // Read the temp file
        const buffer = await fs.readFile(tmpFile);
        if (buffer.length === 0) {
            return undefined;
        }

        return {
            data: buffer.toString('base64'),
            mimeType: 'image/png',
        };
    } catch {
        return undefined;
    } finally {
        // Clean up temp file
        try {
            await fs.unlink(tmpFile);
        } catch {
            // Ignore cleanup errors
        }
    }
}


async function readClipboardImageWindows(): Promise<ClipboardImageContent | undefined> {
    try {
        const script = [
            'Add-Type -AssemblyName System.Windows.Forms',
            'Add-Type -AssemblyName System.Drawing',
            '$img = [System.Windows.Forms.Clipboard]::GetImage()',
            'if ($img) {',
            '    $ms = New-Object System.IO.MemoryStream',
            '    $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
            '    [System.Convert]::ToBase64String($ms.ToArray())',
            '}',
        ].join('; ');

        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            encoding: 'utf-8',
            timeout: 5000,
        });

        const base64 = result.stdout?.trim();
        if (!base64 || result.status !== 0) {
            return undefined;
        }

        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length === 0) {
            return undefined;
        }

        return {
            data: base64,
            mimeType: 'image/png',
        };
    } catch {
        return undefined;
    }
}


function isWSL(): boolean {
    if (platform() !== 'linux') return false;
    const rel = release().toLowerCase();
    return rel.includes('wsl') || rel.includes('microsoft');
}


async function readClipboardImageLinux(): Promise<ClipboardImageContent | undefined> {
    // Try Wayland first (wl-paste)
    try {
        const result = await execCommand('wl-paste', ['-t', 'image/png']);
        if (result.exitCode === 0 && result.stdout.length > 0) {
            return {
                data: result.stdout.toString('base64'),
                mimeType: 'image/png',
            };
        }
    } catch {
        // wl-paste not available or failed, try xclip
    }

    // Try X11 (xclip)
    try {
        const result = await execCommand('xclip', [
            '-selection',
            'clipboard',
            '-t',
            'image/png',
            '-o',
        ]);
        if (result.exitCode === 0 && result.stdout.length > 0) {
            return {
                data: result.stdout.toString('base64'),
                mimeType: 'image/png',
            };
        }
    } catch {
        // xclip not available or failed
    }

    return undefined;
}


export async function readClipboardImage(): Promise<ClipboardImageContent | undefined> {
    const os = platform();

    if (os === 'darwin') {
        return readClipboardImageMacOS();
    }

    if (os === 'win32' || isWSL()) {
        return readClipboardImageWindows();
    }

    if (os === 'linux') {
        return readClipboardImageLinux();
    }

    return undefined;
}


export async function writeToClipboard(text: string): Promise<boolean> {
    const os = platform();

    try {
        if (os === 'darwin') {
            // macOS: use pbcopy
            const proc = spawn('pbcopy');
            proc.stdin.write(text);
            proc.stdin.end();
            return new Promise((resolve) => {
                proc.on('close', (code) => resolve(code === 0));
                proc.on('error', () => resolve(false));
            });
        }

        if (os === 'win32' || isWSL()) {
            // Windows/WSL: use clip.exe (simpler than PowerShell)
            const proc = spawn('clip.exe');
            proc.stdin.write(text);
            proc.stdin.end();
            return new Promise((resolve) => {
                proc.on('close', (code) => resolve(code === 0));
                proc.on('error', () => resolve(false));
            });
        }

        if (os === 'linux') {
            // Try Wayland first (wl-copy), fall back to X11 (xclip)
            const tryClipboardTool = (cmd: string, args: string[] = []): Promise<boolean> => {
                return new Promise((resolve) => {
                    const proc = spawn(cmd, args);
                    let errorOccurred = false;

                    proc.on('error', () => {
                        errorOccurred = true;
                        resolve(false);
                    });

                    proc.stdin.write(text);
                    proc.stdin.end();

                    proc.on('close', (code) => {
                        if (!errorOccurred) {
                            resolve(code === 0);
                        }
                    });
                });
            };

            // Try wl-copy first, then xclip
            const wlResult = await tryClipboardTool('wl-copy');
            if (wlResult) return true;

            return tryClipboardTool('xclip', ['-selection', 'clipboard']);
        }

        return false;
    } catch {
        return false;
    }
}


export async function clipboardHasImage(): Promise<boolean> {
    const os = platform();

    if (os === 'darwin') {
        try {
            const result = await execOsascript('clipboard info');
            // Check for image types in clipboard info
            const imageRegex =
                /«class PNGf»|TIFF picture|JPEG picture|GIF picture|«class JPEG»|«class TIFF»/;
            return imageRegex.test(result.stdout);
        } catch {
            return false;
        }
    }

    if (os === 'win32' || isWSL()) {
        try {
            const script = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::ContainsImage()';
            const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
                encoding: 'utf-8',
                timeout: 3000,
            });
            return result.stdout?.trim().toLowerCase() === 'true';
        } catch {
            return false;
        }
    }

    if (os === 'linux') {
        // Try Wayland first
        try {
            const result = await execCommand('wl-paste', ['--list-types']);
            if (result.exitCode === 0 && result.stdout.toString().includes('image/')) {
                return true;
            }
        } catch {
            // Try X11
        }

        // Try X11
        try {
            const result = await execCommand('xclip', [
                '-selection',
                'clipboard',
                '-t',
                'TARGETS',
                '-o',
            ]);
            if (result.exitCode === 0 && result.stdout.toString().includes('image/')) {
                return true;
            }
        } catch {
            // xclip not available
        }
    }

    return false;
}

// =============================================================================
// Clipboard text reading
// =============================================================================

export async function readClipboardText(): Promise<string | null> {
    const os = platform();

    try {
        if (os === 'darwin') {
            const result = spawnSync('pbpaste', [], { encoding: 'utf-8', timeout: 2000 });
            return result.stdout || null;
        }

        if (os === 'win32' || isWSL()) {
            // Try with explicit System.Windows.Forms assembly loading
            const script = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()';
            const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
                encoding: 'utf-8',
                timeout: 3000,
            });
            const text = result.stdout?.trim();
            if (text) return text;

            // Fallback: try Get-Clipboard
            const result2 = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard'], {
                encoding: 'utf-8',
                timeout: 3000,
            });
            return result2.stdout?.trim() || null;
        }

        if (os === 'linux') {
            try {
                const result = spawnSync('wl-paste', [], { encoding: 'utf-8', timeout: 2000 });
                if (result.exitCode === 0 && result.stdout) return result.stdout;
            } catch {}

            try {
                const result = spawnSync('xclip', ['-selection', 'clipboard', '-o'], {
                    encoding: 'utf-8',
                    timeout: 2000,
                });
                if (result.exitCode === 0 && result.stdout) return result.stdout;
            } catch {}
        }
    } catch {}

    return null;
}

// =============================================================================
// File path detection
// =============================================================================

import { existsSync, readFileSync, statSync } from 'fs';
import { extname } from 'path';

const SUPPORTED_FILE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
    '.pdf',
    '.mp3', '.wav', '.ogg', '.flac', '.m4a',
    '.mp4', '.webm', '.avi', '.mov',
    '.txt', '.md', '.json', '.csv', '.xml', '.html', '.css', '.js', '.ts',
    '.py', '.java', '.cpp', '.c', '.h', '.rs', '.go', '.rb', '.php',
    '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
]);

export function isSupportedFilePath(text: string): boolean {
    // Remove surrounding quotes and trim
    let trimmed = text.trim().replace(/\r?\n/g, '');
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        trimmed = trimmed.slice(1, -1);
    }
    trimmed = trimmed.trim();
    // Check if it looks like a path and has supported extension
    const ext = extname(trimmed).toLowerCase();
    if (!ext || !SUPPORTED_FILE_EXTENSIONS.has(ext)) return false;
    // Check if it looks like a Windows path (has drive letter) or Unix path
    if (/^[A-Za-z]:\\/.test(trimmed) || trimmed.startsWith('/')) return true;
    return false;
}

export function getFileMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.xml': 'text/xml',
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.ts': 'text/typescript',
        '.py': 'text/x-python',
        '.java': 'text/x-java',
        '.cpp': 'text/x-c++',
        '.c': 'text/x-c',
        '.h': 'text/x-c',
        '.rs': 'text/x-rust',
        '.go': 'text/x-go',
        '.rb': 'text/x-ruby',
        '.php': 'text/x-php',
        '.sh': 'text/x-shellscript',
        '.bash': 'text/x-shellscript',
        '.zsh': 'text/x-shellscript',
        '.ps1': 'text/x-powershell',
        '.bat': 'text/x-bat',
        '.cmd': 'text/x-bat',
    };
    return mimeMap[ext] || 'application/octet-stream';
}

export function readFileAsBase64(filePath: string): string {
    const cleanPath = filePath.trim().replace(/\r?\n/g, '');
    const fileBuffer = readFileSync(cleanPath);
    return fileBuffer.toString('base64');
}
