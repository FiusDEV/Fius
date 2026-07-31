

type ExitFunction = () => void;

let exitFn: ExitFunction | null = null;
let logoutRequested = false;

export function registerExitHandler(fn: ExitFunction): void {
    exitFn = fn;
}

export function triggerExit(): void {
    if (exitFn) {
        exitFn();
    } else {
        // Fallback to process.exit if exit handler not registered
        process.exit(0);
    }
}

export function triggerLogoutExit(): void {
    logoutRequested = true;
    triggerExit();
}

export function wasLogoutRequested(): boolean {
    return logoutRequested;
}
