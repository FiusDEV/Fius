
export interface FileTransportConfig {
    path: string;
    maxSize?: number;
    maxFiles?: number;
}

export class FileTransport {
    constructor(_config: FileTransportConfig) {}

    write(_entry: unknown): void {}

    getFilePath(): string {
        return '';
    }

    destroy(): void {}
}
