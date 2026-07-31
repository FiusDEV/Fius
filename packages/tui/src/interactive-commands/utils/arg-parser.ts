


export interface ParsedArguments {
    
    parsedArgs: string[];
    
    options: Record<string, string>;
    
    flags: Set<string>;
}


export function parseOptions(args: string[]): ParsedArguments {
    const parsedArgs: string[] = [];
    const options: Record<string, string> = {};
    const flags: Set<string> = new Set();

    for (const arg of args) {
        if (arg.startsWith('--')) {
            if (arg.includes('=')) {
                // Handle --key=value format
                const [key, ...valueParts] = arg.slice(2).split('=');
                if (key) {
                    // Rejoin value parts in case the value contained '=' characters
                    options[key] = valueParts.join('=');
                }
            } else {
                // Handle --flag format (boolean flags)
                flags.add(arg.slice(2));
            }
        } else {
            // Regular argument (not an option)
            parsedArgs.push(arg);
        }
    }

    return { parsedArgs, options, flags };
}


export function reconstructArgs(parsed: ParsedArguments): string[] {
    const result: string[] = [...parsed.parsedArgs];

    // Add options in --key=value format
    for (const [key, value] of Object.entries(parsed.options)) {
        result.push(`--${key}=${value}`);
    }

    // Add flags in --flag format
    for (const flag of parsed.flags) {
        result.push(`--${flag}`);
    }

    return result;
}
