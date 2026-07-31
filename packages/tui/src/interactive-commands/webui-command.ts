import type { CommandDefinition, CommandHandlerResult } from './command-parser.js';
import { getTuiRuntimeServices } from '../host/index.js';

let webServerStarted = false;

export const webuiCommand: CommandDefinition = {
    name: 'webui',
    description: 'Start WebUI server and open in browser',
    usage: '/webui [port]',
    category: 'General',
    handler: handleWebUI,
};

async function isServerRunning(url: string): Promise<boolean> {
    try {
        const { default: http } = await import('node:http');
        return await new Promise<boolean>((resolve) => {
            const req = http.get(url, { timeout: 2000 }, (res) => {
                res.resume();
                resolve(true);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
    } catch {
        return false;
    }
}

async function handleWebUI(args: string[]): Promise<CommandHandlerResult> {
    const services = getTuiRuntimeServices();

    if (!services.startWebServer) {
        return 'WebUI is not available in this mode.';
    }

    if (webServerStarted) {
        return 'WebUI is already running.';
    }

    const port = args[0] ? parseInt(args[0], 10) : undefined;

    if (port !== undefined && (isNaN(port) || port < 1 || port > 65535)) {
        return 'Port must be a number between 1 and 65535.';
    }

    const resolvedPort = port ?? 3000;
    const url = `http://localhost:${resolvedPort}`;

    if (await isServerRunning(url)) {
        return `WebUI is already running at ${url}`;
    }

    webServerStarted = true;
    const result = await services.startWebServer({ port });
    return `WebUI running at ${result.url}`;
}
