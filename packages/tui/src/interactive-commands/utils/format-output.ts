

import { stripVTControlCharacters } from 'node:util';


export function stripAnsi(str: string): string {
    return stripVTControlCharacters(str);
}


export function formatForInkCli(output: string): string {
    return stripAnsi(output);
}
