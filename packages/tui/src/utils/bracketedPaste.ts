

const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';


export function enableBracketedPaste(): void {
    process.stdout.write(ENABLE_BRACKETED_PASTE);
}


export function disableBracketedPaste(): void {
    process.stdout.write(DISABLE_BRACKETED_PASTE);
}
